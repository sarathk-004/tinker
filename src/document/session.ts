/**
 * Client-side document session: the ONLY place the editor talks to the durable document.
 *
 *  - `acknowledged` is what the server has confirmed. It is never edited locally.
 *  - Structural edits (commands) are confirm-then-apply: sent through ONE serialized queue per diagram, each with a stable
 *    Idempotency-Key and the expectedVersion captured when it is first sent; the canonical response replaces the document.
 *  - Drag-end position saves are optimistic: an overlay of unsaved positions is shown immediately and saved (debounced,
 *    coalesced) through the same queue, so they never race structural commands.
 *  - A version conflict stops the queue, keeps the user's unsaved work as a draft, and offers reload / re-apply.
 *  - Transient failures pause the queue ("failed") and resume with the SAME key, so a write can never apply twice.
 * No React, no Zustand, no browser globals: dependencies are injected so the behaviour is unit-tested.
 */
import {
  emptyGraph,
  emptyPresentation,
  type CommandResponse,
  type DiagramCommand,
  type DiagramDetail,
  type Graph,
  type Position,
  type Presentation,
  type Viewport,
} from '../contracts';
import { ApiError, type MutationSpec, type Replayable } from '../api/client';

export type SaveStatus = 'idle' | 'saving' | 'failed' | 'conflict' | 'blocked';

export interface DiagramMeta {
  id: string;
  workspaceId: string;
  name: string;
  version: number;
  updatedAt: string;
}

export interface ConflictInfo {
  expectedVersion: number | null;
  currentVersion: number | null;
  draftCount: number;
  descriptions: string[];
}

export interface Notice {
  kind: 'error' | 'info';
  text: string;
  at: number;
}

export interface SessionState {
  diagram: DiagramMeta | null;
  graph: Graph;
  /** Acknowledged positions with the user's unsaved drags laid over them. */
  presentation: Presentation;
  status: SaveStatus;
  /** Writes not yet acknowledged (queued + in flight + a debounced position save). */
  pending: number;
  conflict: ConflictInfo | null;
  notice: Notice | null;
}

/** The subset of the API client the session needs (injectable for tests). */
export interface SessionApi {
  loadDiagram(id: string): Promise<DiagramDetail>;
  mutate: {
    command(spec: MutationSpec): Promise<Replayable<CommandResponse>>;
    detail(spec: MutationSpec): Promise<Replayable<DiagramDetail>>;
  };
}

export interface SessionStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface SessionDeps {
  api: SessionApi;
  storage?: SessionStorage;
  newKey?: () => string;
  /** Debounce for drag-end position saves. */
  positionDebounceMs?: number;
  now?: () => number;
}

/** The command was rejected by the server's rules (422). Nothing changed. */
export class RefusedError extends Error {
  constructor(message: string, public readonly reason?: string) {
    super(message);
    this.name = 'RefusedError';
  }
}
/** The diagram changed elsewhere; this write was NOT applied and was kept as a draft. */
export class ConflictError extends Error {
  constructor() {
    super('The diagram changed in another tab or device. Your change was not applied.');
    this.name = 'ConflictError';
  }
}
export class SessionClosedError extends Error {
  constructor(message = 'The diagram is no longer available.') {
    super(message);
    this.name = 'SessionClosedError';
  }
}

type Waiter = { resolve: (r: CommandResponse | DiagramDetail) => void; reject: (e: unknown) => void };

type Item =
  | { type: 'command'; key: string; command: DiagramCommand; label: string; sent?: MutationSpec; waiters: Waiter[] }
  | { type: 'presentation'; key: string; positions: Record<string, Position>; viewport?: Viewport; sent?: MutationSpec; sentPositions?: Record<string, Position>; waiters: Waiter[] }
  | { type: 'rename'; key: string; name: string; sent?: MutationSpec; waiters: Waiter[] };

interface Draft {
  diagramId: string;
  baseVersion: number;
  savedAt: number;
  items: Array<{ type: 'command'; command: DiagramCommand; label: string } | { type: 'presentation'; positions: Record<string, Position>; viewport?: Viewport } | { type: 'rename'; name: string }>;
}

const draftKey = (diagramId: string) => `tinker_draft_${diagramId}`;

