import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from '../../src/infrastructure/database/pool.ts';
import { DEFAULT_RETENTION } from '../../src/modules/jobs/handlers.ts';
import { JobError, RETRY_DELAYS_SECONDS, claimJob, completeJob, enqueue, failJob, heartbeat, sanitizeError } from '../../src/modules/jobs/queue.ts';
import { runOnce, scheduleMaintenance, trimFinishedJobs } from '../../src/modules/jobs/worker.ts';
import { call, cmd, createDiagramFor, key, startHarness, type Harness, type TestUser } from '../support/harness.ts';

let counter = 0;
const nextKey = (prefix = 'test') => `${prefix}:${Date.now()}:${counter++}:${Math.random()}`;

async function job(pool: Pool, id: string) {
  const { rows } = await pool.query(`SELECT * FROM jobs WHERE id = $1`, [id]);
  return rows[0];
}
async function enqueueOne(pool: Pool, type: 'PRUNE_REVISIONS' | 'CLEANUP_EXPIRED_REQUESTS' | 'PURGE_DELETED_DIAGRAMS' = 'PRUNE_REVISIONS', extra: { maxAttempts?: number } = {}) {
  const operationKey = nextKey();
  await enqueue(pool, { type, operationKey, ...extra });
  const { rows } = await pool.query(`SELECT id FROM jobs WHERE operation_key = $1`, [operationKey]);
  return rows[0].id as string;
}
/** Park everything else so a test only sees its own jobs. */
const clearJobs = (pool: Pool) => pool.query(`DELETE FROM jobs`);

