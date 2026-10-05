import { create } from 'zustand';
import type { DiagramSummary, MeResponse, WorkspaceSummary } from '../contracts';
import { ApiError } from '../api/client';
import { api, session } from '../document/instance';
import { useConversationStore } from '../ai/conversationStore';
import { syncConversation } from '../ai/aiCommands';

const lastKey = (userId: string) => `tinker_last_diagram:${userId}`;
const remember = (userId: string | undefined, diagramId: string | null) => {
  if (!userId) return;
  try {
    if (diagramId) localStorage.setItem(lastKey(userId), diagramId);
    else localStorage.removeItem(lastKey(userId));
  } catch {
    /* storage unavailable */
  }
};
const recall = (userId: string): string | null => {
  try {
    return localStorage.getItem(lastKey(userId));
  } catch {
    return null;
  }
};

interface WorkspaceState {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  user: MeResponse['user'] | null;
  workspace: WorkspaceSummary | null;
  diagrams: DiagramSummary[];
  /** What this server can do (from /v1/me): typed commands are offered only when a model is configured. */
  features: MeResponse['features'];

  bootstrap(): Promise<void>;
  refreshList(): Promise<void>;
  openDiagram(id: string): Promise<void>;
  createDiagram(name?: string): Promise<void>;
  renameDiagram(name: string): Promise<void>;
  deleteCurrent(): Promise<void>;
  reset(): void;
}

const describe = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.');

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /** Finish what is queued before leaving a diagram; if it cannot be saved, ask rather than lose work silently. */
  async function settleBeforeLeaving(): Promise<boolean> {
    try {
      await session.flush();
      return true;
    } catch {
      return typeof window === 'undefined' ? false : window.confirm('Some changes in this diagram have not been saved. Leave anyway and discard them?');
    }
  }

  return {
    phase: 'idle',
    error: null,
    user: null,
    workspace: null,
    diagrams: [],
    features: { aiCommands: false, aiModel: false },

    async bootstrap() {
      set({ phase: 'loading', error: null });
      try {
        const me = await api.me();
        const workspace = me.workspaces.find((w) => w.personal) ?? me.workspaces[0] ?? null;
        if (!workspace) throw new Error('No workspace is available for this account.');
        set({ user: me.user, workspace, features: me.features });
        await get().refreshList();
        const diagrams = get().diagrams;
        const wanted = recall(me.user.id);
        const target = diagrams.find((d) => d.id === wanted) ?? diagrams[0];
        if (target) await get().openDiagram(target.id);
        else await get().createDiagram('My first diagram');
        set({ phase: 'ready' });
      } catch (e) {
        set({ phase: 'error', error: describe(e) });
      }
    },

    async refreshList() {
      const ws = get().workspace;
      if (!ws) return;
      const list = await api.listDiagrams(ws.id);
      set({ diagrams: list.diagrams });
    },

    async openDiagram(id) {
      if (session.getState().diagram?.id === id) return;
      if (session.getState().diagram && !(await settleBeforeLeaving())) return;
      await session.open(id);
      remember(get().user?.id, id);
      void syncConversation(id);
      await get().refreshList();
    },

    async createDiagram(name = 'Untitled diagram') {
      const ws = get().workspace;
      if (!ws) return;
      if (session.getState().diagram && !(await settleBeforeLeaving())) return;
      const created = await api.createDiagram(ws.id, name, crypto.randomUUID());
      session.adopt(created.data);
      remember(get().user?.id, created.data.diagramId);
      void syncConversation(created.data.diagramId);
      await get().refreshList();
    },

    async renameDiagram(name) {
      const trimmed = name.trim();
      if (!trimmed || trimmed === session.getState().diagram?.name) return;
      await session.renameDiagram(trimmed).catch(() => undefined); // failures surface through the save status
      await get().refreshList().catch(() => undefined);
    },

    async deleteCurrent() {
      const current = session.getState().diagram;
      if (!current) return;
      if (!(await settleBeforeLeaving())) return;
      try {
        await api.mutate.deleted({ method: 'DELETE', path: `/v1/diagrams/${current.id}?expectedVersion=${session.getState().diagram?.version ?? current.version}`, idempotencyKey: crypto.randomUUID() });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'DIAGRAM_VERSION_CONFLICT') {
          set({ error: 'This diagram changed elsewhere. Reload it before deleting.' });
          return;
        }
        throw e;
      }
      session.close();
      remember(get().user?.id, null);
      await get().refreshList();
      const next = get().diagrams[0];
      if (next) await get().openDiagram(next.id);
      else await get().createDiagram('My first diagram');
    },

    reset() {
      session.close();
      useConversationStore.getState().reset();
      set({ phase: 'idle', error: null, user: null, workspace: null, diagrams: [], features: { aiCommands: false, aiModel: false } });
    },
  };
});
