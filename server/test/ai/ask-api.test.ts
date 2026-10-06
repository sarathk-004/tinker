import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiAskResponseSchema, conversationResponseSchema } from '@tinker/shared';
import { createFakeProvider } from '../../src/modules/ai/providers/fake.ts';
import { ProviderError } from '../../src/modules/ai/providers/types.ts';
import { call, cmd, createDiagramFor, startHarness, type Harness, type TestUser } from '../support/harness.ts';

/** Web Client -> Orders -> PostgreSQL, built through the ordinary manual command path. */
async function seed(h: Harness, u: TestUser) {
  const { diagram, workspaceId } = await createDiagramFor(h, u, 'Advice test');
  const id = diagram.diagramId;
  let version = 1;
  const nodeIds: string[] = [];
  for (const [name, kind] of [['Web Client', 'CLIENT'], ['Orders', 'SERVICE'], ['PostgreSQL', 'DATABASE']] as const) {
    const r = await cmd(id, u, h, version, { type: 'ADD_NODE', node: { name, kind } });
    version = r.body.version;
    nodeIds.push((r.body.graph.nodes as Array<{ id: string }>).at(-1)!.id);
  }
  for (const [a, b] of [[0, 1], [1, 2]] as const) {
    const r = await cmd(id, u, h, version, { type: 'CONNECT', sourceNodeId: nodeIds[a]!, targetNodeId: nodeIds[b]! });
    version = r.body.version;
  }
  return { id, version, workspaceId, web: nodeIds[0]!, orders: nodeIds[1]!, pg: nodeIds[2]! };
}

const ask = (h: Harness, u: TestUser | null, diagramId: string, question: string, conversationId?: string) =>
  call(h, u, 'POST', `/v1/diagrams/${diagramId}/ai/ask`, { question, ...(conversationId ? { conversationId } : {}) });

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

describe('the gate: read-only advice', () => {
  let h: Harness;
  let u: TestUser;
  const provider = createFakeProvider([{ output: { answer: 'Orders feeds PostgreSQL, and the Web Client depends on Orders, so both are affected.', highlight: ['n2', 'n3', 'n1', 'n42'] } }]);
  beforeAll(async () => {
    h = await startHarness({ aiProvider: provider });
    u = await h.newUser('asker');
  });
  afterAll(() => h.close());

  it('"What happens if Orders goes down?" explains the computed dependencies and changes nothing', async () => {
    const d = await seed(h, u);
    const before = await state(h, d.id);
    const res = await ask(h, u, d.id, 'What happens if Orders goes down?');
    expect(res.status).toBe(200);
    expect(aiAskResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.source).toBe('AI');
    expect(res.body.answer).toContain('Orders');
    expect(res.body.analysis.focusNodeIds).toEqual([d.orders]);
    expect(res.body.analysis.downstreamNodeIds).toEqual([d.pg]);
    expect(res.body.analysis.upstreamNodeIds).toEqual([d.web]);
    expect([...res.body.analysis.affectedNodeIds].sort()).toEqual([d.orders, d.pg, d.web].sort()); // the invented "n42" is dropped
    expect(res.body.diagram).toEqual({ id: d.id, version: d.version });
    // The facts the model saw were computed by the server.
    expect(provider.calls.at(-1)!.content).toContain('n2 downstream=[n3] upstream=[n1]');
    // Read-only: version, graph, presentation, revisions and executions are untouched.
    expect(await state(h, d.id)).toEqual(before);
  });

  it("stores the turn in the caller's conversation, and a follow-up continues it", async () => {
    const d = await seed(h, u);
    const first = await ask(h, u, d.id, 'What happens if Orders goes down?');
    const second = await ask(h, u, d.id, 'And the database?', first.body.conversationId);
    expect(second.body.conversationId).toBe(first.body.conversationId);
    const convo = await call(h, u, 'GET', `/v1/diagrams/${d.id}/conversation`);
    expect(conversationResponseSchema.safeParse(convo.body).success).toBe(true);
    expect(convo.body.messages.map((m: { role: string }) => m.role)).toEqual(['USER', 'ASSISTANT', 'USER', 'ASSISTANT']);
    expect(convo.body.messages[1].metadata).toMatchObject({ status: 'ADVICE', source: 'AI', diagramVersion: d.version });
    expect(provider.calls.at(-1)!.content).toContain('USER: What happens if Orders goes down?'); // bounded history reached the model
  });

  it('a provider failure still answers, computed from the same facts', async () => {
    const down = createFakeProvider([{ error: new ProviderError('unavailable', 'boom') }]);
    const h2 = await startHarness({ aiProvider: down });
    try {
      const u2 = await h2.newUser('fallback');
      const d = await seed(h2, u2);
      const res = await ask(h2, u2, d.id, 'What happens if Orders goes down?');
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('ANALYZER');
      expect(res.body.answer).toContain('If Orders goes down');
      expect(res.body.analysis.downstreamNodeIds).toEqual([d.pg]);
    } finally {
      await h2.close();
    }
  });

  it('invalid model output also falls back (never trusted, never an error)', async () => {
    const junk = createFakeProvider([{ output: { answer: 'ok', rm: '-rf' } }]);
    const h2 = await startHarness({ aiProvider: junk });
    try {
      const u2 = await h2.newUser('junk');
      const d = await seed(h2, u2);
      const res = await ask(h2, u2, d.id, 'what does orders feed?');
      expect(res.body.source).toBe('ANALYZER');
    } finally {
      await h2.close();
    }
  });

  it('works with no model configured at all', async () => {
    const h2 = await startHarness({});
    try {
      const u2 = await h2.newUser('nomodel');
      const d = await seed(h2, u2);
      const res = await ask(h2, u2, d.id, 'What happens if PostgreSQL goes down?');
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('ANALYZER');
      expect([...res.body.analysis.upstreamNodeIds].sort()).toEqual([d.web, d.orders].sort());
    } finally {
      await h2.close();
    }
  });

  it('authorization: strangers get 404, viewers may ask, unauthenticated gets 401, bad input 400', async () => {
    const d = await seed(h, u);
    const stranger = await h.newUser('stranger');
    expect((await ask(h, stranger, d.id, 'hello?')).status).toBe(404);
    expect((await ask(h, null, d.id, 'hello?')).status).toBe(401);
    expect((await ask(h, u, d.id, '   ')).status).toBe(400);
    expect((await call(h, u, 'POST', `/v1/diagrams/${d.id}/ai/ask`, { question: 'x', extra: 1 })).status).toBe(400);

    const viewer = await h.newUser('viewer');
    await call(h, viewer, 'GET', '/v1/me');
    await h.pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) SELECT $1, id, 'VIEWER' FROM users WHERE external_auth_id = $2`,
      [d.workspaceId, viewer.subject],
    );
    const before = await state(h, d.id);
    const res = await ask(h, viewer, d.id, 'What happens if Orders goes down?');
    expect(res.status).toBe(200);
    expect(await state(h, d.id)).toEqual(before);
  });

  it("someone else's conversation id is a 404", async () => {
    const d = await seed(h, u);
    const first = await ask(h, u, d.id, 'hello?');
    const other = await h.newUser('other');
    expect((await ask(h, other, d.id, 'hello?', first.body.conversationId)).status).toBe(404);
  });
});