export function createDocumentSession(deps: SessionDeps) {
  const { api } = deps;
  const newKey = deps.newKey ?? (() => crypto.randomUUID());
  const now = deps.now ?? Date.now;
  const debounceMs = deps.positionDebounceMs ?? 350;

  // ---- acknowledged document ----
  let diagram: DiagramMeta | null = null;
  let graph: Graph = emptyGraph();
  let ackPresentation: Presentation = emptyPresentation();
  // ---- local, unsaved ----
  let overlay: Record<string, Position> = {};
  let overlayViewport: Viewport | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  // ---- queue ----
  const queue: Item[] = [];
  let pumping = false;
  let status: SaveStatus = 'idle';
  let conflict: ConflictInfo | null = null;
  let notice: Notice | null = null;
  let generation = 0; // bumped when a different diagram is opened so late responses are ignored
  const listeners = new Set<(s: SessionState) => void>();
  const idleWaiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];

  const hasDebouncedPositions = () => Object.keys(overlay).length > 0 && debounceTimer !== undefined;
  const pendingCount = () => queue.length + (hasDebouncedPositions() ? 1 : 0);

  function view(): SessionState {
    const positions = { ...ackPresentation.nodePositions };
    for (const [id, p] of Object.entries(overlay)) if (graph.nodes.some((n) => n.id === id)) positions[id] = p;
    return {
      diagram,
      graph,
      presentation: { nodePositions: positions, viewport: overlayViewport ?? ackPresentation.viewport },
      status,
      pending: pendingCount(),
      conflict,
      notice,
    };
  }
  function emit() {
    const s = view();
    for (const l of listeners) l(s);
    if (status === 'idle' && pendingCount() === 0) for (const w of idleWaiters.splice(0)) w.resolve();
  }
  function setNotice(kind: Notice['kind'], text: string) {
    notice = { kind, text, at: now() };
  }
  function setStatus(next: SaveStatus) {
    status = next;
  }

  function applyDocument(next: { name?: string; version: number; graph: Graph; presentation: Presentation; updatedAt?: string }) {
    if (!diagram) return;
    graph = next.graph;
    ackPresentation = next.presentation;
    diagram = { ...diagram, version: next.version, name: next.name ?? diagram.name, updatedAt: next.updatedAt ?? diagram.updatedAt };
    // Drop overlay entries for nodes that no longer exist.
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const id of Object.keys(overlay)) if (!ids.has(id)) delete overlay[id];
  }

  // ---------- opening ----------
  async function open(diagramId: string): Promise<void> {
    generation += 1;
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
    queue.length = 0;
    overlay = {};
    overlayViewport = undefined;
    conflict = null;
    notice = null;
    setStatus('idle');
    const loaded = await api.loadDiagram(diagramId);
    diagram = { id: loaded.diagramId, workspaceId: loaded.workspaceId, name: loaded.name, version: loaded.version, updatedAt: loaded.updatedAt };
    graph = loaded.graph;
    ackPresentation = loaded.presentation;
    emit();
  }

  function adopt(detail: DiagramDetail): void {
    generation += 1;
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
    queue.length = 0;
    overlay = {};
    overlayViewport = undefined;
    conflict = null;
    notice = null;
    setStatus('idle');
    diagram = { id: detail.diagramId, workspaceId: detail.workspaceId, name: detail.name, version: detail.version, updatedAt: detail.updatedAt };
    graph = detail.graph;
    ackPresentation = detail.presentation;
    emit();
  }

  function close(): void {
    generation += 1;
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
    for (const item of queue.splice(0)) for (const w of item.waiters) w.reject(new SessionClosedError());
    for (const w of idleWaiters.splice(0)) w.reject(new SessionClosedError());
    diagram = null;
    graph = emptyGraph();
    ackPresentation = emptyPresentation();
    overlay = {};
    overlayViewport = undefined;
    conflict = null;
    notice = null;
    setStatus('idle');
    emit();
  }

  // ---------- building requests (called once, when an item is first sent) ----------
  function build(item: Item): MutationSpec | null {
    if (!diagram) throw new SessionClosedError();
    const base = `/v1/diagrams/${diagram.id}`;
    const expectedVersion = diagram.version;
    switch (item.type) {
      case 'command':
        return { method: 'POST', path: `${base}/commands`, body: { expectedVersion, command: item.command }, idempotencyKey: item.key };
      case 'rename':
        return { method: 'PATCH', path: base, body: { expectedVersion, name: item.name }, idempotencyKey: item.key };
      case 'presentation': {
        // Positions for nodes that no longer exist (removed by an earlier queued command) must not be sent.
        const ids = new Set(graph.nodes.map((n) => n.id));
        const positions = Object.fromEntries(Object.entries(item.positions).filter(([id]) => ids.has(id)));
        if (Object.keys(positions).length === 0 && !item.viewport) return null;
        item.sentPositions = positions;
        return {
          method: 'PATCH',
          path: `${base}/presentation`,
          body: { expectedVersion, ...(Object.keys(positions).length > 0 ? { nodePositions: positions } : {}), ...(item.viewport ? { viewport: item.viewport } : {}) },
          idempotencyKey: item.key,
        };
      }
    }
  }

  // ---------- the pump ----------
  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    const myGeneration = generation;
    try {
      while (queue.length > 0 && (status === 'idle' || status === 'saving' || status === 'failed')) {
        const item = queue[0]!;
        let spec: MutationSpec | null;
        try {
          spec = item.sent ?? build(item);
        } catch (error) {
          queue.shift();
          for (const w of item.waiters) w.reject(error);
          continue;
        }
        if (!spec) {
          queue.shift();
          for (const w of item.waiters) w.resolve(undefined as never);
          continue;
        }
        item.sent = spec; // from now on every retry sends exactly this, with this key

        setStatus('saving');
        emit();
        try {
          const result = item.type === 'command' ? await api.mutate.command(spec) : await api.mutate.detail(spec);
          if (generation !== myGeneration) return; // a different diagram was opened meanwhile
          acknowledge(item, result.data);
          queue.shift();
          for (const w of item.waiters) w.resolve(result.data);
          setStatus('idle');
          emit();
        } catch (error) {
          if (generation !== myGeneration) return;
          const handled = handleFailure(item, error);
          emit();
          if (handled === 'pause') return;
        }
      }
      if (status === 'saving') setStatus('idle');
      emit();
    } finally {
      pumping = false;
    }
  }

  function acknowledge(item: Item, data: CommandResponse | DiagramDetail) {
    if (!diagram) return;
    if (data.version < diagram.version) {
      // An older stored result (a replay). Never let it regress what we know; the next load reconciles.
      return;
    }
    applyDocument({
      version: data.version,
      graph: data.graph,
      presentation: data.presentation,
      ...('name' in data ? { name: data.name, updatedAt: data.updatedAt } : {}),
    });
    if (item.type === 'presentation' && item.sentPositions) {
      // The server now holds what we sent: drop overlay entries that still equal it (newer drags stay).
      for (const [id, p] of Object.entries(item.sentPositions)) {
        const o = overlay[id];
        if (o && o.x === p.x && o.y === p.y) delete overlay[id];
      }
      if (item.viewport && overlayViewport && overlayViewport.x === item.viewport.x && overlayViewport.y === item.viewport.y && overlayViewport.zoom === item.viewport.zoom) overlayViewport = undefined;
    }
  }

  /** Returns 'pause' when the pump must stop (the queue is held), 'continue' when the next item can proceed. */
  function handleFailure(item: Item, error: unknown): 'pause' | 'continue' {
    const failWaiters = (e: unknown) => item.waiters.forEach((w) => w.reject(e));

    if (!(error instanceof ApiError)) {
      queue.shift();
      failWaiters(error);
      setNotice('error', 'Something went wrong while saving.');
      setStatus('idle');
      return 'continue';
    }

    switch (error.code) {
      case 'DIAGRAM_VERSION_CONFLICT': {
        enterConflict(error);
        return 'pause';
      }
      case 'IDEMPOTENCY_RESULT_EXPIRED': {
        enterConflict(error);
        return 'pause';
      }
      case 'DOMAIN_VALIDATION_FAILED': {
        queue.shift();
        const reason = (error.details as { reason?: string } | undefined)?.reason;
        failWaiters(new RefusedError(error.message, reason));
        setNotice('error', error.message);
        setStatus('idle');
        return 'continue';
      }
      case 'DIAGRAM_NOT_FOUND':
      case 'FORBIDDEN':
      case 'NOT_FOUND': {
        const items = queue.splice(0);
        for (const i of items) i.waiters.forEach((w) => w.reject(new SessionClosedError()));
        for (const w of idleWaiters.splice(0)) w.reject(new SessionClosedError());
        setNotice('error', error.code === 'FORBIDDEN' ? 'You no longer have permission to edit this diagram.' : 'This diagram was deleted or is no longer available to you.');
        setStatus('blocked');
        return 'pause';
      }
      case 'UNAUTHENTICATED': {
        setNotice('error', 'Your session expired. Please sign in again.');
        setStatus('failed'); // held; the app signs out and discards this session
        return 'pause';
      }
      default: {
        if (error.retryable) {
          // Transport trouble or server hiccup: hold the queue; resume later with the same key (never applies twice).
          setNotice('error', error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT' ? 'Cannot reach the server. Your changes are waiting and will be sent when it is back.' : 'The server is busy. Retrying will resume saving.');
          setStatus('failed');
          return 'pause';
        }
        queue.shift();
        failWaiters(error);
        setNotice('error', error.message);
        setStatus('idle');
        return 'continue';
      }
    }
  }

  function toDraftItem(item: Item): Draft['items'][number] {
    if (item.type === 'command') return { type: 'command', command: item.command, label: item.label };
    if (item.type === 'rename') return { type: 'rename', name: item.name };
    return { type: 'presentation', positions: item.positions, ...(item.viewport ? { viewport: item.viewport } : {}) };
  }

  function enterConflict(error: ApiError) {
    const items = queue.splice(0);
    const d = error.details as { expectedVersion?: number; currentVersion?: number } | undefined;
    const drafts = items.map(toDraftItem);
    // Unsaved drags that never reached the queue also belong to the draft (those already in a queued item are not repeated).
    const queued: Record<string, Position> = {};
    for (const i of items) if (i.type === 'presentation') Object.assign(queued, i.positions);
    const extra = Object.fromEntries(Object.entries(overlay).filter(([id, p]) => queued[id]?.x !== p.x || queued[id]?.y !== p.y));
    if (Object.keys(extra).length > 0) drafts.push({ type: 'presentation', positions: extra, ...(overlayViewport ? { viewport: overlayViewport } : {}) });
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
    if (diagram && deps.storage && drafts.length > 0) {
      const draft: Draft = { diagramId: diagram.id, baseVersion: diagram.version, savedAt: now(), items: drafts };
      try {
        deps.storage.set(draftKey(diagram.id), JSON.stringify(draft));
      } catch {
        /* storage full or blocked: the in-memory conflict info still lets the user re-apply */
      }
    }
    for (const i of items) i.waiters.forEach((w) => w.reject(new ConflictError()));
    for (const w of idleWaiters.splice(0)) w.reject(new ConflictError());
    conflict = {
      expectedVersion: d?.expectedVersion ?? null,
      currentVersion: d?.currentVersion ?? null,
      draftCount: drafts.length,
      descriptions: drafts.map((i) => (i.type === 'command' ? i.label : i.type === 'rename' ? `Rename diagram to "${i.name}"` : 'Moved nodes')),
    };
    setNotice('error', 'This diagram changed elsewhere. Your unsaved changes were kept.');
    setStatus('conflict');
  }

  // ---------- public enqueue API ----------
  function enqueue(item: Item): void {
    if (!diagram) throw new SessionClosedError('No diagram is open.');
    if (status === 'conflict' || status === 'blocked') throw status === 'conflict' ? new ConflictError() : new SessionClosedError();
    queue.push(item);
    emit();
    void pump();
  }

  function command(cmd: DiagramCommand, label: string): Promise<CommandResponse> {
    flushPositionsNow(); // keep drags ordered before the structural change that follows them
    return new Promise((resolve, reject) => {
      try {
        enqueue({ type: 'command', key: newKey(), command: cmd, label, waiters: [{ resolve: resolve as Waiter['resolve'], reject }] });
      } catch (e) {
        reject(e);
      }
    });
  }

  function renameDiagram(name: string): Promise<DiagramDetail> {
    return new Promise((resolve, reject) => {
      try {
        enqueue({ type: 'rename', key: newKey(), name, waiters: [{ resolve: resolve as Waiter['resolve'], reject }] });
      } catch (e) {
        reject(e);
      }
    });
  }

  /** Optimistic: shown immediately via the overlay; saved after a short quiet period, merged with queued position saves. */
  function savePositions(positions: Record<string, Position>, viewport?: Viewport): void {
    if (!diagram || status === 'conflict' || status === 'blocked') return;
    Object.assign(overlay, positions);
    if (viewport) overlayViewport = viewport;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushPositionsNow, debounceMs);
    emit();
  }

  function flushPositionsNow(): void {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
    if (!diagram || (Object.keys(overlay).length === 0 && !overlayViewport)) return;
    if (status === 'conflict' || status === 'blocked') return;
    const positions = { ...overlay };
    const viewport = overlayViewport;
    const tail = queue[queue.length - 1];
    // Coalesce into a position save that has not been sent yet; an in-flight one cannot change.
    if (tail && tail.type === 'presentation' && !tail.sent) {
      Object.assign(tail.positions, positions);
      if (viewport) tail.viewport = viewport;
    } else {
      queue.push({ type: 'presentation', key: newKey(), positions, ...(viewport ? { viewport } : {}), waiters: [] });
    }
    emit();
    void pump();
  }

  /** Resolves when everything queued has been acknowledged; rejects if the queue is held (failed/conflict/blocked). */
  function flush(): Promise<void> {
    flushPositionsNow();
    if (pendingCount() === 0 && status === 'idle') return Promise.resolve();
    if (status === 'conflict') return Promise.reject(new ConflictError());
    if (status === 'blocked') return Promise.reject(new SessionClosedError());
    return new Promise((resolve, reject) => {
      idleWaiters.push({ resolve, reject });
      void pump();
    });
  }

  // ---------- recovery ----------
  /** Resume a held queue (after transient failures). Same keys, same bodies. */
  function retry(): void {
    if (status !== 'failed') return;
    notice = null;
    setStatus('idle');
    emit();
    void pump();
  }

  /** After a conflict: discard unsaved work and show the server's latest version. */
  async function reloadLatest(): Promise<void> {
    if (!diagram) return;
    const id = diagram.id;
    deps.storage?.remove(draftKey(id));
    await open(id);
  }

  /** After a conflict: load the latest version, then re-submit the kept changes as NEW requests (new keys, new version). */
  async function reapplyDraft(): Promise<{ applied: number; refused: number }> {
    if (!diagram) return { applied: 0, refused: 0 };
    const id = diagram.id;
    const raw = deps.storage?.get(draftKey(id));
    const draft: Draft | null = raw ? (JSON.parse(raw) as Draft) : null;
    await open(id);
    deps.storage?.remove(draftKey(id));
    let applied = 0;
    let refused = 0;
    for (const item of draft?.items ?? []) {
      try {
        if (item.type === 'command') await command(item.command, item.label);
        else if (item.type === 'rename') await renameDiagram(item.name);
        else savePositions(item.positions, item.viewport);
        applied += 1;
      } catch (e) {
        if (e instanceof RefusedError) refused += 1;
        else throw e;
      }
    }
    return { applied, refused };
  }

  /** On window focus: if nothing is pending, quietly pick up changes made in another tab or device. */
  async function refreshIfIdle(): Promise<boolean> {
    if (!diagram || status !== 'idle' || pendingCount() > 0) return false;
    const myGeneration = generation;
    const latest = await api.loadDiagram(diagram.id).catch(() => null);
    if (!latest || generation !== myGeneration || !diagram || status !== 'idle' || pendingCount() > 0) return false;
    if (latest.version <= diagram.version) return false;
    applyDocument({ version: latest.version, graph: latest.graph, presentation: latest.presentation, name: latest.name, updatedAt: latest.updatedAt });
    emit();
    return true;
  }

  function clearNotice() {
    notice = null;
    emit();
  }

  return {
    getState: view,
    subscribe(listener: (s: SessionState) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    open,
    adopt,
    close,
    command,
    renameDiagram,
    savePositions,
    flush,
    retry,
    reloadLatest,
    reapplyDraft,
    refreshIfIdle,
    clearNotice,
    /** For the "leave page?" guard. */
    hasUnsavedWork: () => pendingCount() > 0 || status === 'failed' || status === 'conflict',
  };
}

export type DocumentSession = ReturnType<typeof createDocumentSession>;

/** Ids present in `next` but not in `prev`: how a caller learns the server-assigned id of a node it just added. */
export function newNodeIds(prev: Graph, next: Graph): string[] {
  const before = new Set(prev.nodes.map((n) => n.id));
  return next.nodes.filter((n) => !before.has(n.id)).map((n) => n.id);
}
