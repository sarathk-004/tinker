import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagramCommand, Graph, Presentation, RevisionSummary } from '../contracts';

const DIAGRAM = '11111111-1111-4111-8111-111111111111';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A small pretend server: versions, structural revisions, restore, history listing. Position saves bump the version but add no revision. */
const server = vi.hoisted(() => {
  const empty = () => ({ graph: { schemaVersion: 1, nodes: [], edges: [] } as unknown as Graph, presentation: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } } as unknown as Presentation });
  const s = {
    version: 1,
    doc: empty(),
    revs: new Map<number, { reason: string; doc: ReturnType<typeof empty> }>(),
    nextId: 1,
    reset() {
      s.version = 1;
      s.doc = empty();
      s.revs = new Map([[1, { reason: 'CHECKPOINT', doc: s.doc }]]);
      s.nextId = 1;
    },
  };
  s.reset();
  return s;
});

vi.mock('../document/instance', async () => {
  const { createDocumentSession } = await import('../document/session');
  const { ApiError } = await import('../api/client');
  const detail = () => ({ diagramId: DIAGRAM, workspaceId: uid(9), name: 'T', version: server.version, graph: server.doc.graph, presentation: server.doc.presentation, updatedAt: '2026-01-01T00:00:00.000Z' });
  const handle = async (spec: { path: string; body: unknown }) => {
    const body = spec.body as { expectedVersion: number; command?: DiagramCommand; version?: number; nodePositions?: Record<string, { x: number; y: number }> };
    if (body.expectedVersion !== server.version) throw new ApiError('DIAGRAM_VERSION_CONFLICT', 'conflict', 409, { expectedVersion: body.expectedVersion, currentVersion: server.version });
    if (spec.path.endsWith('/restore')) {
      const target = server.revs.get(body.version!);
      if (!target) throw new ApiError('DOMAIN_VALIDATION_FAILED', 'gone', 422, { reason: 'REVISION_NOT_FOUND' });
      if (JSON.stringify(target.doc) === JSON.stringify(server.doc)) throw new ApiError('DOMAIN_VALIDATION_FAILED', 'The diagram already looks like that version.', 422, { reason: 'ALREADY_CURRENT' });
      server.doc = target.doc;
      server.version += 1;
      server.revs.set(server.version, { reason: 'RESTORE', doc: server.doc });
      return { data: detail(), replayed: false };
    }
    if (spec.path.endsWith('/presentation')) {
      server.doc = { graph: server.doc.graph, presentation: { ...server.doc.presentation, nodePositions: { ...server.doc.presentation.nodePositions, ...(body.nodePositions ?? {}) } } };
      server.version += 1;
      return { data: detail(), replayed: false };
    }
    const c = body.command as Extract<DiagramCommand, { type: 'ADD_NODE' }>;
    const id = uid(server.nextId++);
    server.doc = {
      graph: { ...server.doc.graph, nodes: [...server.doc.graph.nodes, { id, name: c.node.name, kind: 'SERVICE', metadata: {} }] } as Graph,
      presentation: { ...server.doc.presentation, nodePositions: { ...server.doc.presentation.nodePositions, [id]: { x: 0, y: 0 } } },
    };
    server.version += 1;
    server.revs.set(server.version, { reason: 'MANUAL_COMMAND', doc: server.doc });
    return { data: { diagramId: DIAGRAM, version: server.version, appliedCommand: { type: 'ADD_NODE' }, graph: server.doc.graph, presentation: server.doc.presentation }, replayed: false };
  };
  const api = {
    loadDiagram: async () => detail(),
    revisions: async () => ({
      revisions: [...server.revs.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([version, r]) => ({ version, reason: r.reason, createdAt: '2026-01-01T00:00:00.000Z', createdBy: { id: uid(1), name: 'Me' }, nodeCount: r.doc.graph.nodes.length, edgeCount: 0 })) as RevisionSummary[],
      nextBefore: null,
      retention: { keepLatest: 100, keepDays: 30 },
    }),
    mutate: { command: handle, ai: handle, detail: handle },
  };
  let n = 0;
  const session = createDocumentSession({ api: api as never, newKey: () => `key-${String(++n).padStart(10, '0')}`, positionDebounceMs: 5 });
  return { api, session };
});

