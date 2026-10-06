import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import { VOICE_CLOSE, VOICE_PATH, voiceServerMessageSchema } from '@tinker/shared';
import { createFakeProvider } from '../../src/modules/ai/providers/fake.ts';
import { ProviderError } from '../../src/modules/ai/providers/types.ts';
import { createFakeLive, type FakeLive, type FakeLiveSession } from '../../src/modules/voice/fake-live.ts';
import { call, cmd, createDiagramFor, startHarness, type Harness, type TestUser } from '../support/harness.ts';

const ORIGIN = 'http://localhost:5173';
type Msg = { type: string; [k: string]: any };

/** A WebSocket test client that records every server message (validated against the contract). */
class Client {
  messages: Msg[] = [];
  closed: Promise<{ code: number }>;
  private listeners: Array<() => void> = [];
  constructor(readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => ws.on('close', (code: number) => resolve({ code })));
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString('utf8'));
      const parsed = voiceServerMessageSchema.safeParse(msg);
      if (!parsed.success) throw new Error(`server sent a message outside the contract: ${data.toString('utf8')}`);
      this.messages.push(msg);
      for (const l of this.listeners.splice(0)) l();
    });
  }
  static async connect(h: Harness, origin: string | undefined = ORIGIN): Promise<Client> {
    const ws = await h.app.injectWS(VOICE_PATH, { headers: origin ? { origin } : {} });
    return new Client(ws as unknown as WebSocket);
  }
  send(message: unknown) {
    this.ws.send(JSON.stringify(message));
  }
  audio(bytes = 3200) {
    this.ws.send(Buffer.alloc(bytes));
  }
  /** Wait for a message that is already here or arrives soon. */
  async until(predicate: (m: Msg) => boolean, timeoutMs = 3000): Promise<Msg> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find(predicate);
      if (found) return found;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out; received: ${JSON.stringify(this.messages.map((m) => m.type))}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.listeners.push(() => (clearTimeout(timer), resolve()));
      });
    }
  }
  type = (t: string) => this.until((m) => m.type === t);
  results = () => this.messages.filter((m) => m.type === 'result').map((m) => m.result);
  close() {
    this.ws.close();
  }
}

