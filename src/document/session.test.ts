import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiCommandResponse, CommandResponse, DiagramCommand, DiagramDetail, Graph, Presentation } from '../contracts';
import { ApiError, type MutationSpec } from '../api/client';
import { ConflictError, RefusedError, SessionClosedError, createDocumentSession, newNodeIds, type SessionApi, type SessionStorage } from './session';

const DIAGRAM = '11111111-1111-4111-8111-111111111111';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A pretend server with real versioning and idempotency, plus knobs to inject failures and delays. */
function fakeServer() {
  const s = {
    version: 1,
    name: 'Test',
    graph: { schemaVersion: 1, nodes: [], edges: [] } as Graph,
    presentation: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } } as Presentation,
    nextId: 100,
    /** Every request that reached the server logic (after any injected failure), for assertions. */
    received: [] as MutationSpec[],
    stored: new Map<string, { status: 'ok'; result: unknown } | { status: 'error'; error: ApiError }>(),
    failures: [] as Array<ApiError | 'lost-response'>,
    gate: undefined as undefined | Promise<void>,
    loads: 0,
    /** Saved structural versions (what the real server keeps in diagram_revisions). Version 1 is the empty baseline. */
    revs: new Map<number, { graph: Graph; presentation: Presentation }>(),
  };
  s.revs.set(1, { graph: s.graph, presentation: s.presentation });
  const detail = (): DiagramDetail => ({ diagramId: DIAGRAM, workspaceId: uid(9), projectId: uid(8), name: s.name, version: s.version, graph: s.graph, presentation: s.presentation, updatedAt: '2026-01-01T00:00:00.000Z' });

  function apply(spec: MutationSpec): CommandResponse | DiagramDetail | AiCommandResponse {
    const body = spec.body as { expectedVersion: number; command?: DiagramCommand; name?: string; nodePositions?: Record<string, { x: number; y: number }>; viewport?: Presentation['viewport'] };
    if (body.expectedVersion !== s.version) throw new ApiError('DIAGRAM_VERSION_CONFLICT', 'conflict', 409, { expectedVersion: body.expectedVersion, currentVersion: s.version });
    if (spec.path.endsWith('/restore')) {
      const target = s.revs.get((spec.body as { version: number }).version);
      if (!target) throw new ApiError('DOMAIN_VALIDATION_FAILED', 'That version is not in the history (it may be older than the history window).', 422, { reason: 'REVISION_NOT_FOUND' });
      if (JSON.stringify(target.graph) === JSON.stringify(s.graph) && JSON.stringify(target.presentation) === JSON.stringify(s.presentation)) {
        throw new ApiError('DOMAIN_VALIDATION_FAILED', 'The diagram already looks like that version.', 422, { reason: 'ALREADY_CURRENT' });
      }
      s.graph = target.graph;
      s.presentation = target.presentation;
      s.version += 1;
      s.revs.set(s.version, { graph: s.graph, presentation: s.presentation });
      return detail();
    }
    if (spec.path.endsWith('/ai/command')) {
      const text = (spec.body as { input: { text: string } }).input.text;
      const msgs = (summary: string, status: string) => [
        { id: uid(800 + s.nextId), role: 'USER' as const, content: text, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: uid(801 + s.nextId), role: 'ASSISTANT' as const, content: summary, createdAt: '2026-01-01T00:00:01.000Z', metadata: { status } },
      ];
      if (text.startsWith('ask')) {
        return { status: 'CLARIFICATION', source: 'PARSER', question: 'Which one?', options: ['A', 'B'], conversationId: uid(700), messages: msgs('Which one?', 'CLARIFICATION'), diagram: { id: DIAGRAM, version: s.version } };
      }
      if (text === 'timeout') throw new ApiError('AI_TIMEOUT', "Couldn't interpret that command. Your diagram hasn't changed.", 504);
      if (text === 'refuse') throw new ApiError('DOMAIN_VALIDATION_FAILED', 'These nodes are already connected.', 422, { reason: 'DUPLICATE_EDGE' });
      const name = text.replace(/^add\s+/i, '');
      const id = uid(s.nextId++);
      s.graph = { ...s.graph, nodes: [...s.graph.nodes, { id, name, kind: 'SERVICE', metadata: {} }] };
      s.presentation = { ...s.presentation, nodePositions: { ...s.presentation.nodePositions, [id]: { x: 0, y: 0 } } };
      s.version += 1;
      s.revs.set(s.version, { graph: s.graph, presentation: s.presentation });
      return { status: 'APPLIED', source: 'PARSER', interpretation: { commands: [{ type: 'ADD_NODE', summary: `Added ${name}` }] }, conversationId: uid(700), messages: msgs(`Added ${name}.`, 'APPLIED'), diagram: { id: DIAGRAM, version: s.version, graph: s.graph, presentation: s.presentation } };
    }
    if (spec.path.endsWith('/commands')) {
      const c = body.command!;
      if (c.type === 'ADD_NODE') {
        const id = uid(s.nextId++);
        s.graph = { ...s.graph, nodes: [...s.graph.nodes, { id, name: c.node.name, kind: c.node.kind, metadata: {} }] };
        s.presentation = { ...s.presentation, nodePositions: { ...s.presentation.nodePositions, [id]: { x: 0, y: 0 } } };
      } else if (c.type === 'REMOVE_NODE') {
        if (!s.graph.nodes.some((n) => n.id === c.nodeId)) throw new ApiError('DOMAIN_VALIDATION_FAILED', 'That node does not exist.', 422, { reason: 'NODE_NOT_FOUND' });
        s.graph = { ...s.graph, nodes: s.graph.nodes.filter((n) => n.id !== c.nodeId) };
        const { [c.nodeId]: _gone, ...rest } = s.presentation.nodePositions;
        s.presentation = { ...s.presentation, nodePositions: rest };
      }
      s.version += 1;
      s.revs.set(s.version, { graph: s.graph, presentation: s.presentation });
      return { diagramId: DIAGRAM, version: s.version, appliedCommand: { type: c.type }, graph: s.graph, presentation: s.presentation };
    }
    if (spec.path.endsWith('/presentation')) {
      for (const id of Object.keys(body.nodePositions ?? {})) {
        if (!s.graph.nodes.some((n) => n.id === id)) throw new ApiError('DOMAIN_VALIDATION_FAILED', 'unknown node', 422, { reason: 'NODE_NOT_FOUND' });
      }
      s.presentation = { nodePositions: { ...s.presentation.nodePositions, ...(body.nodePositions ?? {}) }, viewport: body.viewport ?? s.presentation.viewport };
    } else {
      s.name = body.name!;
    }
    s.version += 1;
    return detail();
  }

  async function handle(spec: MutationSpec) {
    if (s.gate) await s.gate;
    const prior = s.stored.get(spec.idempotencyKey);
    const failure = s.failures.shift();
    if (failure instanceof ApiError) throw failure; // request never reached the logic
    if (prior) {
      if (prior.status === 'ok') return { data: prior.result, replayed: true };
      throw prior.error;
    }
    s.received.push(spec);
    try {
      const result = apply(spec);
      s.stored.set(spec.idempotencyKey, { status: 'ok', result });
      if (failure === 'lost-response') throw new ApiError('NETWORK_ERROR', 'response lost', 0, undefined, undefined, true); // applied, but the client never heard
      return { data: result, replayed: false };
    } catch (e) {
      if (e instanceof ApiError && e.code !== 'NETWORK_ERROR') s.stored.set(spec.idempotencyKey, { status: 'error', error: e });
      throw e;
    }
  }

  const api: SessionApi = {
    loadDiagram: async () => {
      s.loads += 1;
      return detail();
    },
    mutate: {
      command: (spec) => handle(spec) as never,
      ai: (spec) => handle(spec) as never,
      detail: (spec) => handle(spec) as never,
    },
  };
  return { s, api, detail, bump: () => { s.version += 1; s.name = `Edited elsewhere v${s.version}`; } };
}

