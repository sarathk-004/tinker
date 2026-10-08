import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restoreResponseSchema, revisionDetailSchema, revisionListResponseSchema } from '@tinker/shared';
import { call, cmd, createDiagramFor, key, startHarness, type Harness, type TestUser } from '../support/harness.ts';

const restore = (h: Harness, u: TestUser | null, diagramId: string, expectedVersion: number, version: number, idem = key()) =>
  call(h, u, 'POST', `/v1/diagrams/${diagramId}/restore`, { expectedVersion, version }, { 'idempotency-key': idem });

/** v1 baseline, then Orders (v2), PostgreSQL (v3), connect (v4). Returns the node ids. */
async function seed(h: Harness, u: TestUser) {
  const { diagram, workspaceId } = await createDiagramFor(h, u, 'History test');
  const id = diagram.diagramId;
  let version = 1;
  const ids: string[] = [];
  for (const [name, kind] of [['Orders', 'SERVICE'], ['PostgreSQL', 'DATABASE']] as const) {
    const r = await cmd(id, u, h, version, { type: 'ADD_NODE', node: { name, kind } });
    version = r.body.version;
    ids.push((r.body.graph.nodes as Array<{ id: string }>).at(-1)!.id);
  }
  const c = await cmd(id, u, h, version, { type: 'CONNECT', sourceNodeId: ids[0]!, targetNodeId: ids[1]! });
  return { id, version: c.body.version as number, workspaceId, ids };
}

async function state(h: Harness, id: string) {
  const { rows } = await h.pool.query(
    `SELECT d.version::int AS version, d.graph, d.presentation,
            (SELECT count(*) FROM diagram_revisions WHERE diagram_id = $1)::int AS revisions,
            (SELECT count(*) FROM command_executions WHERE diagram_id = $1)::int AS executions
       FROM diagrams d WHERE d.id = $1`,
    [id],
  );
  return rows[0];
}

describe('history: listing', () => {
  let h: Harness;
  let u: TestUser;
  beforeAll(async () => {
    h = await startHarness();
    u = await h.newUser('historian');
  });
  afterAll(() => h.close());

  it('a new diagram has a baseline revision, structural edits add revisions, drags add none (version numbers have gaps)', async () => {
    const d = await seed(h, u);
    const drag = await call(h, u, 'PATCH', `/v1/diagrams/${d.id}/presentation`, { expectedVersion: d.version, nodePositions: { [d.ids[0]!]: { x: 500, y: 40 } } }, { 'idempotency-key': key() });
    expect(drag.status).toBe(200);
    const list = await call(h, u, 'GET', `/v1/diagrams/${d.id}/revisions`);
    expect(list.status).toBe(200);
    expect(revisionListResponseSchema.safeParse(list.body).success).toBe(true);
    expect(list.body.revisions.map((r: { version: number; reason: string }) => [r.version, r.reason])).toEqual([[4, 'MANUAL_COMMAND'], [3, 'MANUAL_COMMAND'], [2, 'MANUAL_COMMAND'], [1, 'CHECKPOINT']]);
    expect(list.body.revisions[0]).toMatchObject({ nodeCount: 2, edgeCount: 1 });
    expect(list.body.revisions[3]).toMatchObject({ nodeCount: 0, edgeCount: 0 });
    expect(list.body.nextBefore).toBeNull();
    expect(list.body.retention).toEqual({ keepLatest: 100, hourlyDays: 7, keepDays: 90 });
  });

  it('pages newest first with a continuation cursor', async () => {
    const d = await seed(h, u);
    const first = await call(h, u, 'GET', `/v1/diagrams/${d.id}/revisions?limit=2`);
    expect(first.body.revisions.map((r: { version: number }) => r.version)).toEqual([4, 3]);
    expect(first.body.nextBefore).toBe(3);
    const second = await call(h, u, 'GET', `/v1/diagrams/${d.id}/revisions?limit=2&before=${first.body.nextBefore}`);
    expect(second.body.revisions.map((r: { version: number }) => r.version)).toEqual([2, 1]);
    expect(second.body.nextBefore).toBeNull();
    expect((await call(h, u, 'GET', `/v1/diagrams/${d.id}/revisions?limit=0`)).status).toBe(400);
    expect((await call(h, u, 'GET', `/v1/diagrams/${d.id}/revisions?limit=101`)).status).toBe(400);
    expect((await call(h, u, 'GET', `/v1/diagrams/${d.id}/revisions?bogus=1`)).status).toBe(400);
  });

  it('one revision can be read with its document; an unknown one is 404', async () => {
    const d = await seed(h, u);
    const one = await call(h, u, 'GET', `/v1/diagrams/${d.id}/revisions/3`);
    expect(one.status).toBe(200);
    expect(revisionDetailSchema.safeParse(one.body).success).toBe(true);
    expect(one.body.graph.nodes.map((n: { name: string }) => n.name)).toEqual(['Orders', 'PostgreSQL']);
    expect(one.body.graph.edges).toHaveLength(0);
    expect((await call(h, u, 'GET', `/v1/diagrams/${d.id}/revisions/99`)).status).toBe(404);
    expect((await call(h, u, 'GET', `/v1/diagrams/${d.id}/revisions/abc`)).status).toBe(400);
  });

  it('who made a change is the display name only, never an email', async () => {
    const d = await seed(h, u);
    const list = await call(h, u, 'GET', `/v1/diagrams/${d.id}/revisions`);
    expect(JSON.stringify(list.body)).not.toContain('@');
  });
});

