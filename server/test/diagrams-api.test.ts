import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commandResponseSchema, diagramDetailSchema, diagramListResponseSchema, errorEnvelopeSchema } from '@tinker/shared';
import { requestHash } from '../src/infrastructure/idempotency/mutation-requests.ts';
import { call, cmd, createDiagramFor, key, personalWorkspace, startHarness, type Harness, type TestUser } from './support/harness.ts';

const addNode = (name: string, kind = 'SERVICE') => ({ type: 'ADD_NODE', node: { name, kind } });

async function counts(h: Harness, diagramId: string) {
  const { rows } = await h.pool.query(
    `SELECT (SELECT version FROM diagrams WHERE id = $1)::int AS version,
            (SELECT count(*) FROM diagram_revisions WHERE diagram_id = $1)::int AS revisions,
            (SELECT count(*) FROM command_executions WHERE diagram_id = $1)::int AS executions,
            (SELECT count(*) FROM mutation_requests WHERE diagram_id = $1 AND resource LIKE '/v1/diagrams/%')::int AS requests`,
    [diagramId],
  );
  return rows[0] as { version: number; revisions: number; executions: number; requests: number };
}

describe('diagram lifecycle', () => {
  let h: Harness;
  let u: TestUser;
  beforeAll(async () => {
    h = await startHarness();
    u = await h.newUser('lifecycle');
  });
  afterAll(() => h.close());

  it('create -> list -> load, with the canonical empty document at version 1', async () => {
    const { workspaceId, diagram } = await createDiagramFor(h, u, 'Orders system');
    expect(diagramDetailSchema.safeParse(diagram).success).toBe(true);
    expect(diagram).toMatchObject({ name: 'Orders system', version: 1, workspaceId });
    expect(diagram.graph).toEqual({ schemaVersion: 1, nodes: [], edges: [] });

    const list = await call(h, u, 'GET', `/v1/workspaces/${workspaceId}/diagrams`);
    expect(diagramListResponseSchema.safeParse(list.body).success).toBe(true);
    expect(list.body.diagrams.map((d: { id: string }) => d.id)).toContain(diagram.diagramId);

    const loaded = await call(h, u, 'GET', `/v1/diagrams/${diagram.diagramId}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual(diagram);
  });

  it('gate: Orders -> PostgreSQL becomes Orders -> Redis -> PostgreSQL through the API, and is persisted', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const id = diagram.diagramId;
    const a = await cmd(id, u, h, 1, addNode('Orders'));
    const b = await cmd(id, u, h, 2, addNode('PostgreSQL', 'DATABASE'));
    expect([a.status, b.status]).toEqual([200, 200]);
    const [orders, postgres] = b.body.graph.nodes;
    const connect = await cmd(id, u, h, 3, { type: 'CONNECT', sourceNodeId: orders.id, targetNodeId: postgres.id, relationship: 'SQL' });
    const insert = await cmd(id, u, h, 4, { type: 'INSERT_BETWEEN', sourceNodeId: orders.id, targetNodeId: postgres.id, node: { name: 'Redis', kind: 'CACHE' } });
    expect(connect.status).toBe(200);
    expect(insert.status).toBe(200);
    expect(commandResponseSchema.safeParse(insert.body).success).toBe(true);
    expect(insert.body.version).toBe(5);
    expect(insert.body.graph.nodes.map((n: { name: string }) => n.name)).toEqual(['Orders', 'PostgreSQL', 'Redis']);
    expect(insert.body.graph.edges).toHaveLength(2);

    const loaded = await call(h, u, 'GET', `/v1/diagrams/${id}`);
    expect(loaded.body.graph).toEqual(insert.body.graph);
    expect(loaded.body.presentation).toEqual(insert.body.presentation);
    const stats = await counts(h, id);
    expect(stats).toMatchObject({ version: 5, revisions: 4, executions: 4 });
  });

  it('domain refusals are 422 with a reason, change nothing, and are recorded', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const before = await counts(h, diagram.diagramId);
    const res = await cmd(diagram.diagramId, u, h, 1, { type: 'REMOVE_NODE', nodeId: '00000000-0000-4000-8000-00000000dead' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'DOMAIN_VALIDATION_FAILED', details: { reason: 'NODE_NOT_FOUND' } });
    const after = await counts(h, diagram.diagramId);
    expect(after.version).toBe(before.version);
    expect(after.revisions).toBe(before.revisions);
    expect(after.executions).toBe(before.executions + 1);
  });

  it('presentation saves merge positions, bump the version and create no revision (D05)', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const id = diagram.diagramId;
    const added = await cmd(id, u, h, 1, addNode('Orders'));
    const nodeId = added.body.graph.nodes[0].id;
    const saved = await call(h, u, 'PATCH', `/v1/diagrams/${id}/presentation`, { expectedVersion: 2, nodePositions: { [nodeId]: { x: 500, y: 300 } }, viewport: { x: 10, y: 20, zoom: 1.25 } }, { 'idempotency-key': key() });
    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(3);
    expect(saved.body.presentation.nodePositions[nodeId]).toEqual({ x: 500, y: 300 });
    expect(saved.body.presentation.viewport).toEqual({ x: 10, y: 20, zoom: 1.25 });
    expect((await counts(h, id)).revisions).toBe(1);

    const unknown = await call(h, u, 'PATCH', `/v1/diagrams/${id}/presentation`, { expectedVersion: 3, nodePositions: { '00000000-0000-4000-8000-00000000dead': { x: 1, y: 1 } } }, { 'idempotency-key': key() });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.details.reason).toBe('NODE_NOT_FOUND');
    expect((await call(h, u, 'GET', `/v1/diagrams/${id}`)).body.version).toBe(3);
  });

  it('rename and soft delete participate in the version counter; a deleted diagram is gone for reads and writes', async () => {
    const { workspaceId, diagram } = await createDiagramFor(h, u, 'Old');
    const id = diagram.diagramId;
    const renamed = await call(h, u, 'PATCH', `/v1/diagrams/${id}`, { expectedVersion: 1, name: 'New name' }, { 'idempotency-key': key() });
    expect(renamed.body).toMatchObject({ name: 'New name', version: 2 });
    const stale = await call(h, u, 'PATCH', `/v1/diagrams/${id}`, { expectedVersion: 1, name: 'Stale' }, { 'idempotency-key': key() });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'DIAGRAM_VERSION_CONFLICT', details: { expectedVersion: 1, currentVersion: 2 } });

    const del = await call(h, u, 'DELETE', `/v1/diagrams/${id}?expectedVersion=2`, undefined, { 'idempotency-key': key() });
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ diagramId: id, version: 3, deleted: true });
    expect((await call(h, u, 'GET', `/v1/diagrams/${id}`)).status).toBe(404);
    expect((await cmd(id, u, h, 3, addNode('X'))).status).toBe(404);
    const list = await call(h, u, 'GET', `/v1/workspaces/${workspaceId}/diagrams`);
    expect(list.body.diagrams.map((d: { id: string }) => d.id)).not.toContain(id);
    const row = await h.pool.query('SELECT deleted_at FROM diagrams WHERE id = $1', [id]);
    expect(row.rows[0].deleted_at).not.toBeNull(); // soft delete: the row is retained
  });
});

describe('A06 stale versions and concurrent writers', () => {
  let h: Harness;
  let u: TestUser;
  beforeAll(async () => {
    h = await startHarness();
    u = await h.newUser('versions');
  });
  afterAll(() => h.close());

  it('two writes from the same version: exactly one succeeds, the other conflicts, nothing is overwritten', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const id = diagram.diagramId;
    const [a, b] = await Promise.all([cmd(id, u, h, 1, addNode('Alpha')), cmd(id, u, h, 1, addNode('Beta'))]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error).toMatchObject({ code: 'DIAGRAM_VERSION_CONFLICT', details: { expectedVersion: 1, currentVersion: 2 } });
    const loaded = await call(h, u, 'GET', `/v1/diagrams/${id}`);
    expect(loaded.body.version).toBe(2);
    expect(loaded.body.graph.nodes).toHaveLength(1);
    expect((await counts(h, id)).revisions).toBe(1);
  });

  it('a burst of 10 writers from one version produces exactly one winner', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => cmd(diagram.diagramId, u, h, 1, addNode(`N${i}`))));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect((await counts(h, diagram.diagramId)).version).toBe(2);
  });

  it('a stale expectedVersion never applies', async () => {
    const { diagram } = await createDiagramFor(h, u);
    await cmd(diagram.diagramId, u, h, 1, addNode('A'));
    const stale = await cmd(diagram.diagramId, u, h, 1, addNode('B'));
    expect(stale.status).toBe(409);
    const future = await cmd(diagram.diagramId, u, h, 99, addNode('C'));
    expect(future.status).toBe(409);
    expect((await call(h, u, 'GET', `/v1/diagrams/${diagram.diagramId}`)).body.graph.nodes).toHaveLength(1);
  });
});

describe('idempotency (A07-A10)', () => {
  let h: Harness;
  let u: TestUser;
  beforeAll(async () => {
    h = await startHarness();
    u = await h.newUser('idem');
  });
  afterAll(() => h.close());

  it('A08: an exact retry returns the original stored response and does not add a second node', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const k = key();
    const first = await cmd(diagram.diagramId, u, h, 1, addNode('Redis', 'CACHE'), k);
    const retry = await cmd(diagram.diagramId, u, h, 1, addNode('Redis', 'CACHE'), k);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.replayed).toBe(true);
    const { replayed: _r, ...replayBody } = retry.body;
    expect(replayBody).toEqual(first.body);
    expect(first.body.replayed).toBeUndefined();
    expect(await counts(h, diagram.diagramId)).toMatchObject({ version: 2, revisions: 1, executions: 1, requests: 1 });
    expect((await call(h, u, 'GET', `/v1/diagrams/${diagram.diagramId}`)).body.graph.nodes).toHaveLength(1);
  });

  it('A07: simultaneous duplicates of one key produce exactly one logical mutation', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const k = key();
    const results = await Promise.all(Array.from({ length: 10 }, () => cmd(diagram.diagramId, u, h, 1, addNode('Once'), k)));
    for (const r of results) {
      const ok = r.status === 200;
      const inProgress = r.status === 409 && r.body.error.code === 'REQUEST_ALREADY_PROCESSING';
      expect(ok || inProgress, JSON.stringify(r.body)).toBe(true);
    }
    expect(results.filter((r) => r.status === 200 && !r.body.replayed)).toHaveLength(1);
    expect(await counts(h, diagram.diagramId)).toMatchObject({ version: 2, revisions: 1, executions: 1, requests: 1 });
  });

  it('A09: reusing a key with a changed body, version, path or method is rejected', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const other = await createDiagramFor(h, u);
    const k = key();
    expect((await cmd(diagram.diagramId, u, h, 1, addNode('A'), k)).status).toBe(200);
    const variants = [
      await cmd(diagram.diagramId, u, h, 1, addNode('DIFFERENT'), k), // changed body
      await cmd(diagram.diagramId, u, h, 2, addNode('A'), k), // changed expectedVersion
      await cmd(other.diagram.diagramId, u, h, 1, addNode('A'), k), // changed path
      await call(h, u, 'PATCH', `/v1/diagrams/${diagram.diagramId}`, { expectedVersion: 2, name: 'x' }, { 'idempotency-key': k }), // changed method/route
    ];
    for (const v of variants) {
      expect(v.status).toBe(409);
      expect(v.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    }
    expect((await counts(h, other.diagram.diagramId)).version).toBe(1);
  });

  it('A10: replaying an old success after later edits returns the original result and does not regress the diagram', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const id = diagram.diagramId;
    const k = key();
    const first = await cmd(id, u, h, 1, addNode('First'), k);
    await cmd(id, u, h, 2, addNode('Second'));
    await cmd(id, u, h, 3, addNode('Third'));
    const replay = await cmd(id, u, h, 1, addNode('First'), k);
    expect(replay.status).toBe(200);
    expect(replay.body.version).toBe(first.body.version); // the original (older) result, marked as a replay
    expect(replay.body.replayed).toBe(true);
    expect((await call(h, u, 'GET', `/v1/diagrams/${id}`)).body.version).toBe(4); // server state is untouched
  });

  it('deterministic failures are stored and replayed too (a conflict stays a conflict for that key)', async () => {
    const { diagram } = await createDiagramFor(h, u);
    await cmd(diagram.diagramId, u, h, 1, addNode('A'));
    const k = key();
    const first = await cmd(diagram.diagramId, u, h, 1, addNode('B'), k);
    const retry = await cmd(diagram.diagramId, u, h, 1, addNode('B'), k);
    expect(first.status).toBe(409);
    expect(retry.status).toBe(409);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(errorEnvelopeSchema.safeParse(retry.body).success).toBe(true);
  });

  it('idempotency also covers creates: a retried create makes exactly one diagram', async () => {
    const workspaceId = await personalWorkspace(h, u);
    const k = key();
    const a = await call(h, u, 'POST', `/v1/workspaces/${workspaceId}/diagrams`, { name: 'Once only' }, { 'idempotency-key': k });
    const b = await call(h, u, 'POST', `/v1/workspaces/${workspaceId}/diagrams`, { name: 'Once only' }, { 'idempotency-key': k });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body.diagramId).toBe(a.body.diagramId);
    const n = await h.pool.query(`SELECT count(*)::int AS n FROM diagrams WHERE workspace_id = $1 AND name = 'Once only'`, [workspaceId]);
    expect(n.rows[0].n).toBe(1);
  });

  it('keys are scoped per user: two users may use the same key value independently', async () => {
    const v = await h.newUser('other');
    const k = key();
    const a = await createDiagramFor(h, u);
    const b = await createDiagramFor(h, v);
    expect((await cmd(a.diagram.diagramId, u, h, 1, addNode('A'), k)).status).toBe(200);
    expect((await cmd(b.diagram.diagramId, v, h, 1, addNode('A'), k)).status).toBe(200);
  });

  it('a replay past the full-retention window answers IDEMPOTENCY_RESULT_EXPIRED and never re-executes', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const k = key();
    expect((await cmd(diagram.diagramId, u, h, 1, addNode('A'), k)).status).toBe(200);
    await h.pool.query(`UPDATE mutation_requests SET completed_at = now() - interval '8 days' WHERE idempotency_key = $1`, [k]);
    const late = await cmd(diagram.diagramId, u, h, 1, addNode('A'), k);
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('IDEMPOTENCY_RESULT_EXPIRED');
    expect((await counts(h, diagram.diagramId)).version).toBe(2);
  });
});

describe('leases (D02)', () => {
  let h: Harness;
  let u: TestUser;
  beforeAll(async () => {
    h = await startHarness();
    u = await h.newUser('leases');
  });
  afterAll(() => h.close());

  it('an expired reservation from a crashed holder is taken over once and the mutation applies exactly once', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const id = diagram.diagramId;
    const k = key();
    const body = { expectedVersion: 1, command: addNode('Recovered') };
    // Simulate a process that reserved the key and died before committing: PROCESSING with a lease in the past.
    const userRow = await h.pool.query(`SELECT id FROM users WHERE external_auth_id = $1`, [u.subject]);
    const hash = requestHash({ method: 'POST', resource: `/v1/diagrams/${id}/commands`, body });
    await h.pool.query(
      `INSERT INTO mutation_requests (actor_id, idempotency_key, request_hash, method, resource, diagram_id, status, lease_token, lease_expires_at)
       VALUES ($1, $2, $3, 'POST', $4, $5, 'PROCESSING', gen_random_uuid(), now() - interval '5 seconds')`,
      [userRow.rows[0].id, k, hash, `/v1/diagrams/${id}/commands`, id],
    );
    const res = await cmd(id, u, h, 1, body.command, k);
    expect(res.status).toBe(200);
    const row = await h.pool.query(`SELECT attempt_count, status FROM mutation_requests WHERE idempotency_key = $1`, [k]);
    expect(row.rows[0]).toEqual({ attempt_count: 2, status: 'SUCCEEDED' });
    expect(await counts(h, id)).toMatchObject({ version: 2, revisions: 1 });
  });

  it('a live lease blocks duplicates with REQUEST_ALREADY_PROCESSING', async () => {
    const { diagram } = await createDiagramFor(h, u);
    const id = diagram.diagramId;
    const k = key();
    const body = { expectedVersion: 1, command: addNode('Busy') };
    const userRow = await h.pool.query(`SELECT id FROM users WHERE external_auth_id = $1`, [u.subject]);
    await h.pool.query(
      `INSERT INTO mutation_requests (actor_id, idempotency_key, request_hash, method, resource, diagram_id, status, lease_token, lease_expires_at)
       VALUES ($1, $2, $3, 'POST', $4, $5, 'PROCESSING', gen_random_uuid(), now() + interval '60 seconds')`,
      [userRow.rows[0].id, k, requestHash({ method: 'POST', resource: `/v1/diagrams/${id}/commands`, body }), `/v1/diagrams/${id}/commands`, id],
    );
    const res = await cmd(id, u, h, 1, body.command, k);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REQUEST_ALREADY_PROCESSING');
    expect((await counts(h, id)).version).toBe(1);
  });

  it('A12: a holder whose lease expired and was taken over cannot commit its late result (fencing)', async () => {
    let paused = false;
    const slow = await startHarness({
      pool: h.pool,
      signer: h.signer,
      hooks: {
        leaseSeconds: 1,
        fault: async (stage) => {
          if (stage === 'after-reserve' && !paused) {
            paused = true;
            await new Promise((r) => setTimeout(r, 2500)); // "provider call" outlives the lease
          }
        },
      },
    });
    const { diagram } = await createDiagramFor(h, u);
    const id = diagram.diagramId;
    const k = key();
    const slowRun = cmd(id, u, slow, 1, addNode('Late'), k); // holder A reserves, then stalls past its lease
    await new Promise((r) => setTimeout(r, 1600));
    const takeover = await cmd(id, u, h, 1, addNode('Late'), k); // holder B takes the expired lease and commits
    const late = await slowRun; // holder A wakes up and must fail its lease check
    expect(takeover.status).toBe(200);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('REQUEST_ALREADY_PROCESSING');
    expect(await counts(h, id)).toMatchObject({ version: 2, revisions: 1, executions: 1 });
    await slow.app.close();
  });
});

describe('A11 atomic persistence', () => {
  let u: TestUser;
  it('a failure after the revision insert rolls the whole mutation back, and the key can be retried', async () => {
    let failOnce = true;
    const h = await startHarness({
      hooks: {
        fault: (stage) => {
          if (stage === 'after-revision' && failOnce) {
            failOnce = false;
            throw new Error('injected storage failure');
          }
        },
      },
    });
    u = await h.newUser('rollback');
    const { diagram } = await createDiagramFor(h, u);
    const id = diagram.diagramId;
    const k = key();
    const failed = await cmd(id, u, h, 1, addNode('Atomic'), k);
    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe('INTERNAL_ERROR');
    expect(await counts(h, id)).toMatchObject({ version: 1, revisions: 0, executions: 0, requests: 0 }); // nothing leaked, key released
    expect((await call(h, u, 'GET', `/v1/diagrams/${id}`)).body.graph.nodes).toHaveLength(0);

    const retry = await cmd(id, u, h, 1, addNode('Atomic'), k);
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBeUndefined();
    expect(await counts(h, id)).toMatchObject({ version: 2, revisions: 1, executions: 1 });
    await h.close();
  });

  it('a failure while storing the response also rolls everything back', async () => {
    let failOnce = false; // armed after the diagram exists (creation also passes through 'before-complete')
    const h = await startHarness({
      hooks: {
        fault: (stage) => {
          if (stage === 'before-complete' && failOnce) {
            failOnce = false;
            throw new Error('injected response-storage failure');
          }
        },
      },
    });
    const user = await h.newUser('rollback2');
    const { diagram } = await createDiagramFor(h, user);
    failOnce = true;
    const res = await cmd(diagram.diagramId, user, h, 1, addNode('X'));
    expect(res.status).toBe(500);
    expect(await counts(h, diagram.diagramId)).toMatchObject({ version: 1, revisions: 0, executions: 0 });
    await h.close();
  });
});

describe('authorization (A13-A15)', () => {
  let h: Harness;
  let owner: TestUser;
  let stranger: TestUser;
  beforeAll(async () => {
    h = await startHarness();
    owner = await h.newUser('owner');
    stranger = await h.newUser('stranger');
  });
  afterAll(() => h.close());

  /** Put `user` into the owner's personal workspace with a role (membership management has no API yet). */
  async function grant(workspaceId: string, user: TestUser, role: 'EDITOR' | 'VIEWER') {
    await call(h, user, 'GET', '/v1/me'); // provision
    await h.pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       SELECT $1, id, $3 FROM users WHERE external_auth_id = $2
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [workspaceId, user.subject, role],
    );
  }
  const revoke = (workspaceId: string, user: TestUser) =>
    h.pool.query(`DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = (SELECT id FROM users WHERE external_auth_id = $2)`, [workspaceId, user.subject]);

  it('A13: another workspace gets a uniform 404 on every route and nothing leaks or changes', async () => {
    const { workspaceId, diagram } = await createDiagramFor(h, owner, 'Secret');
    const id = diagram.diagramId;
    const attempts = [
      await call(h, stranger, 'GET', `/v1/diagrams/${id}`),
      await cmd(id, stranger, h, 1, addNode('Evil')),
      await call(h, stranger, 'PATCH', `/v1/diagrams/${id}`, { expectedVersion: 1, name: 'Pwned' }, { 'idempotency-key': key() }),
      await call(h, stranger, 'PATCH', `/v1/diagrams/${id}/presentation`, { expectedVersion: 1, viewport: { x: 1, y: 1, zoom: 1 } }, { 'idempotency-key': key() }),
      await call(h, stranger, 'DELETE', `/v1/diagrams/${id}?expectedVersion=1`, undefined, { 'idempotency-key': key() }),
    ];
    for (const a of attempts) {
      expect(a.status).toBe(404);
      expect(a.body.error.code).toBe('DIAGRAM_NOT_FOUND');
      expect(JSON.stringify(a.body)).not.toContain('Secret');
    }
    const absent = await call(h, stranger, 'GET', `/v1/diagrams/00000000-0000-4000-8000-00000000dead`);
    expect(absent.body.error.message).toBe(attempts[0]!.body.error.message); // indistinguishable from "does not exist"
    expect((await call(h, stranger, 'GET', `/v1/workspaces/${workspaceId}/diagrams`)).status).toBe(404);
    expect((await call(h, stranger, 'POST', `/v1/workspaces/${workspaceId}/diagrams`, { name: 'x' }, { 'idempotency-key': key() })).status).toBe(404);
    expect((await counts(h, id)).version).toBe(1);
    expect((await call(h, owner, 'GET', `/v1/diagrams/${id}`)).body.name).toBe('Secret');
  });

  it('A14: a viewer can read but gets 403 on commands, presentation, rename, delete and create', async () => {
    const viewer = await h.newUser('viewer');
    const { workspaceId, diagram } = await createDiagramFor(h, owner);
    await grant(workspaceId, viewer, 'VIEWER');
    const id = diagram.diagramId;
    expect((await call(h, viewer, 'GET', `/v1/diagrams/${id}`)).status).toBe(200);
    expect((await call(h, viewer, 'GET', `/v1/workspaces/${workspaceId}/diagrams`)).status).toBe(200);
    const denied = [
      await cmd(id, viewer, h, 1, addNode('Nope')),
      await call(h, viewer, 'PATCH', `/v1/diagrams/${id}/presentation`, { expectedVersion: 1, viewport: { x: 1, y: 1, zoom: 1 } }, { 'idempotency-key': key() }),
      await call(h, viewer, 'PATCH', `/v1/diagrams/${id}`, { expectedVersion: 1, name: 'Nope' }, { 'idempotency-key': key() }),
      await call(h, viewer, 'DELETE', `/v1/diagrams/${id}?expectedVersion=1`, undefined, { 'idempotency-key': key() }),
      await call(h, viewer, 'POST', `/v1/workspaces/${workspaceId}/diagrams`, { name: 'Nope' }, { 'idempotency-key': key() }),
    ];
    for (const d of denied) {
      expect(d.status).toBe(403);
      expect(d.body.error.code).toBe('FORBIDDEN');
    }
    expect((await counts(h, id)).version).toBe(1);
  });

  it('an editor can modify but not delete; only the owner can delete', async () => {
    const editor = await h.newUser('editor');
    const { workspaceId, diagram } = await createDiagramFor(h, owner);
    await grant(workspaceId, editor, 'EDITOR');
    const id = diagram.diagramId;
    expect((await cmd(id, editor, h, 1, addNode('ByEditor'))).status).toBe(200);
    expect((await call(h, editor, 'DELETE', `/v1/diagrams/${id}?expectedVersion=2`, undefined, { 'idempotency-key': key() })).status).toBe(403);
    expect((await call(h, owner, 'DELETE', `/v1/diagrams/${id}?expectedVersion=2`, undefined, { 'idempotency-key': key() })).status).toBe(200);
  });

  it('A15: after membership is revoked a stored success is NOT replayed and the diagram is not disclosed', async () => {
    const editor = await h.newUser('revoked');
    const { workspaceId, diagram } = await createDiagramFor(h, owner);
    await grant(workspaceId, editor, 'EDITOR');
    const id = diagram.diagramId;
    const k = key();
    expect((await cmd(id, editor, h, 1, addNode('Before revoke'), k)).status).toBe(200);
    await revoke(workspaceId, editor);
    const replay = await cmd(id, editor, h, 1, addNode('Before revoke'), k);
    expect(replay.status).toBe(404);
    expect(replay.body.error.code).toBe('DIAGRAM_NOT_FOUND');
    expect(JSON.stringify(replay.body)).not.toContain('Before revoke');
    const fresh = await cmd(id, editor, h, 2, addNode('After revoke'));
    expect(fresh.status).toBe(404);
    expect((await counts(h, id)).version).toBe(2);
  });

  it('access revoked between the pre-check and the commit aborts the mutation and releases the key', async () => {
    const editor = await h.newUser('midflight');
    const { workspaceId, diagram } = await createDiagramFor(h, owner);
    await grant(workspaceId, editor, 'EDITOR');
    const id = diagram.diagramId;
    const mid = await startHarness({
      pool: h.pool,
      signer: h.signer,
      hooks: { fault: async (stage) => { if (stage === 'after-reserve') await revoke(workspaceId, editor); } },
    });
    const k = key();
    const res = await cmd(id, editor, mid, 1, addNode('Too late'), k);
    expect(res.status).toBe(404);
    expect(await counts(h, id)).toMatchObject({ version: 1, revisions: 0, executions: 0, requests: 0 });
    await mid.app.close();
  });

  it('a soft-deleted diagram cannot be replayed into existence or modified', async () => {
    const { diagram } = await createDiagramFor(h, owner);
    const id = diagram.diagramId;
    const k = key();
    await cmd(id, owner, h, 1, addNode('A'), k);
    await call(h, owner, 'DELETE', `/v1/diagrams/${id}?expectedVersion=2`, undefined, { 'idempotency-key': key() });
    expect((await cmd(id, owner, h, 1, addNode('A'), k)).status).toBe(404);
  });
});

describe('A05 durability across an API restart', () => {
  it('acknowledged state is identical after the API process and its connection pool are replaced', async () => {
    const first = await startHarness();
    const u = await first.newUser('durable');
    const { diagram } = await createDiagramFor(first, u);
    const id = diagram.diagramId;
    const a = await cmd(id, u, first, 1, addNode('Orders'));
    const nodeId = a.body.graph.nodes[0].id;
    const saved = await call(first, u, 'PATCH', `/v1/diagrams/${id}/presentation`, { expectedVersion: 2, nodePositions: { [nodeId]: { x: 42, y: 24 } } }, { 'idempotency-key': key() });
    const before = (await call(first, u, 'GET', `/v1/diagrams/${id}`)).body;
    await first.close(); // API gone, pool closed

    const second = await startHarness({ signer: first.signer }); // a new process with a new pool
    const after = await call(second, u, 'GET', `/v1/diagrams/${id}`);
    expect(after.status).toBe(200);
    expect(after.body).toEqual(before);
    expect(after.body.version).toBe(saved.body.version);
    expect(after.body.presentation.nodePositions[nodeId]).toEqual({ x: 42, y: 24 });
    await second.close();
  });
});