function memoryStorage(): SessionStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
}

let keyCounter = 0;
async function newSession(opts: { debounce?: number } = {}) {
  const server = fakeServer();
  const storage = memoryStorage();
  keyCounter = 0;
  const session = createDocumentSession({ api: server.api, storage, newKey: () => `key-${String(++keyCounter).padStart(10, '0')}`, positionDebounceMs: opts.debounce ?? 350 });
  await session.open(DIAGRAM);
  return { ...server, session, storage };
}

const add = (name: string): DiagramCommand => ({ type: 'ADD_NODE', node: { name, kind: 'SERVICE' } });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('document session: structural commands', () => {
  it('opens a diagram and exposes the canonical document', async () => {
    const { session } = await newSession();
    const state = session.getState();
    expect(state.diagram).toMatchObject({ id: DIAGRAM, version: 1 });
    expect(state.status).toBe('idle');
    expect(state.pending).toBe(0);
  });

  it('confirm-then-apply: the document changes only when the server acknowledges, and the caller learns the new node id', async () => {
    const { session, s } = await newSession();
    let release!: () => void;
    s.gate = new Promise<void>((r) => (release = r));
    const before = session.getState().graph;
    const done = session.command(add('Orders'), 'Add Orders');
    await tick();
    expect(session.getState().graph.nodes).toHaveLength(0); // not applied locally
    expect(session.getState()).toMatchObject({ status: 'saving', pending: 1 });
    release();
    const res = await done;
    expect(session.getState().graph.nodes).toHaveLength(1);
    expect(session.getState()).toMatchObject({ status: 'idle', pending: 0 });
    expect(session.getState().diagram?.version).toBe(2);
    expect(newNodeIds(before, res.graph)).toHaveLength(1);
  });

  it('serializes writes: queued commands are sent one at a time, in order, each with the version the previous one produced', async () => {
    const { session, s } = await newSession();
    await Promise.all([session.command(add('A'), 'A'), session.command(add('B'), 'B'), session.command(add('C'), 'C')]);
    expect(s.received.map((r) => (r.body as { expectedVersion: number }).expectedVersion)).toEqual([1, 2, 3]);
    expect(s.received.map((r) => (r.body as { command: { node: { name: string } } }).command.node.name)).toEqual(['A', 'B', 'C']);
    expect(session.getState().graph.nodes.map((n) => n.name)).toEqual(['A', 'B', 'C']);
    expect(session.getState().diagram?.version).toBe(4);
  });

  it('a domain refusal (422) rejects only that command, changes nothing, and the queue carries on', async () => {
    const { session, s } = await newSession();
    const refused = session.command({ type: 'REMOVE_NODE', nodeId: uid(999) }, 'Remove ghost');
    const fine = session.command(add('After'), 'Add After');
    await expect(refused).rejects.toBeInstanceOf(RefusedError);
    await expect(refused).rejects.toMatchObject({ reason: 'NODE_NOT_FOUND' });
    await fine;
    expect(s.received).toHaveLength(2);
    expect((s.received[1]!.body as { expectedVersion: number }).expectedVersion).toBe(1); // a refusal does not consume a version
    expect(session.getState().graph.nodes).toHaveLength(1);
    expect(session.getState().notice?.text).toContain('does not exist');
  });
});