import { session } from '../document/instance';
import { historyKeyHandler, useHistoryStore, watchHistory } from './history';
import { REASON_LABEL, timeAgo } from '../components/VersionsPanel';

const add = (name: string): DiagramCommand => ({ type: 'ADD_NODE', node: { name, kind: 'SERVICE' } });
const names = () => session.getState().graph.nodes.map((n) => n.name);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

let stop: () => void = () => undefined;
beforeEach(async () => {
  stop();
  server.reset();
  useHistoryStore.getState().reset();
  await session.open(DIAGRAM);
  stop = watchHistory();
  await useHistoryStore.getState().load();
});

describe('undo and redo are restores of saved versions', () => {
  it('Undo goes back one structural change as a NEW version; Redo goes forward again', async () => {
    await session.command(add('A'), 'Add A');
    await session.command(add('B'), 'Add B'); // v3
    await useHistoryStore.getState().load();
    expect(useHistoryStore.getState()).toMatchObject({ canUndo: true, canRedo: false, currentSource: 3 });

    expect(await useHistoryStore.getState().undo()).toBe(true);
    expect(names()).toEqual(['A']);
    expect(session.getState().diagram?.version).toBe(4); // never goes backwards
    expect(useHistoryStore.getState()).toMatchObject({ canUndo: true, canRedo: true, currentSource: 2 });

    expect(await useHistoryStore.getState().redo()).toBe(true);
    expect(names()).toEqual(['A', 'B']);
    expect(session.getState().diagram?.version).toBe(5);
    expect(useHistoryStore.getState()).toMatchObject({ canRedo: false, currentSource: 3 });
  });

  it('keeps stepping back to the empty start and stops there', async () => {
    await session.command(add('A'), 'Add A');
    await session.command(add('B'), 'Add B');
    await useHistoryStore.getState().load();
    await useHistoryStore.getState().undo();
    await useHistoryStore.getState().undo();
    expect(names()).toEqual([]);
    expect(useHistoryStore.getState().canUndo).toBe(false);
    expect(await useHistoryStore.getState().undo()).toBe(false); // nothing earlier
    // and all the way forward again
    await useHistoryStore.getState().redo();
    await useHistoryStore.getState().redo();
    expect(names()).toEqual(['A', 'B']);
  });

  it('a new edit after an undo forgets Redo (the usual rule)', async () => {
    await session.command(add('A'), 'Add A');
    await session.command(add('B'), 'Add B');
    await useHistoryStore.getState().load();
    await useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().canRedo).toBe(true);
    await session.command(add('C'), 'Add C');
    await tick(700);
    expect(useHistoryStore.getState().canRedo).toBe(false);
    expect(await useHistoryStore.getState().redo()).toBe(false);
    expect(names()).toEqual(['A', 'C']);
  });

  it('dragging a node after an undo does not forget Redo (positions are not content)', async () => {
    await session.command(add('A'), 'Add A');
    await session.command(add('B'), 'Add B');
    await useHistoryStore.getState().load();
    await useHistoryStore.getState().undo();
    const id = session.getState().graph.nodes[0]!.id;
    session.savePositions({ [id]: { x: 500, y: 20 } });
    await session.flush();
    await tick(700);
    expect(useHistoryStore.getState().canRedo).toBe(true);
    expect(await useHistoryStore.getState().redo()).toBe(true);
    expect(names()).toEqual(['A', 'B']);
  });

  it('undo ignores position-only saves: it goes back over the last structural change, not the last drag', async () => {
    await session.command(add('A'), 'Add A');
    const id = session.getState().graph.nodes[0]!.id;
    session.savePositions({ [id]: { x: 300, y: 300 } });
    await session.flush();
    await tick(700);
    expect(session.getState().diagram?.version).toBe(3); // the drag bumped the version without a revision
    expect(useHistoryStore.getState().currentSource).toBe(2);
    await useHistoryStore.getState().undo();
    expect(names()).toEqual([]);
  });

  it('"restore this version" works for any listed version and marks it as showing now', async () => {
    await session.command(add('A'), 'Add A');
    await session.command(add('B'), 'Add B');
    await useHistoryStore.getState().load();
    expect(await useHistoryStore.getState().restore(2)).toBe(true);
    expect(names()).toEqual(['A']);
    expect(useHistoryStore.getState().currentSource).toBe(2);
    expect(await useHistoryStore.getState().restore(99)).toBe(false); // gone from the history
    expect(useHistoryStore.getState().error).toMatch(/not in the history|gone/i);
    expect(session.getState().status).toBe('idle');
  });

  it('switching diagram forgets everything', async () => {
    await session.command(add('A'), 'Add A');
    await useHistoryStore.getState().load();
    await useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().canRedo).toBe(true);
    useHistoryStore.getState().reset();
    expect(useHistoryStore.getState()).toMatchObject({ canUndo: false, canRedo: false, revisions: [] });
    expect(await useHistoryStore.getState().redo()).toBe(false);
  });
});

