import { create } from 'zustand';
import type { RevisionSummary } from '../contracts';
import { ApiError } from '../api/client';
import { api, session } from '../document/instance';
import { RefusedError } from '../document/session';

/**
 * Version history, undo and redo.
 *
 * Undo is NOT a local snapshot stack: it is a restore of an earlier saved version, which the server records as a NEW version
 * (so it is durable, survives a refresh and other devices, and can itself be undone). "Redo" is a restore of the version
 * we came from. Position-only saves (drags) create no versions, so undo steps over structural changes only.
 */
export interface HistoryState {
  diagramId: string | null;
  revisions: RevisionSummary[];
  retention: { keepLatest: number; keepDays: number };
  hasMore: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** Derived: what Undo / Redo would do right now. */
  canUndo: boolean;
  canRedo: boolean;
  /** The saved version whose content the diagram currently shows (null until the list is loaded). */
  currentSource: number | null;

  load(): Promise<void>;
  loadMore(): Promise<void>;
  restore(version: number): Promise<boolean>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  reset(): void;
}

/** After an undo/redo: which saved version the head now shows, and the graph it had (to notice real edits later). */
interface Trail {
  headVersion: number;
  source: number;
  graphKey: string;
}

let redoStack: number[] = [];
let trail: Trail | null = null;
/** True while WE are restoring: the restore's own acknowledgement must not look like "someone edited". */
let restoring = false;

async function restoreVersion(version: number): Promise<void> {
  restoring = true;
  try {
    await session.restore(version);
  } finally {
    restoring = false;
  }
}

const graphKey = () => JSON.stringify(session.getState().graph);

/** Newest revision at or below `head`: the saved version a head without its own revision (after drags) still shows. */
function latestAtOrBelow(revisions: RevisionSummary[], head: number): number | null {
  return revisions.find((r) => r.version <= head)?.version ?? null;
}

function sourceOf(revisions: RevisionSummary[], head: number): number | null {
  if (trail && trail.headVersion === head) return trail.source;
  return latestAtOrBelow(revisions, head);
}

function derive(revisions: RevisionSummary[]): Pick<HistoryState, 'canUndo' | 'canRedo' | 'currentSource'> {
  const head = session.getState().diagram?.version ?? 0;
  const source = sourceOf(revisions, head);
  return {
    currentSource: source,
    canUndo: source !== null && revisions.some((r) => r.version < source),
    canRedo: redoStack.length > 0 && trail !== null,
  };
}

const messageOf = (error: unknown) =>
  error instanceof RefusedError || error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong.';

export const useHistoryStore = create<HistoryState>((set, get) => ({
  diagramId: null,
  revisions: [],
  retention: { keepLatest: 100, keepDays: 30 },
  hasMore: false,
  loading: false,
  busy: false,
  error: null,
  canUndo: false,
  canRedo: false,
  currentSource: null,

  async load() {
    const id = session.getState().diagram?.id;
    if (!id) return get().reset();
    set({ loading: true, error: null, ...(get().diagramId !== id ? { diagramId: id, revisions: [] } : {}) });
    try {
      const page = await api.revisions(id, { limit: 100 });
      if (session.getState().diagram?.id !== id) return;
      set({ diagramId: id, revisions: page.revisions, hasMore: page.nextBefore !== null, retention: page.retention, loading: false, ...derive(page.revisions) });
    } catch (error) {
      set({ loading: false, error: 'Could not load the version history.' });
      void error;
    }
  },

  async loadMore() {
    const { revisions, hasMore, loading, diagramId } = get();
    const last = revisions[revisions.length - 1];
    if (!hasMore || loading || !last || !diagramId) return;
    set({ loading: true });
    try {
      const page = await api.revisions(diagramId, { before: last.version, limit: 100 });
      if (session.getState().diagram?.id !== diagramId) return;
      const all = [...revisions, ...page.revisions];
      set({ revisions: all, hasMore: page.nextBefore !== null, loading: false, ...derive(all) });
    } catch {
      set({ loading: false, error: 'Could not load more versions.' });
    }
  },

  /** Make the diagram look like `version` (as a new version). Returns whether it worked. */
  async restore(version) {
    if (get().busy) return false;
    set({ busy: true, error: null });
    try {
      const previous = sourceOf(get().revisions, session.getState().diagram?.version ?? 0);
      await restoreVersion(version);
      const head = session.getState().diagram?.version ?? 0;
      if (previous !== null && previous !== version) redoStack.push(previous);
      trail = { headVersion: head, source: version, graphKey: graphKey() };
      await get().load();
      return true;
    } catch (error) {
      set({ error: messageOf(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async undo() {
    if (get().busy) return false;
    await get().load(); // the list must be current: another tab or a voice edit may have added versions
    const head = session.getState().diagram?.version ?? 0;
    const source = sourceOf(get().revisions, head);
    if (source === null) return false;
    set({ busy: true, error: null });
    try {
      // Step to the nearest earlier version whose content differs; identical ones (an earlier undo's result) are skipped.
      for (const candidate of get().revisions.filter((r) => r.version < source).slice(0, 8)) {
        try {
          await restoreVersion(candidate.version);
        } catch (error) {
          if (error instanceof RefusedError && error.reason === 'ALREADY_CURRENT') continue;
          throw error;
        }
        redoStack.push(source);
        trail = { headVersion: session.getState().diagram?.version ?? 0, source: candidate.version, graphKey: graphKey() };
        await get().load();
        return true;
      }
      return false;
    } catch (error) {
      set({ error: messageOf(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async redo() {
    if (get().busy || redoStack.length === 0 || !trail) return false;
    const target = redoStack[redoStack.length - 1]!;
    set({ busy: true, error: null });
    try {
      await restoreVersion(target);
      redoStack.pop();
      trail = { headVersion: session.getState().diagram?.version ?? 0, source: target, graphKey: graphKey() };
      await get().load();
      return true;
    } catch (error) {
      set({ error: messageOf(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  reset() {
    redoStack = [];
    trail = null;
    set({ diagramId: null, revisions: [], hasMore: false, loading: false, busy: false, error: null, canUndo: false, canRedo: false, currentSource: null });
  },
}));

let reloadTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Keep the history in step with the document: reload (debounced) when the diagram or its version changes, and forget redo as soon
 * as the CONTENT changes by anything other than undo/redo (an edit, a typed or spoken command).
 */
export function watchHistory(): () => void {
  let lastId: string | null = null;
  let lastVersion = -1;
  return session.subscribe((state) => {
    const id = state.diagram?.id ?? null;
    const version = state.diagram?.version ?? -1;
    if (id !== lastId) {
      lastId = id;
      lastVersion = version;
      useHistoryStore.getState().reset();
      if (id) void useHistoryStore.getState().load();
      return;
    }
    if (version === lastVersion) return;
    lastVersion = version;
    if (trail && !restoring) {
      if (trail.headVersion === version) {
        /* our own restore landed */
      } else if (trail.graphKey === JSON.stringify(state.graph)) {
        trail = { ...trail, headVersion: version }; // only positions changed: undo/redo stay valid
      } else {
        trail = null;
        redoStack = [];
      }
    }
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void useHistoryStore.getState().load(), 600);
  });
}

/** Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y, except while the user is typing (text fields keep their own undo). */
export function historyKeyHandler(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
  const key = event.key.toLowerCase();
  const state = useHistoryStore.getState();
  if (key === 'z' && !event.shiftKey) {
    event.preventDefault();
    void state.undo();
  } else if ((key === 'z' && event.shiftKey) || key === 'y') {
    event.preventDefault();
    void state.redo();
  }
}