describe('document session: transient failures never apply a write twice', () => {
  it('holds the queue on a transient failure and resumes with the SAME key and body', async () => {
    const { session, s } = await newSession();
    s.failures.push(new ApiError('NETWORK_ERROR', 'offline', 0, undefined, undefined, true));
    const done = session.command(add('Orders'), 'Add Orders');
    await tick();
    expect(session.getState()).toMatchObject({ status: 'failed', pending: 1 });
    expect(session.getState().graph.nodes).toHaveLength(0);
    session.retry();
    await done;
    expect(s.received).toHaveLength(1);
    expect(session.getState().graph.nodes).toHaveLength(1);
    expect(session.getState().status).toBe('idle');
  });

  it('a lost response (the server applied the write but the client never heard) is recovered by replay: exactly one node', async () => {
    const { session, s } = await newSession();
    s.failures.push('lost-response');
    const done = session.command(add('Orders'), 'Add Orders');
    await tick();
    expect(session.getState().status).toBe('failed');
    expect(s.graph.nodes).toHaveLength(1); // the server did apply it
    session.retry(); // resend with the same key
    await done;
    expect(s.graph.nodes).toHaveLength(1);
    expect(s.version).toBe(2);
    expect(session.getState().graph.nodes).toHaveLength(1);
    expect(session.getState().diagram?.version).toBe(2);
  });

  it('later commands wait behind a held queue and are not sent out of order', async () => {
    const { session, s } = await newSession();
    s.failures.push(new ApiError('NETWORK_ERROR', 'offline', 0, undefined, undefined, true));
    const first = session.command(add('First'), 'First');
    const second = session.command(add('Second'), 'Second');
    await tick();
    expect(s.received).toHaveLength(0);
    session.retry();
    await Promise.all([first, second]);
    expect(s.received.map((r) => (r.body as { command: { node: { name: string } } }).command.node.name)).toEqual(['First', 'Second']);
  });
});