describe('job queue: claiming, leases and fencing', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());

  it('enqueueing the same operation twice queues it once', async () => {
    const k = nextKey('dedupe');
    expect(await enqueue(h.pool, { type: 'PRUNE_REVISIONS', operationKey: k })).toEqual({ created: true });
    expect(await enqueue(h.pool, { type: 'PRUNE_REVISIONS', operationKey: k })).toEqual({ created: false });
    expect((await h.pool.query(`SELECT count(*)::int AS n FROM jobs WHERE operation_key = $1`, [k])).rows[0].n).toBe(1);
  });

  it('a claim marks the job running under a lease, counts the attempt, and only due jobs are claimed', async () => {
    await clearJobs(h.pool);
    const future = nextKey();
    await enqueue(h.pool, { type: 'PRUNE_REVISIONS', operationKey: future, availableAt: new Date(Date.now() + 60_000) });
    expect(await claimJob(h.pool, { leaseSeconds: 30 })).toBeNull();
    const id = await enqueueOne(h.pool);
    const claimed = await claimJob(h.pool, { leaseSeconds: 30 });
    expect(claimed).toMatchObject({ id, type: 'PRUNE_REVISIONS', attempt: 1, maxAttempts: 3 });
    const row = await job(h.pool, id);
    expect(row.status).toBe('RUNNING');
    expect(row.lease_token).toBe(claimed!.leaseToken);
    expect(new Date(row.lease_expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(await claimJob(h.pool, { leaseSeconds: 30 })).toBeNull(); // running with a live lease: not claimable
  });

  it('many workers claiming at once never receive the same job', async () => {
    await clearJobs(h.pool);
    const ids = await Promise.all([1, 2, 3, 4, 5].map(() => enqueueOne(h.pool)));
    const claims = await Promise.all(Array.from({ length: 12 }, () => claimJob(h.pool, { leaseSeconds: 30 })));
    const got = claims.filter((c) => c !== null).map((c) => c!.id);
    expect(got).toHaveLength(5);
    expect(new Set(got).size).toBe(5);
    expect([...got].sort()).toEqual([...ids].sort());
  });

  it('completion needs the lease token; a wrong or stale token changes nothing', async () => {
    await clearJobs(h.pool);
    const id = await enqueueOne(h.pool);
    const claimed = (await claimJob(h.pool, { leaseSeconds: 30 }))!;
    expect(await completeJob(h.pool, { ...claimed, leaseToken: '00000000-0000-4000-8000-000000000000' }, { n: 1 })).toBe(false);
    expect((await job(h.pool, id)).status).toBe('RUNNING');
    expect(await completeJob(h.pool, claimed, { n: 1 })).toBe(true);
    expect(await job(h.pool, id)).toMatchObject({ status: 'COMPLETED', result: { n: 1 }, lease_token: null });
    expect(await completeJob(h.pool, claimed, { n: 2 })).toBe(false); // finished jobs do not change
    expect((await job(h.pool, id)).result).toEqual({ n: 1 });
  });

  it('heartbeats extend the lease for the owner only', async () => {
    await clearJobs(h.pool);
    const id = await enqueueOne(h.pool);
    const claimed = (await claimJob(h.pool, { leaseSeconds: 5 }))!;
    const before = new Date((await job(h.pool, id)).lease_expires_at).getTime();
    expect(await heartbeat(h.pool, claimed, 600)).toBe(true);
    expect(new Date((await job(h.pool, id)).lease_expires_at).getTime()).toBeGreaterThan(before + 60_000);
    expect(await heartbeat(h.pool, { ...claimed, leaseToken: '00000000-0000-4000-8000-000000000000' }, 600)).toBe(false);
  });

  it('failures retry after 10 s, then 60 s, and the third failure is a dead letter', async () => {
    await clearJobs(h.pool);
    const id = await enqueueOne(h.pool);
    for (const [attempt, delay] of [[1, RETRY_DELAYS_SECONDS[0]], [2, RETRY_DELAYS_SECONDS[1]]] as const) {
      const claimed = (await claimJob(h.pool, { leaseSeconds: 30 }))!;
      expect(claimed.attempt).toBe(attempt);
      expect(await failJob(h.pool, claimed, new Error('boom'))).toBe('RETRY');
      const row = await job(h.pool, id);
      expect(row.status).toBe('PENDING');
      const wait = (new Date(row.available_at).getTime() - Date.now()) / 1000;
      expect(wait).toBeGreaterThan(delay - 3);
      expect(wait).toBeLessThanOrEqual(delay + 1);
      expect(await claimJob(h.pool, { leaseSeconds: 30 })).toBeNull(); // not before the delay
      await h.pool.query(`UPDATE jobs SET available_at = now() WHERE id = $1`, [id]);
    }
    const last = (await claimJob(h.pool, { leaseSeconds: 30 }))!;
    expect(last.attempt).toBe(3);
    expect(await failJob(h.pool, last, new JobError('EXTERNAL', 'the database said no'))).toBe('DEAD_LETTER');
    expect(await job(h.pool, id)).toMatchObject({ status: 'DEAD_LETTER', last_error_kind: 'EXTERNAL', attempt_count: 3 });
    expect(await claimJob(h.pool, { leaseSeconds: 30 })).toBeNull(); // dead letters are never picked up again
  });

  it('stored errors are one short line without connection strings, tokens or stack traces', async () => {
    const error = new Error('connect failed to postgres://tinker:hunter2@db.example.com:5432/tinker\n    at stack frame\nBearer abcdef.ghijkl.mnopqr and key AQ.Ab8RN6IxYzabcdefghijklmnopqrstuv');
    const text = sanitizeError(error);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('abcdef.ghijkl');
    expect(text).not.toContain('AQ.Ab8RN6');
    expect(text).not.toMatch(/[\r\n]/);
    expect(text.length).toBeLessThanOrEqual(300);
    expect(sanitizeError('x'.repeat(1000)).length).toBeLessThanOrEqual(300);
  });

  it('crash after claim: the job is taken over once its lease lapses; the dead holder is fenced off', async () => {
    await clearJobs(h.pool);
    const id = await enqueueOne(h.pool);
    const crashed = (await claimJob(h.pool, { leaseSeconds: 30 }))!; // ...and the worker dies here
    expect(await claimJob(h.pool, { leaseSeconds: 30 })).toBeNull(); // still leased: nobody else may start it
    await h.pool.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
    const rescuer = (await claimJob(h.pool, { leaseSeconds: 30 }))!;
    expect(rescuer).toMatchObject({ id, attempt: 2 });
    expect(rescuer.leaseToken).not.toBe(crashed.leaseToken);
    expect(await job(h.pool, id)).toMatchObject({ last_error_kind: 'LEASE_EXPIRED' });
    // the "dead" worker wakes up late and tries to report: refused
    expect(await completeJob(h.pool, crashed, { late: true })).toBe(false);
    expect(await failJob(h.pool, crashed, new Error('late'))).toBeNull();
    expect(await heartbeat(h.pool, crashed, 30)).toBe(false);
    expect(await completeJob(h.pool, rescuer, { ok: true })).toBe(true);
    expect(await job(h.pool, id)).toMatchObject({ status: 'COMPLETED', result: { ok: true } });
  });

  it('a job that keeps crashing its workers is dead-lettered instead of looping forever', async () => {
    await clearJobs(h.pool);
    const id = await enqueueOne(h.pool, 'PRUNE_REVISIONS', { maxAttempts: 2 });
    for (let attempt = 1; attempt <= 2; attempt++) {
      const claimed = (await claimJob(h.pool, { leaseSeconds: 30 }))!;
      expect(claimed.attempt).toBe(attempt);
      await h.pool.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [id]); // the worker "died"
    }
    expect(await claimJob(h.pool, { leaseSeconds: 30 })).toBeNull();
    expect(await job(h.pool, id)).toMatchObject({ status: 'DEAD_LETTER', last_error_kind: 'LEASE_EXPIRED', attempt_count: 2 });
  });

  it('maintenance is scheduled once per hour and finished jobs are trimmed', async () => {
    await clearJobs(h.pool);
    const hour = new Date('2026-10-06T10:15:00Z');
    expect(await scheduleMaintenance(h.pool, hour)).toBe(3);
    expect(await scheduleMaintenance(h.pool, new Date('2026-10-06T10:59:00Z'))).toBe(0);
    expect(await scheduleMaintenance(h.pool, new Date('2026-10-06T11:00:00Z'))).toBe(3);
    await h.pool.query(`UPDATE jobs SET status = 'COMPLETED', completed_at = now() - interval '8 days' WHERE operation_key LIKE '%T10'`);
    expect(await trimFinishedJobs(h.pool)).toBe(3);
    expect((await h.pool.query(`SELECT count(*)::int AS n FROM jobs`)).rows[0].n).toBe(3);
  });
});

