import React, { useEffect, useState } from 'react';
import { FolderKanban, Globe, Layers, Loader2, Lock, Plus, Search, Settings, Sparkles, Users } from 'lucide-react';
import { LIMITS, type DiagramCard, type WorkspaceSummary } from '../contracts';
import { api } from '../document/instance';
import { timeAgo } from '../components/VersionsPanel';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { DiagramCardView, PageFrame, SectionTitle } from './pages';
import { allowanceText } from './Composer';
import { useUi } from './uiStore';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ROLE_LABEL: Record<WorkspaceSummary['role'], string> = { OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer' };

/** One workspace as a card: its name and kind, what is in it, who can see it, and when it last changed. Click to open it. */
export const WorkspaceCard: React.FC<{ workspace: WorkspaceSummary; current: boolean }> = ({ workspace: w, current }) => {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    await useWorkspaceStore.getState().openWorkspacePage(w.id);
    setOpening(false);
  };
  return (
    <div className={`group relative rounded-2xl border bg-surface hover:border-line-strong hover:shadow-[0_4px_18px_rgba(38,37,30,0.07)] transition-all ${current ? 'border-primary/50' : 'border-line'}`}>
      <button onClick={() => void open()} className="w-full text-left p-4 pb-3 rounded-2xl" aria-label={`Open ${w.name}`}>
        <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-ink truncate pr-8">{w.name}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded-md bg-fill font-mono text-[10px] uppercase tracking-[0.08em] text-body">{w.personal ? 'Personal' : 'Team'}</span>
          <span className="px-1.5 py-0.5 rounded-md border border-line font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{ROLE_LABEL[w.role]}</span>
          <span className="flex items-center gap-1 text-[11.5px] text-muted">
            {w.visibility === 'PUBLIC' ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
            {w.visibility === 'PUBLIC' ? 'Anyone with the link can view' : 'Private'}
          </span>
        </div>
        <p className="mt-2.5 min-h-[2.5rem] text-[13px] leading-relaxed text-body line-clamp-2">{w.description || (w.personal ? 'Your own space for diagrams.' : 'No description yet.')}</p>
        <div className="mt-3 pt-3 border-t border-fill flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          <span>{plural(w.projectCount, 'project')}</span>
          <span>{plural(w.diagramCount, 'diagram')}</span>
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {w.memberCount}
          </span>
          <span className="ml-auto">{opening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : timeAgo(w.updatedAt)}</span>
        </div>
      </button>
      <button
        onClick={() => useUi.getState().set({ workspaceSettingsId: w.id })}
        aria-label={`Settings for ${w.name}`}
        title="Workspace settings"
        className="absolute right-3 top-3 p-1.5 rounded-lg text-muted hover:text-ink hover:bg-canvas"
      >
        <Settings className="w-4 h-4" />
      </button>
    </div>
  );
};

const NewWorkspaceCard: React.FC = () => {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const owned = useWorkspaceStore((s) => s.workspaces.filter((w) => !w.personal && w.role === 'OWNER').length);
  const atLimit = owned >= LIMITS.maxOwnedWorkspaces;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const problem = await useWorkspaceStore.getState().createWorkspace(name);
    setBusy(false);
    if (problem) return setError(problem);
    setName('');
    setCreating(false);
    useUi.getState().set({ view: 'workspace' });
  };

  if (!creating) {
    return (
      <button
        onClick={() => setCreating(true)}
        disabled={atLimit}
        title={atLimit ? `You can own up to ${LIMITS.maxOwnedWorkspaces} team workspaces.` : undefined}
        className="rounded-2xl border border-dashed border-line-strong bg-surface/60 hover:border-ink hover:bg-surface min-h-[10.5rem] flex flex-col items-center justify-center gap-2 text-body hover:text-ink disabled:opacity-50 disabled:hover:border-line-strong transition-colors"
      >
        <Plus className="w-5 h-5 text-primary" />
        <span className="text-[14px] font-medium">New team workspace</span>
        <span className="text-[12px] text-muted">{atLimit ? 'Limit reached' : 'A shared place for a team'}</span>
      </button>
    );
  }
  return (
    <form onSubmit={create} className="rounded-2xl border border-line-strong bg-surface p-4 min-h-[10.5rem] flex flex-col gap-2.5">
      <h3 className="text-[14px] font-semibold">New team workspace</h3>
      <input
        autoFocus
        value={name}
        maxLength={LIMITS.maxWorkspaceNameLength}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name, e.g. Payments platform"
        aria-label="Workspace name"
        className="h-9 px-3 rounded-lg border border-line bg-canvas text-[13.5px] outline-none focus:border-ink"
      />
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <div className="mt-auto flex gap-2">
        <button type="submit" disabled={busy || !name.trim()} className="flex-1 h-9 rounded-lg bg-primary hover:bg-primary-hover disabled:bg-line disabled:text-faint text-white text-[13px] font-medium flex items-center justify-center gap-1.5">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create
        </button>
        <button type="button" onClick={() => setCreating(false)} className="h-9 px-3 rounded-lg border border-line text-[13px] hover:bg-canvas">
          Cancel
        </button>
      </div>
    </form>
  );
};