describe('document session: stale writes and conflicts', () => {
  it('a conflict stops the queue, rejects the write, keeps a draft, and never overwrites the newer version', async () => {
    const { session, s, bump, storage } = await newSession();
    bump(); // another tab edited the diagram
    const stale = session.command(add('Mine'), 'Add Mine');
    const queued = session.command(add('Also mine'), 'Add Also mine');
    await expect(stale).rejects.toBeInstanceOf(ConflictError);
    await expect(queued).rejects.toBeInstanceOf(ConflictError);
    const state = session.getState();
    expect(state.status).toBe('conflict');
    expect(state.conflict).toMatchObject({ expectedVersion: 1, currentVersion: 2, draftCount: 2 });
    expect(state.conflict?.descriptions).toEqual(['Add Mine', 'Add Also mine']);
    expect(s.graph.nodes).toHaveLength(0); // nothing was applied on the server
    expect(s.received).toHaveLength(1); // the queued write was never even sent
    expect(JSON.parse(storage.data.get(`tinker_draft_${DIAGRAM}`)!).items).toHaveLength(2);
    await expect(session.command(add('Blocked'), 'x')).rejects.toBeInstanceOf(ConflictError); // writes stay stopped
  });

  it('reload latest discards the draft and resumes editing on the server version', async () => {
    const { session, bump, storage } = await newSession();
    bump();
    await session.command(add('Mine'), 'Add Mine').catch(() => undefined);
    await session.reloadLatest();
    expect(session.getState().status).toBe('idle');
    expect(session.getState().conflict).toBeNull();
    expect(session.getState().diagram?.version).toBe(2);
    expect(storage.data.size).toBe(0);
    await session.command(add('Fresh'), 'Add Fresh');
    expect(session.getState().graph.nodes.map((n) => n.name)).toEqual(['Fresh']);
  });

  it('re-apply loads the latest version and re-submits the kept changes as new requests', async () => {
    const { session, s, bump, storage } = await newSession();
    bump();
    await session.command(add('Mine'), 'Add Mine').catch(() => undefined);
    const keysBefore = s.received.map((r) => r.idempotencyKey);
    const result = await session.reapplyDraft();
    expect(result).toEqual({ applied: 1, refused: 0 });
    expect(s.graph.nodes.map((n) => n.name)).toEqual(['Mine']);
    const reapplied = s.received[s.received.length - 1]!;
    expect(keysBefore).not.toContain(reapplied.idempotencyKey);
    expect((reapplied.body as { expectedVersion: number }).expectedVersion).toBe(2);
    expect(session.getState().status).toBe('idle');
    expect(storage.data.size).toBe(0);
  });

  it('a stale position save also conflicts instead of overwriting', async () => {
    const { session, s, bump } = await newSession({ debounce: 10 });
    const added = await session.command(add('A'), 'A');
    const id = added.graph.nodes[0]!.id;
    bump();
    session.savePositions({ [id]: { x: 5, y: 5 } });
    await new Promise((r) => setTimeout(r, 40));
    expect(session.getState().status).toBe('conflict');
    expect(s.presentation.nodePositions[id]).toEqual({ x: 0, y: 0 });
    expect(session.getState().conflict?.draftCount).toBe(1);
  });

  it('refreshIfIdle picks up another tab\'s change only when nothing is pending', async () => {
    const { session, bump, s } = await newSession();
    bump();
    expect(await session.refreshIfIdle()).toBe(true);
    expect(session.getState().diagram?.version).toBe(2);
    bump();
    s.gate = new Promise(() => undefined); // keep a write in flight
    void session.command(add('Busy'), 'Busy');
    await tick();
    const loadsBefore = s.loads;
    expect(await session.refreshIfIdle()).toBe(false);
    expect(s.loads).toBe(loadsBefore); // did not even ask
  });
});