describe('keyboard shortcuts', () => {
  const key = (init: KeyboardEventInit, target?: Partial<HTMLElement>) => {
    const event = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, key: '', ...init, target: target ?? { tagName: 'BODY', isContentEditable: false }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    historyKeyHandler(event as unknown as KeyboardEvent);
    return event;
  };

  it('Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo, and the browser default is suppressed', async () => {
    await session.command(add('A'), 'Add A');
    await useHistoryStore.getState().load();
    const undo = key({ key: 'z', ctrlKey: true });
    expect(undo.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(names()).toEqual([]));
    await vi.waitFor(() => expect(useHistoryStore.getState().canRedo).toBe(true));
    const redo = key({ key: 'Z', ctrlKey: true, shiftKey: true });
    expect(redo.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(names()).toEqual(['A']));
    key({ key: 'z', metaKey: true }); // Cmd+Z on a Mac
    await vi.waitFor(() => expect(names()).toEqual([]));
    await vi.waitFor(() => expect(useHistoryStore.getState().canRedo).toBe(true));
    key({ key: 'y', ctrlKey: true });
    await vi.waitFor(() => expect(names()).toEqual(['A']));
  });

  it('typing in a text field keeps the field\'s own undo (the shortcut is left alone)', async () => {
    await session.command(add('A'), 'Add A');
    await useHistoryStore.getState().load();
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const e = key({ key: 'z', ctrlKey: true }, { tagName, isContentEditable: false });
      expect(e.defaultPrevented).toBe(false);
    }
    expect(key({ key: 'z', ctrlKey: true }, { tagName: 'DIV', isContentEditable: true }).defaultPrevented).toBe(false);
    expect(key({ key: 'z' }).defaultPrevented).toBe(false); // no modifier
    await tick(30);
    expect(names()).toEqual(['A']);
  });
});

describe('version list wording', () => {
  it('time ago', () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    expect(timeAgo('2026-10-06T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-10-06T11:55:00Z', now)).toBe('5 min ago');
    expect(timeAgo('2026-10-06T09:00:00Z', now)).toBe('3 h ago');
    expect(timeAgo('2026-10-04T12:00:00Z', now)).toBe('2 d ago');
  });

  it('every reason has plain wording', () => {
    expect(REASON_LABEL).toEqual({ CHECKPOINT: 'Started empty', MANUAL_COMMAND: 'Edit', AI_COMMAND: 'Command', AUTOSAVE: 'Auto-save', RESTORE: 'Restored' });
  });
});