async function until(condition: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function seed(h: Harness, u: TestUser) {
  const { diagram, workspaceId } = await createDiagramFor(h, u, 'Voice test');
  const id = diagram.diagramId;
  let version = 1;
  const ids: string[] = [];
  for (const [name, kind] of [['Orders', 'SERVICE'], ['PostgreSQL', 'DATABASE']] as const) {
    const r = await cmd(id, u, h, version, { type: 'ADD_NODE', node: { name, kind } });
    version = r.body.version;
    ids.push((r.body.graph.nodes as Array<{ id: string }>).at(-1)!.id);
  }
  const c = await cmd(id, u, h, version, { type: 'CONNECT', sourceNodeId: ids[0]!, targetNodeId: ids[1]!, relationship: 'SQL' });
  return { id, version: c.body.version as number, workspaceId };
}

async function dbState(h: Harness, id: string) {
  const { rows } = await h.pool.query(
    `SELECT d.version::int AS version, jsonb_array_length(d.graph->'nodes')::int AS nodes,
            (SELECT count(*) FROM diagram_revisions WHERE diagram_id = $1)::int AS revisions,
            (SELECT count(*) FROM command_executions WHERE diagram_id = $1)::int AS executions
       FROM diagrams d WHERE d.id = $1`,
    [id],
  );
  return rows[0] as { version: number; nodes: number; revisions: number; executions: number };
}

interface Setup {
  h: Harness;
  live: FakeLive;
  u: TestUser;
  d: Awaited<ReturnType<typeof seed>>;
}

/** Connect, say hello, start listening. Returns the client and the provider-side session. */
async function listen(s: Setup, opts: { version?: number } = {}): Promise<{ c: Client; model: FakeLiveSession }> {
  const c = await Client.connect(s.h);
  c.send({ type: 'hello', token: s.u.token, diagramId: s.d.id, version: opts.version ?? s.d.version });
  await c.type('ready');
  c.send({ type: 'start' });
  await c.type('listening');
  return { c, model: s.live.sessions.at(-1)! };
}

describe('voice: the gate', () => {
  let h: Harness;
  let live: FakeLive;
  let u: TestUser;
  beforeAll(async () => {
    live = createFakeLive();
    h = await startHarness({ liveGateway: live });
    u = await h.newUser('speaker');
  });
  afterAll(() => h.close());

  it('spoken insertion works: audio in, transcript out, ONE atomic edit through the typed-command service', async () => {
    const d = await seed(h, u);
    const { c, model } = await listen({ h, live, u, d });
    const before = await dbState(h, d.id);
    c.audio();
    c.audio();
    await until(() => model.audio.length === 2);
    expect(model.options.componentNames).toEqual(['Orders', 'PostgreSQL']);

    model.say('put redis between', false);
    const partial = await c.until((m) => m.type === 'transcript' && m.final === false);
    expect(partial.text).toBe('put redis between');
    expect(await dbState(h, d.id)).toMatchObject({ version: d.version, nodes: 2 }); // a partial transcript never mutates

    model.say('Put Redis between Orders and PostgreSQL', true);
    model.call({ id: 'call-1', name: 'edit_diagram', args: { request: 'Put Redis between Orders and PostgreSQL' } });
    const proposal = await c.type('proposal');
    expect(proposal).toMatchObject({ kind: 'EDIT', request: 'Put Redis between Orders and PostgreSQL' });
    await c.until((m) => m.type === 'result');

    const [result] = c.results();
    expect(result).toMatchObject({ status: 'OK', kind: 'EDIT', operationId: proposal.operationId });
    expect(result.response).toMatchObject({ status: 'APPLIED', source: 'PARSER', diagram: { version: d.version + 1 } });
    expect(result.response.diagram.graph.nodes.map((n: { name: string }) => n.name)).toEqual(['Orders', 'PostgreSQL', 'Redis']);
    expect(await dbState(h, d.id)).toMatchObject({ version: d.version + 1, nodes: 3, revisions: before.revisions + 1, executions: before.executions + 1 });
    expect(model.toolResponses).toEqual([{ id: 'call-1', name: 'edit_diagram', result: expect.stringContaining('Inserted Redis between Orders and PostgreSQL') }]);

    // The conversation shows the voice turn like a typed one.
    const convo = await call(h, u, 'GET', `/v1/diagrams/${d.id}/conversation`);
    expect(convo.body.messages.map((m: { role: string }) => m.role)).toEqual(['USER', 'ASSISTANT']);
    c.close();
  });

  it('a repeated tool call id is applied once (duplicate events), also while the first is still running', async () => {
    const d = await seed(h, u);
    const { c, model } = await listen({ h, live, u, d });
    const edit = { id: 'dup-1', name: 'edit_diagram', args: { request: 'add a cache' } };
    model.call(edit, edit);
    model.call(edit);
    await c.until((m) => m.type === 'result');
    model.call(edit); // and again after it finished
    await new Promise((r) => setTimeout(r, 150));
    expect(c.results()).toHaveLength(1);
    expect(c.messages.filter((m) => m.type === 'proposal')).toHaveLength(1);
    expect(await dbState(h, d.id)).toMatchObject({ version: d.version + 1, nodes: 3 });
    c.close();
  });

  it('the proposal is bound to the diagram version the client reported; a stale one changes nothing', async () => {
    const d = await seed(h, u);
    const { c, model } = await listen({ h, live, u, d }, { version: d.version - 1 });
    model.call({ id: 'stale', name: 'edit_diagram', args: { request: 'add a cache' } });
    await c.until((m) => m.type === 'result');
    expect(c.results()[0]).toMatchObject({ status: 'ERROR', kind: 'EDIT', error: { code: 'DIAGRAM_VERSION_CONFLICT' } });
    expect(await dbState(h, d.id)).toMatchObject({ version: d.version, nodes: 2 });

    c.send({ type: 'context', version: d.version }); // the client caught up
    await new Promise((r) => setTimeout(r, 60)); // (the model's call is injected directly, so let the message arrive first)
    model.call({ id: 'fresh', name: 'edit_diagram', args: { request: 'add a cache' } });
    await c.until(() => c.results().length >= 2);
    expect(c.results()[1]).toMatchObject({ status: 'OK' });
    expect(await dbState(h, d.id)).toMatchObject({ version: d.version + 1, nodes: 3 });
    c.close();
  });

  it('questions by voice are advice: the answer comes back and nothing is written', async () => {
    const d = await seed(h, u);
    const { c, model } = await listen({ h, live, u, d });
    const before = await dbState(h, d.id);
    model.call({ id: 'q1', name: 'ask_about_diagram', args: { question: 'What happens if Orders goes down?' } });
    await c.until((m) => m.type === 'result');
    const [r] = c.results();
    expect(r).toMatchObject({ status: 'OK', kind: 'ASK', response: { source: 'ANALYZER' } });
    expect(r.response.analysis.downstreamNodeIds).toHaveLength(1);
    expect(await dbState(h, d.id)).toEqual(before);
    c.close();
  });

  it('invalid, unknown and oversized tool calls are refused without touching the diagram', async () => {
    const d = await seed(h, u);
    const { c, model } = await listen({ h, live, u, d });
    model.call({ id: 'a', name: 'drop_database', args: {} }, { id: 'b', name: 'edit_diagram', args: { request: 42 } }, { id: 'c', name: 'edit_diagram', args: { request: 'x'.repeat(9000) } });
    await c.until(() => c.results().length >= 3);
    expect(c.results().every((r) => r.status === 'ERROR' && r.error.code === 'INVALID_REQUEST')).toBe(true);
    expect(await dbState(h, d.id)).toMatchObject({ version: d.version });
    c.close();
  });

  it('more proposals than the limit are refused, the rest run in order', async () => {
    const d = await seed(h, u);
    const { c, model } = await listen({ h, live, u, d });
    const calls = [1, 2, 3, 4, 5].map((n) => ({ id: `m${n}`, name: 'ask_about_diagram', args: { question: `question ${n}?` } }));
    model.call(...calls);
    await c.until(() => c.results().length >= 5);
    const codes = c.results().map((r) => (r.status === 'ERROR' ? r.error.code : 'OK'));
    expect(codes.filter((x) => x === 'RATE_LIMITED')).toHaveLength(2);
    expect(codes.filter((x) => x === 'OK')).toHaveLength(3);
    c.close();
  });
});

describe('voice: connection, identity and lifecycle', () => {
  let h: Harness;
  let live: FakeLive;
  let u: TestUser;
  beforeAll(async () => {
    live = createFakeLive();
    h = await startHarness({ liveGateway: live, voiceLimits: { helloTimeoutMs: 200, tickMs: 25, authCheckMs: 50, idleMs: 400 } });
    u = await h.newUser('lifecycle');
  });
  afterAll(() => h.close());

  it('refuses a connection from an origin that is not allowed (or has none)', async () => {
    for (const headers of [{ origin: 'https://evil.example' }, {}]) {
      const res = await h.app.inject({ method: 'GET', url: VOICE_PATH, headers });
      expect(res.statusCode).toBe(403);
    }
  });

  it('the first message must be a valid hello; anything else closes the connection', async () => {
    const wrong = await Client.connect(h);
    wrong.send({ type: 'start' });
    expect((await wrong.closed).code).toBe(VOICE_CLOSE.BAD_PROTOCOL);

    const junk = await Client.connect(h);
    junk.ws.send('not json');
    expect((await junk.closed).code).toBe(VOICE_CLOSE.BAD_PROTOCOL);

    const silent = await Client.connect(h);
    expect((await silent.closed).code).toBe(VOICE_CLOSE.BAD_PROTOCOL); // helloTimeoutMs
  });

  it('bad credentials, unknown diagram and strangers are told apart only by close code, never by detail', async () => {
    const d = await seed(h, u);
    const bad = await Client.connect(h);
    bad.send({ type: 'hello', token: 'x'.repeat(40), diagramId: d.id, version: 1 });
    expect((await bad.closed).code).toBe(VOICE_CLOSE.UNAUTHENTICATED);

    const stranger = await h.newUser('stranger');
    const c = await Client.connect(h);
    c.send({ type: 'hello', token: stranger.token, diagramId: d.id, version: 1 });
    expect((await c.closed).code).toBe(VOICE_CLOSE.NOT_FOUND);
  });

  it('a newer session for the same user replaces the older one', async () => {
    const d = await seed(h, u);
    const first = await Client.connect(h);
    first.send({ type: 'hello', token: u.token, diagramId: d.id, version: d.version });
    await first.type('ready');
    const second = await Client.connect(h);
    second.send({ type: 'hello', token: u.token, diagramId: d.id, version: d.version });
    await second.type('ready');
    expect((await first.closed).code).toBe(VOICE_CLOSE.REPLACED);
    second.close();
  });

  it('losing the model connection does not break the session or manual editing; start can be repeated', async () => {
    const d = await seed(h, u);
    const { c, model } = await listen({ h, live, u, d });
    model.drop();
    const error = await c.until((m) => m.type === 'error');
    expect(error).toMatchObject({ code: 'AI_UNAVAILABLE', fatal: false });
    // manual editing is untouched
    const manual = await cmd(d.id, u, h, d.version, { type: 'ADD_NODE', node: { name: 'Cache', kind: 'CACHE' } });
    expect(manual.status).toBe(200);
    // and voice can be started again
    c.send({ type: 'context', version: manual.body.version });
    c.send({ type: 'start' });
    await c.until((m) => m.type === 'listening' && c.messages.indexOf(m) > c.messages.indexOf(error));
    expect(live.sessions.at(-1)).not.toBe(model);
    c.close();
  });

  it('a failed model start is reported (not fatal) and a retry works', async () => {
    const d = await seed(h, u);
    const c = await Client.connect(h);
    c.send({ type: 'hello', token: u.token, diagramId: d.id, version: d.version });
    await c.type('ready');
    live.failNext(new ProviderError('unavailable', 'nope'));
    c.send({ type: 'start' });
    expect(await c.type('error')).toMatchObject({ code: 'AI_UNAVAILABLE', fatal: false });
    c.send({ type: 'start' });
    await c.type('listening');
    c.close();
  });

  it('reconnecting never replays committed commands: a new session starts clean and the diagram is as it was', async () => {
    const d = await seed(h, u);
    const first = await listen({ h, live, u, d });
    first.model.call({ id: 'same-id', name: 'edit_diagram', args: { request: 'add a cache' } });
    await first.c.until((m) => m.type === 'result');
    const after = await dbState(h, d.id);
    expect(after.version).toBe(d.version + 1);
    first.c.close();
    await first.c.closed;

    const second = await listen({ h, live, u, d }, { version: after.version });
    await new Promise((r) => setTimeout(r, 100));
    expect(second.c.results()).toHaveLength(0); // nothing was replayed to the new session
    expect(await dbState(h, d.id)).toEqual(after);
    second.c.close();
  });

  it('a session that is quiet for too long is closed', async () => {
    const d = await seed(h, u);
    const c = await Client.connect(h);
    c.send({ type: 'hello', token: u.token, diagramId: d.id, version: d.version });
    await c.type('ready');
    expect((await c.closed).code).toBe(VOICE_CLOSE.IDLE);
  });

  it('stop finishes pending work, then releases the model session', async () => {
    const d = await seed(h, u);
    const { c, model } = await listen({ h, live, u, d });
    model.call({ id: 's1', name: 'edit_diagram', args: { request: 'add a cache' } });
    c.send({ type: 'stop' });
    await c.until((m) => m.type === 'result');
    await new Promise((r) => setTimeout(r, 60));
    expect(model.audioEnded).toBe(true);
    expect(model.closed).toBe(true);
    expect(await dbState(h, d.id)).toMatchObject({ version: d.version + 1 });
    c.close();
  });

  it('cancel drops proposals that have not started', async () => {
    const d = await seed(h, u);
    const slow = createFakeProvider([{ output: { outcome: 'CLARIFY', question: 'which?' }, delayMs: 250 }]);
    const live2 = createFakeLive();
    const h2 = await startHarness({ liveGateway: live2, aiProvider: slow });
    try {
      const u2 = await h2.newUser('canceller');
      const d2 = await seed(h2, u2);
      const { c, model } = await listen({ h: h2, live: live2, u: u2, d: d2 });
      model.call({ id: 'x1', name: 'edit_diagram', args: { request: 'make things better somehow' } }, { id: 'x2', name: 'edit_diagram', args: { request: 'add a cache' } });
      await c.type('proposal');
      c.send({ type: 'cancel' });
      await c.until(() => c.results().length >= 2);
      expect(c.results().some((r) => r.status === 'ERROR' && r.error.message === 'Cancelled.')).toBe(true);
      expect(await dbState(h2, d2.id)).toMatchObject({ version: d2.version }); // the cancelled "add a cache" never ran
      c.close();
    } finally {
      await h2.close();
    }
    void d;
  });
});

describe('voice: permissions, expiry and limits', () => {
  let h: Harness;
  let live: FakeLive;
  beforeAll(async () => {
    live = createFakeLive();
    h = await startHarness({ liveGateway: live, voiceLimits: { tickMs: 25, authCheckMs: 50, maxSessionMs: 6000, idleMs: 5000 } });
  });
  afterAll(() => h.close());

  const grant = async (workspaceId: string, user: TestUser, role: 'EDITOR' | 'VIEWER') => {
    await call(h, user, 'GET', '/v1/me');
    await h.pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) SELECT $1, id, $3 FROM users WHERE external_auth_id = $2
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [workspaceId, user.subject, role],
    );
  };

  it('revoking access ends the session; downgrading to viewer keeps questions but refuses edits', async () => {
    const owner = await h.newUser('owner');
    const member = await h.newUser('member');
    const d = await seed(h, owner);
    await grant(d.workspaceId, member, 'EDITOR');
    const { c, model } = await listen({ h, live, u: member, d });

    await h.pool.query(`UPDATE workspace_memberships SET role = 'VIEWER' WHERE workspace_id = $1 AND user_id = (SELECT id FROM users WHERE external_auth_id = $2)`, [d.workspaceId, member.subject]);
    model.call({ id: 'v1', name: 'edit_diagram', args: { request: 'add a cache' } }, { id: 'v2', name: 'ask_about_diagram', args: { question: 'what is connected?' } });
    await c.until(() => c.results().length >= 2);
    const [edit, ask] = c.results();
    expect(edit).toMatchObject({ status: 'ERROR', error: { code: 'FORBIDDEN' } });
    expect(ask).toMatchObject({ status: 'OK', kind: 'ASK' });
    expect(await dbState(h, d.id)).toMatchObject({ version: d.version });

    await h.pool.query(`DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = (SELECT id FROM users WHERE external_auth_id = $2)`, [d.workspaceId, member.subject]);
    expect((await c.closed).code).toBe(VOICE_CLOSE.NOT_FOUND);
    expect(model.closed).toBe(true);
  });

  it('a token that expires ends the session; refreshing it with an auth message keeps the session open', async () => {
    const short = await h.newUser('short');
    const shortToken = await h.signer.sign({ subject: short.subject, email: `${short.subject}@example.test` }, 2);
    const d = await seed(h, short);

    const expiring = await Client.connect(h);
    expiring.send({ type: 'hello', token: shortToken, diagramId: d.id, version: d.version });
    await expiring.type('ready');
    expect((await expiring.closed).code).toBe(VOICE_CLOSE.UNAUTHENTICATED);

    const refreshed = await Client.connect(h);
    refreshed.send({ type: 'hello', token: shortToken, diagramId: d.id, version: d.version });
    await refreshed.type('ready');
    refreshed.send({ type: 'auth', token: await h.signer.sign({ subject: short.subject, email: `${short.subject}@example.test` }, 60) });
    await new Promise((r) => setTimeout(r, 2600));
    refreshed.send({ type: 'ping' });
    await refreshed.type('pong');
    refreshed.close();

    const other = await h.newUser('other-user');
    const hijack = await Client.connect(h);
    hijack.send({ type: 'hello', token: shortToken, diagramId: d.id, version: d.version });
    await hijack.type('ready');
    hijack.send({ type: 'auth', token: other.token });
    expect((await hijack.closed).code).toBe(VOICE_CLOSE.UNAUTHENTICATED); // credentials of someone else
  }, 15000);

  it('a session has a maximum duration', async () => {
    const h2 = await startHarness({ liveGateway: createFakeLive(), voiceLimits: { tickMs: 25, maxSessionMs: 300 } });
    try {
      const u = await h2.newUser('long');
      const d = await seed(h2, u);
      const c = await Client.connect(h2);
      c.send({ type: 'hello', token: u.token, diagramId: d.id, version: d.version });
      await c.type('ready');
      expect((await c.closed).code).toBe(VOICE_CLOSE.MAX_DURATION);
    } finally {
      await h2.close();
    }
  });

  it('audio is bounded: bad frame sizes and faster-than-real-time streams close the session', async () => {
    const u = await h.newUser('flood');
    const d = await seed(h, u);
    const odd = await listen({ h, live, u, d });
    odd.c.ws.send(Buffer.alloc(3));
    expect((await odd.c.closed).code).toBe(VOICE_CLOSE.BAD_PROTOCOL);

    const huge = await listen({ h, live, u, d });
    huge.c.ws.send(Buffer.alloc(40_000));
    expect((await huge.c.closed).code).toBe(1009); // larger than the WebSocket payload limit

    const flood = await listen({ h, live, u, d });
    for (let i = 0; i < 60; i++) flood.c.audio(16_000);
    expect((await flood.c.closed).code).toBe(VOICE_CLOSE.QUOTA);
  });

  it('backpressure towards the model: frames are dropped, then the session is closed', async () => {
    const u = await h.newUser('slowlink');
    const d = await seed(h, u);
    const { c, model } = await listen({ h, live, u, d });
    model.buffered = 2_000_000;
    c.audio();
    c.audio();
    await new Promise((r) => setTimeout(r, 60));
    expect(model.audio).toHaveLength(0);
    model.buffered = 5_000_000;
    c.audio();
    expect((await c.closed).code).toBe(VOICE_CLOSE.QUOTA);
  });

  it('audio sent before start (or after stop) is ignored, not forwarded', async () => {
    const u = await h.newUser('early');
    const d = await seed(h, u);
    const c = await Client.connect(h);
    c.send({ type: 'hello', token: u.token, diagramId: d.id, version: d.version });
    await c.type('ready');
    const before = live.sessions.length;
    c.audio();
    c.send({ type: 'ping' });
    await c.type('pong');
    expect(live.sessions).toHaveLength(before); // no model session was opened by stray audio
    c.close();
  });
});

describe('voice: not configured', () => {
  it('without a key the session connects, start says voice is unavailable, and /v1/me says so', async () => {
    const h = await startHarness({});
    try {
      const u = await h.newUser('nokey');
      const d = await seed(h, u);
      expect((await call(h, u, 'GET', '/v1/me')).body.features.voice).toBe(false);
      const c = await Client.connect(h);
      c.send({ type: 'hello', token: u.token, diagramId: d.id, version: d.version });
      await c.type('ready');
      c.send({ type: 'start' });
      expect(await c.type('error')).toMatchObject({ code: 'AI_UNAVAILABLE', fatal: false });
      expect((await cmd(d.id, u, h, d.version, { type: 'ADD_NODE', node: { name: 'Cache', kind: 'CACHE' } })).status).toBe(200);
      c.close();
    } finally {
      await h.close();
    }
  });

  it('/v1/me advertises voice when a gateway is configured', async () => {
    const h = await startHarness({ liveGateway: createFakeLive() });
    try {
      const u = await h.newUser('withkey');
      expect((await call(h, u, 'GET', '/v1/me')).body.features.voice).toBe(true);
    } finally {
      await h.close();
    }
  });
});