describe('document session: drag saves', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows a drag immediately, saves once after a quiet period, and coalesces many moves into one write', async () => {
    const { session, s } = await newSession({ debounce: 300 });
    vi.useRealTimers();
    const id = (await session.command(add('A'), 'A')).graph.nodes[0]!.id;
    vi.useFakeTimers();
    for (let i = 1; i <= 5; i++) session.savePositions({ [id]: { x: i * 10, y: i * 10 } });
    expect(session.getState().presentation.nodePositions[id]).toEqual({ x: 50, y: 50 }); // visible instantly
    expect(session.getState().pending).toBe(1);
    expect(s.received).toHaveLength(1); // nothing sent yet
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();
    await session.flush();
    const presentationWrites = s.received.filter((r) => r.path.endsWith('/presentation'));
    expect(presentationWrites).toHaveLength(1);
    expect((presentationWrites[0]!.body as { nodePositions: Record<string, unknown> }).nodePositions[id]).toEqual({ x: 50, y: 50 });
    expect(session.getState().pending).toBe(0);
    expect(s.presentation.nodePositions[id]).toEqual({ x: 50, y: 50 });
  });

  it('an unsaved drag survives a structural acknowledgement (no snap-back) and is saved right after it, in order', async () => {
    const { session, s } = await newSession({ debounce: 5000 });
    vi.useRealTimers();
    const id = (await session.command(add('A'), 'A')).graph.nodes[0]!.id;
    session.savePositions({ [id]: { x: 77, y: 88 } });
    const second = session.command(add('B'), 'B'); // forces the drag to be queued BEFORE this command
    await second;
    await session.flush();
    expect(session.getState().presentation.nodePositions[id]).toEqual({ x: 77, y: 88 });
    const order = s.received.map((r) => (r.path.endsWith('/presentation') ? 'drag' : 'cmd'));
    expect(order).toEqual(['cmd', 'drag', 'cmd']);
    expect(s.presentation.nodePositions[id]).toEqual({ x: 77, y: 88 });
  });

  it('never sends positions for a node a queued command removed', async () => {
    const { session, s } = await newSession({ debounce: 5000 });
    vi.useRealTimers();
    const id = (await session.command(add('A'), 'A')).graph.nodes[0]!.id;
    session.savePositions({ [id]: { x: 9, y: 9 } });
    const removal = session.command({ type: 'REMOVE_NODE', nodeId: id }, 'Remove A');
    await removal;
    await session.flush();
    const presentationWrites = s.received.filter((r) => r.path.endsWith('/presentation'));
    expect(presentationWrites).toHaveLength(1); // the drag was saved before the removal...
    expect(s.graph.nodes).toHaveLength(0);
    expect(session.getState().status).toBe('idle'); // ...and nothing failed
  });
});

describe('document session: lifecycle', () => {
  it('closing rejects pending work and ignores late responses; opening another diagram resets state', async () => {
    const { session, s } = await newSession();
    let release!: () => void;
    s.gate = new Promise<void>((r) => (release = r));
    const pending = session.command(add('Late'), 'Late');
    await tick();
    session.close();
    release();
    await expect(pending).rejects.toBeInstanceOf(SessionClosedError);
    expect(session.getState().diagram).toBeNull();
    expect(session.getState().graph.nodes).toHaveLength(0);
  });

  it('rename goes through the same queue and updates the name from the canonical response', async () => {
    const { session } = await newSession();
    await session.renameDiagram('Renamed');
    expect(session.getState().diagram?.name).toBe('Renamed');
    expect(session.getState().diagram?.version).toBe(2);
  });

  it('flush resolves when everything is acknowledged, and rejects while held in conflict', async () => {
    const { session, bump } = await newSession();
    await session.flush();
    bump();
    void session.command(add('X'), 'X').catch(() => undefined);
    await expect(session.flush()).rejects.toBeInstanceOf(ConflictError);
  });

  it('an older stored result (replay) never regresses the document', async () => {
    const { session, s } = await newSession();
    await session.command(add('A'), 'A');
    await session.command(add('B'), 'B');
    const staleDoc = { diagramId: DIAGRAM, version: 2, appliedCommand: { type: 'ADD_NODE' as const }, graph: { schemaVersion: 1 as const, nodes: [], edges: [] }, presentation: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } }, replayed: true };
    const apiWithStale: SessionApi = { ...s && { loadDiagram: async () => ({ diagramId: DIAGRAM, workspaceId: uid(9), projectId: uid(8), name: 'x', version: 3, graph: session.getState().graph, presentation: session.getState().presentation, updatedAt: '' }) }, mutate: { command: async () => ({ data: staleDoc, replayed: true }), ai: async () => { throw new Error('unused'); }, detail: async () => { throw new Error('unused'); } } };
    const s2 = createDocumentSession({ api: apiWithStale, newKey: () => 'key-stale-0001' });
    await s2.open(DIAGRAM);
    const before = s2.getState().graph.nodes.length;
    await s2.command(add('C'), 'C');
    expect(s2.getState().graph.nodes).toHaveLength(before); // version 2 < 3: ignored
    expect(s2.getState().diagram?.version).toBe(3);
  });
});