describe('worker: running jobs', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());

  it('runs a job and records the result; idle when there is nothing to do', async () => {
    await clearJobs(h.pool);
    expect(await runOnce({ pool: h.pool })).toEqual({ status: 'IDLE' });
    const id = await enqueueOne(h.pool);
    const outcome = await runOnce({ pool: h.pool, handlers: { PRUNE_REVISIONS: async () => ({ pruned: 7 }) } });
    expect(outcome).toMatchObject({ status: 'COMPLETED', result: { pruned: 7 } });
    expect(await job(h.pool, id)).toMatchObject({ status: 'COMPLETED', result: { pruned: 7 } });
  });

  it('a handler that throws is retried later, with the error stored in sanitized form', async () => {
    await clearJobs(h.pool);
    const id = await enqueueOne(h.pool);
    const outcome = await runOnce({ pool: h.pool, handlers: { PRUNE_REVISIONS: async () => { throw new Error('cannot reach postgres://u:secret@host/db'); } } });
    expect(outcome.status).toBe('RETRY');
    const row = await job(h.pool, id);
    expect(row).toMatchObject({ status: 'PENDING', last_error_kind: 'INTERNAL' });
    expect(row.last_error).not.toContain('secret');
  });

  it('a worker whose lease was taken over mid-run is fenced: its result is not recorded and the new holder wins', async () => {
    await clearJobs(h.pool);
    const id = await enqueueOne(h.pool);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = runOnce({
      pool: h.pool,
      leaseSeconds: 30,
      handlers: { PRUNE_REVISIONS: async () => { await gate; return { who: 1 }; } },
    });
    await vi.waitFor(async () => expect((await job(h.pool, id)).status).toBe('RUNNING'));
    await h.pool.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [id]); // it looks dead
    const fast = await runOnce({ pool: h.pool, handlers: { PRUNE_REVISIONS: async () => ({ who: 2 }) } });
    expect(fast).toMatchObject({ status: 'COMPLETED', result: { who: 2 } });
    release();
    expect((await slow).status).toBe('FENCED');
    expect(await job(h.pool, id)).toMatchObject({ status: 'COMPLETED', result: { who: 2 } }); // the first worker did not overwrite it
  });

  it('duplicate execution is harmless: running the maintenance handlers twice gives the same final state', async () => {
    await clearJobs(h.pool);
    for (const type of ['PRUNE_REVISIONS', 'CLEANUP_EXPIRED_REQUESTS', 'PURGE_DELETED_DIAGRAMS'] as const) {
      const first = await enqueueOne(h.pool, type);
      const a = await runOnce({ pool: h.pool });
      const second = await enqueueOne(h.pool, type);
      const b = await runOnce({ pool: h.pool });
      expect(a.status).toBe('COMPLETED');
      expect(b.status).toBe('COMPLETED');
      void first;
      void second;
    }
  });
});