describe('history: restore as a new version', () => {
  let h: Harness;
  let u: TestUser;
  beforeAll(async () => {
    h = await startHarness();
    u = await h.newUser('restorer');
  });
  afterAll(() => h.close());

  it('the gate: restoring an older revision creates a NEW canonical version with that content, and the version never goes back', async () => {
    const d = await seed(h, u);
    const before = await state(h, d.id);
    const res = await restore(h, u, d.id, d.version, 3); // before the connection was made
    expect(res.status).toBe(200);
    expect(restoreResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.version).toBe(d.version + 1);
    expect(res.body.graph.edges).toHaveLength(0);
    expect(res.body.graph.nodes.map((n: { name: string }) => n.name)).toEqual(['Orders', 'PostgreSQL']);

    const after = await state(h, d.id);
    expect(after.version).toBe(before.version + 1);
    expect(after.revisions).toBe(before.revisions + 1);
    expect(after.executions).toBe(before.executions + 1);
    const { rows } = await h.pool.query(`SELECT reason FROM diagram_revisions WHERE diagram_id = $1 AND version = $2`, [d.id, after.version]);
    expect(rows[0].reason).toBe('RESTORE');
    const exec = await h.pool.query(`SELECT command_type, command_payload FROM command_executions WHERE diagram_id = $1 ORDER BY created_at DESC LIMIT 1`, [d.id]);
    expect(exec.rows[0]).toMatchObject({ command_type: 'RESTORE', command_payload: { restoredVersion: 3 } });

    // The old revisions are still there, and the restored content is itself restorable (redo).
    const list = await call(h, u, 'GET', `/v1/diagrams/${d.id}/revisions`);
    expect(list.body.revisions.map((r: { version: number }) => r.version)).toEqual([5, 4, 3, 2, 1]);
    const redo = await restore(h, u, d.id, 5, 4);
    expect(redo.status).toBe(200);
    expect(redo.body.version).toBe(6);
    expect(redo.body.graph.edges).toHaveLength(1);
  });

  it('can go all the way back to the empty baseline', async () => {
    const d = await seed(h, u);
    const res = await restore(h, u, d.id, d.version, 1);
    expect(res.status).toBe(200);
    expect(res.body.graph.nodes).toHaveLength(0);
    expect(res.body.version).toBe(d.version + 1);
  });

  it('an exact retry replays the stored result and does not create another version; the same key with other input is refused', async () => {
    const d = await seed(h, u);
    const k = key();
    const first = await restore(h, u, d.id, d.version, 3, k);
    const again = await restore(h, u, d.id, d.version, 3, k);
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.version).toBe(first.body.version);
    expect((await state(h, d.id)).version).toBe(d.version + 1);
    const reused = await restore(h, u, d.id, d.version, 2, k);
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a stale expectedVersion conflicts and changes nothing; so does an unknown or already-current target', async () => {
    const d = await seed(h, u);
    const before = await state(h, d.id);
    const stale = await restore(h, u, d.id, d.version - 1, 2);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('DIAGRAM_VERSION_CONFLICT');
    const missing = await restore(h, u, d.id, d.version, 99);
    expect(missing.status).toBe(422);
    expect(missing.body.error.details.reason).toBe('REVISION_NOT_FOUND');
    const same = await restore(h, u, d.id, d.version, d.version); // the head itself
    expect(same.status).toBe(422);
    expect(same.body.error.details.reason).toBe('ALREADY_CURRENT');
    expect(await state(h, d.id)).toEqual(before);
  });

  it('two restores from the same version: exactly one wins', async () => {
    const d = await seed(h, u);
    const [a, b] = await Promise.all([restore(h, u, d.id, d.version, 3), restore(h, u, d.id, d.version, 2)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await state(h, d.id)).version).toBe(d.version + 1);
  });

  it('restoring after a drag brings back the positions of that revision', async () => {
    const d = await seed(h, u);
    await call(h, u, 'PATCH', `/v1/diagrams/${d.id}/presentation`, { expectedVersion: d.version, nodePositions: { [d.ids[0]!]: { x: 900, y: 900 } } }, { 'idempotency-key': key() });
    const head = (await state(h, d.id)).version;
    const res = await restore(h, u, d.id, head, d.version);
    expect(res.status).toBe(200);
    expect(res.body.presentation.nodePositions[d.ids[0]!]).not.toEqual({ x: 900, y: 900 });
  });
});

