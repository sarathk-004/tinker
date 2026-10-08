import { create } from 'zustand';
import type { DiagramSummary, MeResponse, ProjectCover, ProjectSummary, Quota, WorkspaceDetail, WorkspaceSummary } from '../contracts';
import { useUi } from '../shell/uiStore';
import { playSound } from '../sound/uiSound';
import { ApiError } from '../api/client';
import { api, session } from '../document/instance';
import { useConversationStore } from '../ai/conversationStore';
import { syncConversation } from '../ai/aiCommands';
import { voice } from '../voice/voice';
import { useSpeechSettings } from '../voice/speech';

const lastKey = (userId: string) => `tinker_last_diagram:${userId}`;
const lastWorkspaceKey = (userId: string) => `tinker_last_workspace:${userId}`;
const rememberWorkspace = (userId: string | undefined, workspaceId: string) => {
  if (!userId) return;
  try {
    localStorage.setItem(lastWorkspaceKey(userId), workspaceId);
  } catch {
    /* storage unavailable */
  }
};
const recallWorkspace = (userId: string): string | null => {
  try {
    return localStorage.getItem(lastWorkspaceKey(userId));
  } catch {
    return null;
  }
};
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
  /** Every workspace this person belongs to (the switcher lists them). */
  workspaces: WorkspaceSummary[];
  diagrams: DiagramSummary[];
  /** The projects of the current workspace, and the one whose page or diagram is open. */
  projects: ProjectSummary[];
  project: ProjectSummary | null;
  /** Today's AI allowance (from /v1/me); refreshed after anything that can use it. */
  quota: Quota | null;
  /** What this server can do (from /v1/me): typed commands are offered only when a model is configured. */
  features: MeResponse['features'];

  bootstrap(): Promise<void>;
  refreshList(): Promise<void>;
  refreshQuota(): Promise<void>;
  switchWorkspace(id: string, opts?: { open?: boolean }): Promise<void>;
  loadProjects(): Promise<void>;
  /** Show one workspace's page (its projects) without opening any diagram. */
  openWorkspacePage(id: string): Promise<void>;
  /** Show a project's page (its diagrams). */
  openProject(id: string): Promise<void>;
  /** Open a diagram in the editor. */
  openDiagramInEditor(id: string): Promise<void>;
  /** Start a diagram in a project (the open one by default) and go to the editor. */
  newDiagramInEditor(projectId?: string, name?: string): Promise<void>;
  createProject(name: string, description?: string): Promise<string | null>;
  updateProject(id: string, patch: { name?: string; description?: string | null; cover?: ProjectCover | null }): Promise<string | null>;
  /** Open a project: straight into the diagram worked on most recently (a new one when it has none). */
  openProjectLatest(id: string): Promise<void>;
  deleteProject(id: string): Promise<string | null>;
  moveDiagram(diagramId: string, projectId: string): Promise<string | null>;
  /** Go to the editor in this workspace (from the dashboard or a link). */
  openWorkspace(id: string): Promise<void>;
  /** Re-read the list of workspaces (after settings, members or a delete changed them). */
  refreshWorkspaces(): Promise<void>;
  /** A workspace changed on the server: show its new name, visibility and counts everywhere. */
  workspaceChanged(detail: WorkspaceDetail): void;
  /** A workspace is gone (deleted, or this person left it). */
  workspaceGone(id: string): Promise<void>;
  /** Returns an error message to show, or null on success. */
  createWorkspace(name: string): Promise<string | null>;
  openDiagram(id: string): Promise<void>;
  createDiagram(name?: string, projectId?: string): Promise<void>;
  renameDiagram(name: string): Promise<void>;
  deleteCurrent(): Promise<void>;
  reset(): void;
}