// ---------- retention handlers ----------

async function seedRevisions(h: Harness, u: TestUser, total: number, oldest: number) {
  const { diagram } = await createDiagramFor(h, u, 'Retention');
  const id = diagram.diagramId;
  const { rows } = await h.pool.query(`SELECT created_by FROM diagrams WHERE id = $1`, [id]);
  const by = rows[0].created_by as string;
  await h.pool.query(`DELETE FROM diagram_revisions WHERE diagram_id = $1`, [id]);
  // versions 1..total, the first `oldest` of them 40 days old, the rest 1 day old
  await h.pool.query(
    `INSERT INTO diagram_revisions (diagram_id, version, graph, presentation, reason, created_by, created_at)
     SELECT $1, v, '{"schemaVersion":1,"nodes":[],"edges":[]}'::jsonb, '{"nodePositions":{},"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, 'MANUAL_COMMAND', $2,
            now() - CASE WHEN v <= $4 THEN interval '40 days' ELSE interval '1 day' END
       FROM generate_series(1, $3) AS v`,
    [id, by, total, oldest],
  );
  return id;
}
const versionsOf = async (pool: Pool, id: string) => (await pool.query(`SELECT version FROM diagram_revisions WHERE diagram_id = $1 ORDER BY version`, [id])).rows.map((r) => r.version as number);