const Stat: React.FC<{ icon: React.ReactNode; value: number; label: string }> = ({ icon, value, label }) => (
  <div className="rounded-2xl border border-line bg-surface px-4 py-3.5 flex items-center gap-3">
    <span className="w-9 h-9 rounded-xl bg-primary-tint text-primary flex items-center justify-center flex-shrink-0">{icon}</span>
    <div className="min-w-0">
      <div className="text-[22px] leading-none font-semibold tracking-[-0.03em] text-ink">{value}</div>
      <div className="mt-1 text-[12px] text-muted truncate">{label}</div>
    </div>
  </div>
);

const Action: React.FC<{ icon: React.ReactNode; title: string; hint: string; onClick: () => void; disabled?: boolean }> = ({ icon, title, hint, onClick, disabled }) => (
  <button onClick={onClick} disabled={disabled} className="text-left rounded-2xl border border-line bg-surface hover:border-line-strong hover:shadow-[0_4px_18px_rgba(38,37,30,0.07)] px-4 py-3.5 flex items-start gap-3 disabled:opacity-50 transition-all">
    <span className="w-9 h-9 rounded-xl bg-fill text-ink flex items-center justify-center flex-shrink-0">{icon}</span>
    <span className="min-w-0">
      <span className="block text-[14px] font-medium text-ink">{title}</span>
      <span className="block text-[12px] text-muted">{hint}</span>
    </span>
  </button>
);

/** The landing page: your numbers, where you left off, quick starts, and every workspace you belong to. */
export const Dashboard: React.FC = () => {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.workspace);
  const user = useWorkspaceStore((s) => s.user);
  const quota = useWorkspaceStore((s) => s.quota);
  const [recent, setRecent] = useState<DiagramCard[] | null>(null);
  const first = (user?.displayName ?? '').trim().split(/\s+/)[0];
  const mine = workspaces.filter((w) => w.role === 'OWNER');
  const shared = workspaces.filter((w) => w.role !== 'OWNER');
  const allowance = allowanceText(quota);
  const personal = workspaces.find((w) => w.personal);

  useEffect(() => {
    let live = true;
    void useWorkspaceStore.getState().refreshWorkspaces();
    api.recentDiagrams().then(
      (cards) => live && setRecent(cards),
      () => live && setRecent([]),
    );
    return () => {
      live = false;
    };
  }, []);

  const startDiagram = async () => {
    if (!personal) return;
    await useWorkspaceStore.getState().switchWorkspace(personal.id, { open: false });
    await useWorkspaceStore.getState().loadProjects();
    await useWorkspaceStore.getState().newDiagramInEditor();
  };

  const sum = (pick: (w: WorkspaceSummary) => number) => workspaces.reduce((n, w) => n + pick(w), 0);

  return (
    <PageFrame>
      <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-ink">{first ? `Welcome back, ${first}` : 'Your workspaces'}</h1>
      <p className="mt-1 text-[14px] text-body">Pick up where you left off, or start something new.</p>

      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={<Layers className="w-[18px] h-[18px]" />} value={workspaces.length} label="Workspaces" />
        <Stat icon={<FolderKanban className="w-[18px] h-[18px]" />} value={sum((w) => w.projectCount)} label="Projects" />
        <Stat icon={<Sparkles className="w-[18px] h-[18px]" />} value={sum((w) => w.diagramCount)} label="Diagrams" />
        <Stat icon={<Users className="w-[18px] h-[18px]" />} value={sum((w) => w.memberCount)} label="People across them" />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Action icon={<Plus className="w-[18px] h-[18px]" />} title="New diagram" hint="Start in your personal workspace" onClick={() => void startDiagram()} disabled={!personal} />
        <Action icon={<Search className="w-[18px] h-[18px]" />} title="Search everything" hint="Diagrams, components and actions (Ctrl K)" onClick={() => useUi.getState().set({ paletteOpen: true })} />
        <div className="rounded-2xl border border-line bg-surface px-4 py-3.5 flex items-start gap-3">
          <span className="w-9 h-9 rounded-xl bg-fill text-ink flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-[18px] h-[18px]" />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-medium text-ink">AI today</span>
            <span className={`block text-[12px] ${allowance?.out ? 'text-danger' : 'text-muted'}`}>{allowance ? allowance.text : 'Plain commands always work'}</span>
          </span>
        </div>
      </div>

      <section className="mt-8">
        <SectionTitle>Continue where you left off</SectionTitle>
        {recent === null && (
          <div className="py-8 flex justify-center text-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {recent?.length === 0 && <p className="rounded-2xl border border-dashed border-line-strong bg-surface/60 px-4 py-6 text-[13px] text-muted text-center">Diagrams you work on show up here.</p>}
        {recent && recent.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recent.slice(0, 4).map((c) => (
              <DiagramCardView key={c.id} card={c} showPath />
            ))}
          </div>
        )}
      </section>

      <section className="mt-9">
        <SectionTitle>Your workspaces</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mine.map((w) => (
            <WorkspaceCard key={w.id} workspace={w} current={w.id === current?.id} />
          ))}
          <NewWorkspaceCard />
        </div>
      </section>

      {shared.length > 0 && (
        <section className="mt-9">
          <SectionTitle>Shared with you</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shared.map((w) => (
              <WorkspaceCard key={w.id} workspace={w} current={w.id === current?.id} />
            ))}
          </div>
        </section>
      )}
    </PageFrame>
  );
};