/** `?workspace=<id>` in the address: a link to a workspace (the one the Share button copies). */
const linkedWorkspaceId = (): string | null => {
  try {
    const id = new URLSearchParams(window.location.search).get('workspace');
    return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
};
const clearWorkspaceLink = () => {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('workspace');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    /* leave the address as it is */
  }
};

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
    workspaces: [],
    diagrams: [],
    projects: [],
    project: null,
    quota: null,
    features: { aiCommands: false, aiModel: false, voice: false, speech: false, aiKey: { mode: 'server', source: 'NONE' } },

    async bootstrap() {
      set({ phase: 'loading', error: null });
      try {
        const me = await api.me();
        const wanted0 = linkedWorkspaceId() ?? recallWorkspace(me.user.id);
        let workspaces = me.workspaces;
        let workspace = workspaces.find((w) => w.id === wanted0) ?? workspaces.find((w) => w.personal) ?? workspaces[0] ?? null;
        const link = linkedWorkspaceId();
        if (link) {
          // A link goes straight to that workspace: one the person belongs to, or a public one they may look at.
          if (!workspaces.some((w) => w.id === link)) {
            const looked = await api.workspace(link).then((d) => d, () => null);
            if (looked) {
              const { member: _m, members: _ms, invites: _is, ...summary } = looked;
              workspaces = [...workspaces, summary];
              workspace = summary;
            }
          }
          if (workspace?.id === link) useUi.getState().set({ view: 'editor' });
          clearWorkspaceLink();
        }
        if (!workspace) throw new Error('No workspace is available for this account.');
        set({ user: me.user, workspace, workspaces, features: me.features, quota: me.quota });
        useSpeechSettings.setState({ serverCanSpeak: me.features.speech });
        await get().refreshList();
        void get().loadProjects();
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

    async refreshQuota() {
      try {
        const me = await api.me();
        set({ quota: me.quota, features: me.features });
      } catch {
        /* the readout is a convenience: it catches up on the next refresh */
      }
    },

    async switchWorkspace(id, opts = {}) {
      const target = get().workspaces.find((w) => w.id === id);
      if (!target || target.id === get().workspace?.id) return;
      if (session.getState().diagram && !(await settleBeforeLeaving())) return;
      voice.dispose();
      session.close();
      useConversationStore.getState().reset();
      set({ workspace: target, diagrams: [], projects: [], project: null });
      rememberWorkspace(get().user?.id, target.id);
      await get().refreshList();
      void get().loadProjects();
      if (opts.open === false) return;
      const diagrams = get().diagrams;
      const target0 = diagrams[0];
      if (target0) await get().openDiagram(target0.id);
      else if (target.role !== 'VIEWER') await get().createDiagram('My first diagram');
    },

    async openWorkspace(id) {
      await get().openWorkspacePage(id);
    },

    async openWorkspacePage(id) {
      useUi.getState().set({ view: 'workspace' });
      await get().switchWorkspace(id, { open: false });
      void get().loadProjects();
    },

    async loadProjects() {
      const ws = get().workspace;
      if (!ws) return;
      try {
        const projects = await api.projects(ws.id);
        if (get().workspace?.id !== ws.id) return;
        const open = get().project;
        set({ projects, project: open ? (projects.find((p) => p.id === open.id) ?? null) : null });
      } catch {
        /* the page shows what it has; the next visit tries again */
      }
    },

    async openProject(id) {
      const found = get().projects.find((p) => p.id === id);
      if (found) set({ project: found });
      useUi.getState().set({ view: 'project' });
    },

    async openProjectLatest(id) {
      const found = get().projects.find((p) => p.id === id);
      if (found) set({ project: found });
      if (found?.latestDiagram) await get().openDiagramInEditor(found.latestDiagram.id);
      else await get().newDiagramInEditor(id);
    },

    async openDiagramInEditor(id) {
      await get().openDiagram(id);
      const projectId = session.getState().diagram?.projectId;
      const project = get().projects.find((p) => p.id === projectId);
      if (project) set({ project });
      useUi.getState().set({ view: 'editor' });
    },

    async newDiagramInEditor(projectId, name) {
      await get().createDiagram(name, projectId);
      const created = session.getState().diagram?.projectId;
      const project = get().projects.find((p) => p.id === created);
      if (project) set({ project });
      useUi.getState().set({ view: 'editor' });
      void get().loadProjects();
    },

    async createProject(name, description) {
      const ws = get().workspace;
      const trimmed = name.trim();
      if (!ws) return 'Open a workspace first.';
      if (!trimmed) return 'Give the project a name.';
      try {
        await api.createProject(ws.id, trimmed, description?.trim() || undefined);
        playSound('chime');
        await get().loadProjects();
        void get().refreshWorkspaces();
        return null;
      } catch (e) {
        return describe(e);
      }
    },

    async updateProject(id, patch) {
      try {
        await api.updateProject(id, patch);
        await get().loadProjects();
        return null;
      } catch (e) {
        return describe(e);
      }
    },

    async deleteProject(id) {
      try {
        await api.deleteProject(id);
        if (get().project?.id === id) set({ project: null });
        await get().loadProjects();
        await get().refreshList();
        void get().refreshWorkspaces();
        return null;
      } catch (e) {
        return describe(e);
      }
    },

    async moveDiagram(diagramId, projectId) {
      try {
        await api.moveDiagram(diagramId, projectId);
        await get().refreshList();
        await get().loadProjects();
        return null;
      } catch (e) {
        return describe(e);
      }
    },

    async refreshWorkspaces() {
      try {
        const me = await api.me();
        const current = get().workspace;
        // A public workspace someone is only looking at is not in their own list: keep showing it while it is open.
        const workspaces = current && !me.workspaces.some((w) => w.id === current.id) && get().workspaces.some((w) => w.id === current.id) ? [...me.workspaces, current] : me.workspaces;
        set({ workspaces, quota: me.quota, features: me.features, workspace: workspaces.find((w) => w.id === current?.id) ?? current });
      } catch {
        /* the list catches up on the next refresh */
      }
    },

    workspaceChanged(detail) {
      const { member: _member, members: _members, invites: _invites, ...summary } = detail;
      set({
        workspaces: get().workspaces.map((w) => (w.id === summary.id ? summary : w)),
        workspace: get().workspace?.id === summary.id ? summary : get().workspace,
      });
    },

    async workspaceGone(id) {
      const rest = get().workspaces.filter((w) => w.id !== id);
      set({ workspaces: rest });
      if (get().workspace?.id === id) {
        const home = rest.find((w) => w.personal) ?? rest[0];
        useUi.getState().set({ view: 'dashboard' });
        if (home) {
          set({ workspace: null });
          session.close();
          await get().switchWorkspace(home.id);
        }
      }
    },

    async createWorkspace(name) {
      const trimmed = name.trim();
      if (!trimmed) return 'Give the workspace a name.';
      try {
        const created = await api.createWorkspace(trimmed, crypto.randomUUID());
        set({ workspaces: [...get().workspaces.filter((w) => w.id !== created.data.id), created.data] });
        await get().openWorkspacePage(created.data.id);
        playSound('chime');
        return null;
      } catch (e) {
        return e instanceof ApiError && e.code === 'DOMAIN_VALIDATION_FAILED' ? e.message : describe(e);
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
      voice.dispose(); // a voice session belongs to one diagram
      await session.open(id);
      remember(get().user?.id, id);
      void syncConversation(id);
      await get().refreshList();
    },

    async createDiagram(name = 'Untitled diagram', projectId) {
      const ws = get().workspace;
      if (!ws) return;
      if (session.getState().diagram && !(await settleBeforeLeaving())) return;
      voice.dispose();
      const into = projectId ?? get().project?.id ?? session.getState().diagram?.projectId;
      const created = await api.createDiagram(ws.id, name, crypto.randomUUID(), into);
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
      voice.dispose();
      session.close();
      remember(get().user?.id, null);
      await get().refreshList();
      const next = get().diagrams[0];
      if (next) await get().openDiagram(next.id);
      else await get().createDiagram('My first diagram');
    },

    reset() {
      voice.dispose();
      session.close();
      useConversationStore.getState().reset();
      set({ phase: 'idle', error: null, user: null, workspace: null, workspaces: [], quota: null, diagrams: [], projects: [], project: null, features: { aiCommands: false, aiModel: false, voice: false, speech: false, aiKey: { mode: 'server', source: 'NONE' } } });
    },
  };
});