describe('retention: revision pruning (D11)', () => {
  let h: Harness;
  let u: TestUser;
  beforeAll(async () => {
    h = await startHarness();
    u = await h.newUser('pruner');
  });
  afterAll(() => h.close());

  const prune = async () => {
    await clearJobs(h.pool);
    await enqueueOne(h.pool, 'PRUNE_REVISIONS');
    return runOnce({ pool: h.pool });
  };

  it('prunes only revisions that are BOTH outside the latest 100 AND older than 30 days', async () => {
    const id = await seedRevisions(h, u, 130, 40); // v1-40 are old; v31-130 are the latest 100
    const outcome = await prune();
    expect(outcome).toMatchObject({ status: 'COMPLETED' });
    const kept = await versionsOf(h.pool, id);
    expect(kept[0]).toBe(31); // v1-30: old AND outside the latest 100 -> gone
    expect(kept).toHaveLength(100);
    expect(kept.slice(-1)[0]).toBe(130); // the newest is never touched
    expect(kept.filter((v) => v <= 40)).toHaveLength(10); // v31-40 are old but inside the latest 100 -> kept
  });

  it('thins older versions to one per hour, then one per day, and drops everything past 90 days', async () => {
    const { diagram } = await createDiagramFor(h, u, 'Thinned');
    const id = diagram.diagramId;
    const by = (await h.pool.query(`SELECT created_by FROM diagrams WHERE id = $1`, [id])).rows[0].created_by as string;
    await h.pool.query(`DELETE FROM diagram_revisions WHERE diagram_id = $1`, [id]);
    // 200 versions, one every 30 minutes (about 4 days); then 20 versions 30 days ago (same day) and 5 versions 120 days ago
    await h.pool.query(
      `INSERT INTO diagram_revisions (diagram_id, version, graph, presentation, reason, created_by, created_at)
       SELECT $1, v, '{"schemaVersion":1,"nodes":[],"edges":[]}'::jsonb, '{"nodePositions":{},"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, 'MANUAL_COMMAND', $2,
              CASE WHEN v <= 5 THEN now() - interval '120 days'
                   WHEN v <= 25 THEN now() - interval '30 days' + (v * interval '1 minute')
                   ELSE now() - ((225 - v) * interval '30 minutes') END
         FROM generate_series(1, 225) AS v`,
      [id, by],
    );
    await prune();
    const kept = await versionsOf(h.pool, id);
    expect(kept.filter((v) => v > 125)).toHaveLength(100); // the latest 100 are all there
    expect(kept.filter((v) => v <= 5)).toHaveLength(0); // past 90 days
    expect(kept.filter((v) => v > 5 && v <= 25)).toHaveLength(1); // 20 versions on one old day: one stays
    const middle = kept.filter((v) => v > 25 && v <= 125);
    expect(middle.length).toBeGreaterThan(40);
    expect(middle.length).toBeLessThanOrEqual(52); // about 50 hours: one per hour
    expect(kept.length).toBeLessThan(160);
  });

  it('the latest 100 are always kept; a short history is never trimmed', async () => {
    const many = await seedRevisions(h, u, 130, 0); // 130 revisions made within the same hour
    const few = await seedRevisions(h, u, 20, 20); // 20 revisions, all old
    await prune();
    expect(await versionsOf(h.pool, many)).toHaveLength(100); // the older 30 share one hour with the newest: thinned to one per hour
    expect(await versionsOf(h.pool, few)).toHaveLength(20);
  });

  it('is safe to run twice, and the diagram itself is unaffected', async () => {
    const id = await seedRevisions(h, u, 130, 40);
    const before = (await h.pool.query(`SELECT version, graph FROM diagrams WHERE id = $1`, [id])).rows[0];
    await prune();
    const once = await versionsOf(h.pool, id);
    await prune();
    expect(await versionsOf(h.pool, id)).toEqual(once);
    expect((await h.pool.query(`SELECT version, graph FROM diagrams WHERE id = $1`, [id])).rows[0]).toEqual(before);
  });

  it('restoring a pruned version says it is no longer in the history, and restoring a kept one still works', async () => {
    const { diagram } = await createDiagramFor(h, u, 'Pruned');
    const id = diagram.diagramId;
    let version = 1;
    for (const name of ['A', 'B', 'C']) version = (await cmd(id, u, h, version, { type: 'ADD_NODE', node: { name, kind: 'SERVICE' } })).body.version;
    await h.pool.query(`UPDATE diagram_revisions SET created_at = now() - interval '40 days' WHERE diagram_id = $1 AND version <= 2`, [id]);
    await prune(); // only 4 revisions: nothing is outside the latest 100, so nothing goes
    expect((await versionsOf(h.pool, id))).toHaveLength(4);
    await h.pool.query(`DELETE FROM diagram_revisions WHERE diagram_id = $1 AND version = 2`, [id]); // as if pruned
    const gone = await call(h, u, 'POST', `/v1/diagrams/${id}/restore`, { expectedVersion: version, version: 2 }, { 'idempotency-key': key() });
    expect(gone.status).toBe(422);
    expect(gone.body.error.message).toMatch(/history/i);
    const ok = await call(h, u, 'POST', `/v1/diagrams/${id}/restore`, { expectedVersion: version, version: 3 }, { 'idempotency-key': key() });
    expect(ok.status).toBe(200);
  });
});