describe('document session: typed commands travel through the same queue', () => {
  it('an applied typed command updates the canonical document and resolves with the server answer', async () => {
    const { session, s } = await newSession();
    const res = await session.ai('add Redis', undefined);
    expect(res.status).toBe('APPLIED');
    expect(session.getState().graph.nodes.map((n) => n.name)).toEqual(['Redis']);
    expect(session.getState().diagram?.version).toBe(2);
    expect(s.received).toHaveLength(1);
    expect(s.received[0]!.path).toBe(`/v1/diagrams/${DIAGRAM}/ai/command`);
    expect(s.received[0]!.body).toMatchObject({ expectedVersion: 1, input: { type: 'TEXT', text: 'add Redis' } });
  });

  it('a clarification changes nothing and does not move the version', async () => {
    const { session } = await newSession();
    const res = await session.ai('ask which', undefined);
    expect(res).toMatchObject({ status: 'CLARIFICATION', question: 'Which one?', options: ['A', 'B'] });
    expect(session.getState().diagram?.version).toBe(1);
    expect(session.getState().graph.nodes).toHaveLength(0);
    expect(session.getState().status).toBe('idle');
  });

  it('is serialized with manual edits: each write sees the version the previous one produced', async () => {
    const { session, s } = await newSession();
    await Promise.all([session.command(add('Manual'), 'Manual'), session.ai('add Typed', undefined), session.command(add('Manual2'), 'Manual2')]);
    expect(s.received.map((r) => (r.body as { expectedVersion: number }).expectedVersion)).toEqual([1, 2, 3]);
    expect(session.getState().graph.nodes.map((n) => n.name)).toEqual(['Manual', 'Typed', 'Manual2']);
  });

  it('a provider failure rejects only that request (no automatic hold), shows no toast, and the queue carries on', async () => {
    const { session } = await newSession();
    const failing = session.ai('timeout', undefined);
    const next = session.command(add('After'), 'After');
    await expect(failing).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    await next;
    expect(session.getState().graph.nodes.map((n) => n.name)).toEqual(['After']);
    expect(session.getState().notice).toBeNull(); // the chat reports typed-command failures
    expect(session.getState().status).toBe('idle');
  });

  it('a domain refusal of a typed command rejects with the reason and leaves everything unchanged', async () => {
    const { session } = await newSession();
    await expect(session.ai('refuse', undefined)).rejects.toMatchObject({ reason: 'DUPLICATE_EDGE' });
    expect(session.getState().diagram?.version).toBe(1);
    expect(session.getState().notice).toBeNull();
  });

  it('a lost response is retried with the SAME key and applies once', async () => {
    const { session, s } = await newSession();
    s.failures.push('lost-response');
    const done = session.ai('add Once', undefined);
    await tick();
    expect(session.getState().status).toBe('failed');
    session.retry();
    const res = await done;
    expect(res.status).toBe('APPLIED');
    expect(s.graph.nodes).toHaveLength(1);
    expect(s.version).toBe(2);
    expect(session.getState().diagram?.version).toBe(2);
  });

  it('a conflict keeps the typed text in the draft and re-apply re-asks the server on the latest version', async () => {
    const { session, s, bump, storage } = await newSession();
    bump();
    await expect(session.ai('add Mine', undefined)).rejects.toBeInstanceOf(ConflictError);
    expect(session.getState().conflict?.descriptions).toEqual(['Ask: "add Mine"']);
    expect(JSON.parse(storage.data.get(`tinker_draft_${DIAGRAM}`)!).items).toEqual([{ type: 'ai', text: 'add Mine' }]);
    expect(await session.reapplyDraft()).toEqual({ applied: 1, refused: 0 });
    expect(s.graph.nodes.map((n) => n.name)).toEqual(['Mine']);
    expect((s.received[s.received.length - 1]!.body as { expectedVersion: number }).expectedVersion).toBe(2);
  });
});

