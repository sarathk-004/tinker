import React, { useState } from 'react';
import { Globe, Loader2, Lock, Plus, Settings, Users } from 'lucide-react';
import { LIMITS, type WorkspaceSummary } from '../contracts';
import { timeAgo } from '../components/VersionsPanel';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { useUi } from './uiStore';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const ROLE_LABEL: Record<WorkspaceSummary['role'], string> = { OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer' };

/** One workspace as a card: its name and kind, what is in it, who can see it, and when it last changed. Click to open it. */
export const WorkspaceCard: React.FC<{ workspace: WorkspaceSummary; current: boolean }> = ({ workspace: w, current }) => {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    await useWorkspaceStore.getState().openWorkspace(w.id);
    setOpening(false);
  };
  return (
    <div className={`group relative rounded-2xl border bg-surface hover:border-line-strong hover:shadow-[0_4px_18px_rgba(38,37,30,0.07)] transition-all ${current ? 'border-primary/50' : 'border-line'}`}>
      <button onClick={() => void open()} className="w-full text-left p-4 pb-3 rounded-2xl" aria-label={`Open ${w.name}`}>
        <div className="flex items-start justify-between gap-3 pr-8">
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-ink truncate">{w.name}</h3>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded-md bg-fill font-mono text-[10px] uppercase tracking-[0.08em] text-body">{w.personal ? 'Personal' : 'Team'}</span>
          <span className="px-1.5 py-0.5 rounded-md border border-line font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{ROLE_LABEL[w.role]}</span>
          <span className="flex items-center gap-1 text-[11.5px] text-muted">
            {w.visibility === 'PUBLIC' ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
            {w.visibility === 'PUBLIC' ? 'Anyone with the link can view' : 'Private'}
          </span>
        </div>
        <p className="mt-2.5 min-h-[2.5rem] text-[13px] leading-relaxed text-body line-clamp-2">{w.description || (w.personal ? 'Your own space for diagrams.' : 'No description yet.')}</p>
        <div className="mt-3 pt-3 border-t border-fill flex items-center gap-3 text-[12px] text-muted">
          <span>{plural(w.diagramCount, 'diagram')}</span>
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {plural(w.memberCount, 'person')}
          </span>
          <span className="ml-auto">{opening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : `Updated ${timeAgo(w.updatedAt)}`}</span>
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
    useUi.getState().set({ view: 'editor' });
  };

  if (!creating) {
    return (
      <button
        onClick={() => setCreating(true)}
        disabled={atLimit}
        title={atLimit ? `You can own up to ${LIMITS.maxOwnedWorkspaces} team workspaces.` : undefined}
        className="rounded-2xl border border-dashed border-line-strong hover:border-ink hover:bg-surface min-h-[10.5rem] flex flex-col items-center justify-center gap-2 text-body hover:text-ink disabled:opacity-50 disabled:hover:border-line-strong disabled:hover:bg-transparent transition-colors"
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

/** The landing page: every workspace you belong to, with what is in each. */
export const Dashboard: React.FC = () => {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.workspace);
  const user = useWorkspaceStore((s) => s.user);
  const first = (user?.displayName ?? '').trim().split(/\s+/)[0];
  const mine = workspaces.filter((w) => w.role === 'OWNER');
  const shared = workspaces.filter((w) => w.role !== 'OWNER');

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 py-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.03em] text-ink">{first ? `Welcome back, ${first}` : 'Your workspaces'}</h1>
        <p className="mt-1 text-[14px] text-body">Pick a workspace to open its diagrams, or start a new one for your team.</p>

        <section className="mt-7">
          <h2 className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">Your workspaces</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((w) => (
              <WorkspaceCard key={w.id} workspace={w} current={w.id === current?.id} />
            ))}
            <NewWorkspaceCard />
          </div>
        </section>

        {shared.length > 0 && (
          <section className="mt-9">
            <h2 className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">Shared with you</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shared.map((w) => (
                <WorkspaceCard key={w.id} workspace={w} current={w.id === current?.id} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