describe('retention: expired idempotency data and deleted diagrams', () => {
  let h: Harness;
  let u: TestUser;
  beforeAll(async () => {
    h = await startHarness();
    u = await h.newUser('cleaner');
  });
  afterAll(() => h.close());

  const run = async (type: 'CLEANUP_EXPIRED_REQUESTS' | 'PURGE_DELETED_DIAGRAMS') => {
    await clearJobs(h.pool);
    await enqueueOne(h.pool, type);
    return runOnce({ pool: h.pool });
  };

  it('past the replay window the stored response goes but the key stays a tombstone (it never re-executes); recent and in-flight requests are untouched', async () => {
    const { diagram } = await createDiagramFor(h, u, 'Replay');
    const id = diagram.diagramId;
    const oldKey = key();
    const recentKey = key();
    const first = await cmd(id, u, h, 1, { type: 'ADD_NODE', node: { name: 'Old', kind: 'SERVICE' } }, oldKey);
    await cmd(id, u, h, first.body.version, { type: 'ADD_NODE', node: { name: 'Recent', kind: 'SERVICE' } }, recentKey);
    await h.pool.query(`UPDATE mutation_requests SET completed_at = now() - interval '8 days' WHERE idempotency_key = $1`, [oldKey]);
    await h.pool.query(
      `INSERT INTO mutation_requests (actor_id, idempotency_key, request_hash, method, resource, status, lease_expires_at, created_at)
       SELECT actor_id, 'inflight-key-0001', repeat('a', 64), 'POST', '/v1/x', 'PROCESSING', now() - interval '1 hour', now() - interval '100 days' FROM mutation_requests WHERE idempotency_key = $1`,
      [oldKey],
    );

    const outcome = await run('CLEANUP_EXPIRED_REQUESTS');
    expect(outcome).toMatchObject({ status: 'COMPLETED' });
    const rows = (await h.pool.query(`SELECT idempotency_key, response_body IS NULL AS gone, status FROM mutation_requests WHERE idempotency_key IN ($1, $2, 'inflight-key-0001')`, [oldKey, recentKey])).rows;
    const by = Object.fromEntries(rows.map((r) => [r.idempotency_key, r]));
    expect(by[oldKey].gone).toBe(true);
    expect(by[recentKey].gone).toBe(false);
    expect(by['inflight-key-0001']).toMatchObject({ gone: true, status: 'PROCESSING' }); // had no body; still there and still processing

    // the old key still answers "expired" and does NOT apply the command a second time
    const again = await cmd(id, u, h, 1, { type: 'ADD_NODE', node: { name: 'Old', kind: 'SERVICE' } }, oldKey); // the identical original request
    expect(again.status).toBe(410);
    expect(again.body.error.code).toBe('IDEMPOTENCY_RESULT_EXPIRED');
    const nodes = (await h.pool.query(`SELECT jsonb_array_length(graph->'nodes')::int AS n FROM diagrams WHERE id = $1`, [id])).rows[0].n;
    expect(nodes).toBe(2);
    // the recent key still replays its full response
    const replay = await cmd(id, u, h, first.body.version, { type: 'ADD_NODE', node: { name: 'Recent', kind: 'SERVICE' } }, recentKey); // the identical original request
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
  });

  it('diagnostics and tombstones go after their own, longer windows', async () => {
    const { diagram } = await createDiagramFor(h, u, 'Old requests');
    const id = diagram.diagramId;
    const k = key();
    await cmd(id, u, h, 1, { type: 'ADD_NODE', node: { name: 'X', kind: 'SERVICE' } }, k);
    await h.pool.query(`UPDATE mutation_requests SET completed_at = now() - interval '100 days' WHERE idempotency_key = $1`, [k]);
    await h.pool.query(`UPDATE command_executions SET created_at = now() - interval '100 days' WHERE mutation_request_id IN (SELECT id FROM mutation_requests WHERE idempotency_key = $1)`, [k]);
    await run('CLEANUP_EXPIRED_REQUESTS');
    expect((await h.pool.query(`SELECT count(*)::int AS n FROM mutation_requests WHERE idempotency_key = $1`, [k])).rows[0].n).toBe(0);
    expect((await h.pool.query(`SELECT count(*)::int AS n FROM command_executions WHERE diagram_id = $1`, [id])).rows[0].n).toBe(0);
    // the diagram and its revisions are untouched by this cleanup
    expect((await h.pool.query(`SELECT count(*)::int AS n FROM diagram_revisions WHERE diagram_id = $1`, [id])).rows[0].n).toBeGreaterThan(0);
  });

  it('purges diagrams deleted more than 30 days ago with everything attached, and nothing else', async () => {
    const mk = async (name: string) => {
      const { diagram } = await createDiagramFor(h, u, name);
      const id = diagram.diagramId;
      const added = await cmd(id, u, h, 1, { type: 'ADD_NODE', node: { name: 'N', kind: 'SERVICE' } });
      await call(h, u, 'POST', `/v1/diagrams/${id}/ai/ask`, { question: 'hello?' });
      return { id, version: added.body.version as number };
    };
    const old = await mk('Deleted long ago');
    const recent = await mk('Deleted recently');
    const live = await mk('Alive');
    await call(h, u, 'DELETE', `/v1/diagrams/${old.id}?expectedVersion=${old.version}`, undefined, { 'idempotency-key': key() });
    await call(h, u, 'DELETE', `/v1/diagrams/${recent.id}?expectedVersion=${recent.version}`, undefined, { 'idempotency-key': key() });
    await h.pool.query(`UPDATE diagrams SET deleted_at = now() - interval '31 days' WHERE id = $1`, [old.id]);
    await h.pool.query(`UPDATE diagrams SET deleted_at = now() - interval '29 days' WHERE id = $1`, [recent.id]);

    const count = async (id: string) =>
      (await h.pool.query(
        `SELECT (SELECT count(*) FROM diagrams WHERE id = $1)::int AS diagram,
                (SELECT count(*) FROM diagram_revisions WHERE diagram_id = $1)::int AS revisions,
                (SELECT count(*) FROM command_executions WHERE diagram_id = $1)::int AS executions,
                (SELECT count(*) FROM mutation_requests WHERE diagram_id = $1)::int AS requests,
                (SELECT count(*) FROM conversations WHERE diagram_id = $1)::int AS conversations,
                (SELECT count(*) FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.diagram_id = $1)::int AS messages`,
        [id],
      )).rows[0];
    const liveBefore = await count(live.id);
    const recentBefore = await count(recent.id);
    expect((await count(old.id)).revisions).toBeGreaterThan(0);

    const outcome = await run('PURGE_DELETED_DIAGRAMS');
    expect(outcome).toMatchObject({ status: 'COMPLETED', result: { diagramsPurged: 1 } });
    expect(await count(old.id)).toEqual({ diagram: 0, revisions: 0, executions: 0, requests: 0, conversations: 0, messages: 0 });
    expect(await count(recent.id)).toEqual(recentBefore); // still inside the recovery window
    expect(await count(live.id)).toEqual(liveBefore);
    expect((await run('PURGE_DELETED_DIAGRAMS'))).toMatchObject({ result: { diagramsPurged: 0 } }); // nothing left: harmless to repeat
  });

  it('the retention windows are the documented ones', () => {
    expect(DEFAULT_RETENTION).toMatchObject({ revisionKeepLatest: 100, revisionHourlyDays: 7, revisionDays: 90, deletedDiagramDays: 30 });
  });
});