describe('document session: restore (undo, redo and "restore this version")', () => {
  it('restores an older version as a NEW version through the same queue, and the document follows the server', async () => {
    const { session, s } = await newSession();
    await session.command(add('A'), 'Add A');
    await session.command(add('B'), 'Add B'); // v3
    const head = await session.restore(2); // back to just A
    expect(head.version).toBe(4);
    expect(s.graph.nodes.map((n) => n.name)).toEqual(['A']);
    expect(session.getState().diagram?.version).toBe(4);
    expect(session.getState().graph.nodes.map((n) => n.name)).toEqual(['A']);
    expect((s.received[s.received.length - 1]!.body as { expectedVersion: number; version: number })).toEqual({ expectedVersion: 3, version: 2 });
  });

  it('is ordered with other writes and uses the version the previous one produced', async () => {
    const { session, s } = await newSession();
    await session.command(add('A'), 'Add A');
    const writes = [session.command(add('B'), 'Add B'), session.restore(2)];
    await Promise.all(writes);
    expect(s.graph.nodes.map((n) => n.name)).toEqual(['A']);
    const bodies = s.received.map((r) => r.body as { expectedVersion: number });
    expect(bodies.map((b) => b.expectedVersion)).toEqual([1, 2, 3]);
  });

  it('a missing or already-current version rejects with the reason, shows no error banner, and does not block the session', async () => {
    const { session } = await newSession();
    await session.command(add('A'), 'Add A');
    const gone = await session.restore(99).catch((e) => e);
    expect(gone).toBeInstanceOf(RefusedError);
    expect((gone as RefusedError).reason).toBe('REVISION_NOT_FOUND');
    const same = await session.restore(2).catch((e) => e);
    expect((same as RefusedError).reason).toBe('ALREADY_CURRENT');
    expect(session.getState().status).toBe('idle'); // NOT blocked (a missing revision is not a missing diagram)
    expect(session.getState().notice).toBeNull();
    await session.command(add('B'), 'Add B'); // editing still works
    expect(session.getState().graph.nodes).toHaveLength(2);
  });

  it('a retry after a lost response replays with the SAME key and restores once', async () => {
    const { session, s } = await newSession();
    await session.command(add('A'), 'Add A');
    await session.command(add('B'), 'Add B');
    s.failures.push('lost-response');
    const done = session.restore(2);
    await tick();
    expect(session.getState().status).toBe('failed');
    session.retry();
    await done;
    expect(s.version).toBe(4); // one restore, not two
    const restores = s.received.filter((r) => r.path.endsWith('/restore'));
    expect(restores).toHaveLength(1);
  });

  it('a conflict keeps the restore in the draft and re-apply submits it again on the latest version', async () => {
    const { session, s, bump, storage } = await newSession();
    await session.command(add('A'), 'Add A');
    bump(); // someone else saved
    await expect(session.restore(1)).rejects.toBeInstanceOf(ConflictError);
    expect(session.getState().conflict?.descriptions).toEqual(['Restore version 1']);
    expect(JSON.parse(storage.data.get(`tinker_draft_${DIAGRAM}`)!).items).toEqual([{ type: 'restore', version: 1 }]);
    expect(await session.reapplyDraft()).toEqual({ applied: 1, refused: 0 });
    expect(s.graph.nodes).toHaveLength(0);
  });
});