describe('history: access', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());

  it('strangers get 404, no token 401, viewers may read history but not restore, editors may restore', async () => {
    const owner = await h.newUser('owner');
    const d = await seed(h, owner);
    const stranger = await h.newUser('stranger');
    expect((await call(h, stranger, 'GET', `/v1/diagrams/${d.id}/revisions`)).status).toBe(404);
    expect((await call(h, stranger, 'GET', `/v1/diagrams/${d.id}/revisions/2`)).status).toBe(404);
    expect((await restore(h, stranger, d.id, d.version, 2)).status).toBe(404);
    expect((await call(h, null, 'GET', `/v1/diagrams/${d.id}/revisions`)).status).toBe(401);
    expect((await restore(h, null, d.id, d.version, 2)).status).toBe(401);

    const member = await h.newUser('member');
    await call(h, member, 'GET', '/v1/me');
    const grant = (role: string) =>
      h.pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role) SELECT $1, id, $3 FROM users WHERE external_auth_id = $2
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [d.workspaceId, member.subject, role],
      );
    await grant('VIEWER');
    const before = await state(h, d.id);
    expect((await call(h, member, 'GET', `/v1/diagrams/${d.id}/revisions`)).status).toBe(200);
    expect((await call(h, member, 'GET', `/v1/diagrams/${d.id}/revisions/2`)).status).toBe(200);
    expect((await restore(h, member, d.id, d.version, 2)).status).toBe(403);
    expect(await state(h, d.id)).toEqual(before);
    await grant('EDITOR');
    expect((await restore(h, member, d.id, d.version, 2)).status).toBe(200);
  });

  it('a deleted diagram has no readable history', async () => {
    const u = await h.newUser('deleter');
    const d = await seed(h, u);
    await call(h, u, 'DELETE', `/v1/diagrams/${d.id}?expectedVersion=${d.version}`, undefined, { 'idempotency-key': key() });
    expect((await call(h, u, 'GET', `/v1/diagrams/${d.id}/revisions`)).status).toBe(404);
    expect((await restore(h, u, d.id, d.version + 1, 2)).status).toBe(404);
  });
});

describe('history: atomicity', () => {
  it('a failure after the revision insert rolls the restore back completely, and the same key can be retried', async () => {
    let failOnce = false;
    const h = await startHarness({
      hooks: {
        fault: (stage) => {
          if (stage === 'after-revision' && failOnce) {
            failOnce = false;
            throw new Error('injected');
          }
        },
      },
    });
    try {
      const u = await h.newUser('atomic');
      const d = await seed(h, u);
      failOnce = true; // the seed's own commands must not trip it; arm it now
      const before = await state(h, d.id);
      const k = key();
      expect((await restore(h, u, d.id, d.version, 3, k)).status).toBe(500);
      expect(await state(h, d.id)).toEqual(before); // nothing leaked
      const retry = await restore(h, u, d.id, d.version, 3, k);
      expect(retry.status).toBe(200);
      expect((await state(h, d.id)).version).toBe(d.version + 1);
    } finally {
      await h.close();
    }
  });
});
