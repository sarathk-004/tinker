import React, { useEffect, useState } from 'react';
import { FolderKanban, Globe, Keyboard, Layers, Loader2, Lock, Plus, Search, Settings, Sparkles, Users } from 'lucide-react';
import { LIMITS, type DiagramCard, type WorkspaceSummary } from '../contracts';
import { api } from '../document/instance';
import { DitherGradient } from '../components/dither-kit/gradient';
import { PresetArt, presetFor } from '../components/ProjectCoverArt';
import { RollingNumber } from '../components/RollingNumber';
import { TiltCard } from '../components/TiltCard';
import { timeAgo } from '../components/VersionsPanel';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { DiagramRow, PageFrame, SectionTitle } from './pages';
import { allowanceText } from './Composer';
import { useUi } from './uiStore';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ROLE_LABEL: Record<WorkspaceSummary['role'], string> = { OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer' };

/** Each landing page block arrives a beat after the one above it. */
const group = (n: number): React.CSSProperties => ({ ['--group' as string]: n });

/**
 * One workspace as a card. The outer corner is the inner corner plus the padding between them (20 = 12 + 8), so the picture sits
 * inside the card with matching curves. Its dithered banner is its own: the same workspace looks the same everywhere.
 */
export const WorkspaceCard: React.FC<{ workspace: WorkspaceSummary; current: boolean }> = ({ workspace: w, current }) => {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    await useWorkspaceStore.getState().openWorkspacePage(w.id);
    setOpening(false);
  };
  return (
    <TiltCard className="rounded-[20px]">
      <div className={`group relative rounded-[20px] bg-surface lifted lifted-hover transition-shadow ${current ? 'ring-2 ring-primary/40' : ''}`}>
        <button onClick={() => void open()} data-sound="lift" className="block w-full text-left rounded-[20px] p-2 pb-0" aria-label={`Open ${w.name}`}>
          <div className="relative">
            <PresetArt preset={presetFor(w.id, w.cover)!} className="img-outline h-24 rounded-xl" />
            <span aria-hidden className="absolute left-3 bottom-3 w-9 h-9 rounded-[10px] bg-surface lifted flex items-center justify-center font-mono text-[15px] font-semibold text-ink">
              {w.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
          </div>
          <div className="px-3 pt-3 pb-3.5">
            <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-ink truncate pr-8">{w.name}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded-md bg-fill font-mono text-[10px] uppercase tracking-[0.08em] text-body whitespace-nowrap">{w.personal ? 'Personal' : 'Team'}</span>
              <span className="px-1.5 py-0.5 rounded-md bg-fill font-mono text-[10px] uppercase tracking-[0.08em] text-muted whitespace-nowrap">{ROLE_LABEL[w.role]}</span>
              <span className="flex items-center gap-1 text-[11.5px] text-muted whitespace-nowrap">
                {w.visibility === 'PUBLIC' ? <Globe className="w-3 h-3" aria-hidden /> : <Lock className="w-3 h-3" aria-hidden />}
                {w.visibility === 'PUBLIC' ? 'Public link' : 'Private'}
              </span>
            </div>
            <p className="pretty mt-2.5 min-h-[2.5rem] text-[13px] leading-relaxed text-body line-clamp-2">{w.description || (w.personal ? 'Your own space for diagrams.' : 'No description yet.')}</p>
            <div className="tabular mt-3 pt-3 border-t border-fill flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
              <span>{plural(w.projectCount, 'project')}</span>
              <span>{plural(w.diagramCount, 'diagram')}</span>
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" aria-hidden />
                {w.memberCount}
              </span>
              <span className="ml-auto">{opening ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label="Opening" /> : timeAgo(w.updatedAt)}</span>
            </div>
          </div>
        </button>
        <button
          onClick={() => useUi.getState().set({ workspaceSettingsId: w.id })}
          aria-label={`Settings for ${w.name}`}
          title="Workspace settings"
          className="absolute right-4 top-4 w-9 h-9 flex items-center justify-center rounded-[10px] bg-surface/90 lifted text-body hover:text-ink"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </TiltCard>
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
        className="rounded-[20px] border border-dashed border-line-strong bg-surface hover:border-ink min-h-[17rem] flex flex-col items-center justify-center gap-2 text-body hover:text-ink disabled:opacity-50 transition-colors"
      >
        <span className="w-11 h-11 rounded-xl bg-primary-tint text-primary flex items-center justify-center">
          <Plus className="w-5 h-5" aria-hidden />
        </span>
        <span className="text-[14px] font-medium">New team workspace</span>
        <span className="text-[12px] text-muted">{atLimit ? 'Limit reached' : 'A shared place for a team'}</span>
      </button>
    );
  }
  return (
    <form onSubmit={create} className="rounded-[20px] bg-surface lifted p-4 min-h-[17rem] flex flex-col gap-2.5">
      <h3 className="text-[14px] font-semibold">New team workspace</h3>
      <label className="text-[12.5px] font-medium" htmlFor="new-workspace-name">
        Name
      </label>
      <input
        id="new-workspace-name"
        autoFocus
        value={name}
        maxLength={LIMITS.maxWorkspaceNameLength}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Payments platform"
        className="h-10 px-3 rounded-[10px] border border-line bg-canvas text-[13.5px] outline-none focus:border-ink"
      />
      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}
      <div className="mt-auto flex gap-2">
        <button type="submit" disabled={busy || !name.trim()} className="flex-1 h-10 rounded-[10px] bg-primary hover:bg-primary-hover disabled:bg-line disabled:text-faint text-white text-[13px] font-medium flex items-center justify-center gap-1.5">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />} Create workspace
        </button>
        <button type="button" onClick={() => setCreating(false)} className="h-10 px-3.5 rounded-[10px] border border-line text-[13px] hover:bg-canvas">
          Cancel
        </button>
      </div>
    </form>
  );
};

type Tone = 'primary' | 'blue' | 'violet' | 'amber';
const TONES: Record<Tone, { tile: string; icon: string }> = {
  primary: { tile: 'bg-primary-tint text-primary', icon: 'text-primary' },
  blue: { tile: 'bg-blue-tint text-blue', icon: 'text-blue' },
  violet: { tile: 'bg-violet-tint text-violet', icon: 'text-violet' },
  amber: { tile: 'bg-amber-tint text-amber', icon: 'text-amber' },
};

/** A number with a label. Outer corner 24 = icon corner 12 + padding 12. */
const Stat: React.FC<{ tone: Tone; icon: React.ReactNode; value: number; label: string }> = ({ tone, icon, value, label }) => (
  <div className="rounded-3xl bg-surface lifted p-3 pr-5 flex items-center gap-3.5">
    <span className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${TONES[tone].tile}`} aria-hidden>
      {icon}
    </span>
    <div className="min-w-0">
      <RollingNumber value={value} className="text-[28px] font-semibold tracking-[-0.03em] text-ink" />
      <div className="mt-1 text-[12.5px] text-muted truncate">{label}</div>
    </div>
  </div>
);

/** The single-key shortcuts, as a short vertical list, so the quick way is not a secret. */
const TipsCard: React.FC = () => (
  <div className="rounded-[20px] bg-surface lifted p-4">
    <div className="flex items-center gap-2.5">
      <span className="w-9 h-9 rounded-xl bg-violet-tint text-violet flex items-center justify-center flex-shrink-0" aria-hidden>
        <Keyboard className="w-[18px] h-[18px]" />
      </span>
      <span className="text-[14px] font-medium text-ink">Quick keys</span>
    </div>
    <dl className="mt-3 space-y-1.5">
      {([['C', 'Components'], ['R', 'Rename'], ['T', 'Add text'], ['K', 'Fit the view'], ['/', 'Message box'], ['?', 'All keys']] as const).map(([key, what]) => (
        <div key={key} className="flex items-center justify-between gap-3 text-[12.5px]">
          <dt className="text-body">{what}</dt>
          <dd>
            <kbd className="inline-flex min-w-[1.6rem] justify-center px-1.5 py-0.5 rounded-md bg-canvas font-mono text-[11px] text-ink shadow-[inset_0_0_0_1px_rgb(var(--ink)/0.08)]">{key}</kbd>
          </dd>
        </div>
      ))}
    </dl>
  </div>
);

/** Today's AI allowance as a bar and in words (never colour alone). */
const AllowanceCard: React.FC = () => {
  const quota = useWorkspaceStore((s) => s.quota);
  const allowance = allowanceText(quota);
  const used = quota && quota.ai.limit > 0 ? Math.min(1, quota.ai.used / quota.ai.limit) : 0;
  return (
    <div className="rounded-[20px] bg-surface lifted p-4 flex items-center gap-3" role="status">
      <span className="w-10 h-10 rounded-xl bg-primary-tint text-primary flex items-center justify-center flex-shrink-0" aria-hidden>
        <Sparkles className="w-[18px] h-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-ink">AI today</span>
        <span className={`block text-[12px] ${allowance?.out ? 'text-danger' : 'text-muted'}`}>{allowance ? allowance.text : 'Plain commands always work'}</span>
        {allowance && (
          <span className="mt-1.5 block h-1.5 rounded-full bg-fill overflow-hidden" aria-hidden>
            <span className={`block h-full rounded-full ${allowance.out ? 'bg-danger' : allowance.low ? 'bg-warn' : 'bg-primary'}`} style={{ width: `${Math.max(3, used * 100)}%` }} />
          </span>
        )}
      </span>
    </div>
  );
};

/** The landing page: where you are in numbers, where you left off, quick starts, and every workspace you belong to. */
export const Dashboard: React.FC = () => {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const current = useWorkspaceStore((s) => s.workspace);
  const user = useWorkspaceStore((s) => s.user);
  const [recent, setRecent] = useState<DiagramCard[] | null>(null);
  const first = (user?.displayName ?? '').trim().split(/\s+/)[0];
  const mine = workspaces.filter((w) => w.role === 'OWNER');
  const shared = workspaces.filter((w) => w.role !== 'OWNER');
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
    <PageFrame wide>
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)_19rem] items-start">
        <aside aria-label="Today" className="arrive order-2 lg:order-1 space-y-3 lg:sticky lg:top-0" style={group(2)}>
          <AllowanceCard />
          <TipsCard />
        </aside>

        <div className="order-1 lg:order-2 min-w-0">
          <section className="arrive relative overflow-hidden rounded-[28px] bg-surface lifted px-6 sm:px-9 py-8 sm:py-10" style={group(0)}>
            <DitherGradient from="orange" to="transparent" direction="up" cell={4} opacity={0.5} className="[mask-image:linear-gradient(to_left,black,transparent_70%)]" />
            <div className="relative max-w-xl">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-primary">Dashboard</p>
              <h1 className="mt-2 text-[34px] leading-[1.08] font-semibold tracking-[-0.035em] text-ink">{first ? `Welcome back, ${first}` : 'Welcome back'}</h1>
              <p className="pretty mt-2.5 text-[15px] leading-relaxed text-body">Pick up where you left off, or describe a new system and watch it take shape.</p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <button onClick={() => void startDiagram()} disabled={!personal} className="h-11 pl-3.5 pr-4 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-[14px] font-medium flex items-center gap-2 shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.18)]">
                  <Plus className="w-4 h-4" aria-hidden /> New diagram
                </button>
                <button onClick={() => useUi.getState().set({ paletteOpen: true })} className="h-11 pl-3.5 pr-4 rounded-xl bg-surface lifted text-ink text-[14px] font-medium flex items-center gap-2">
                  <Search className="w-4 h-4 text-body" aria-hidden /> Search everything
                  <kbd className="ml-1 font-mono text-[10.5px] text-muted">Ctrl K</kbd>
                </button>
              </div>
            </div>
          </section>

          <div className="arrive mt-4 grid grid-cols-2 xl:grid-cols-4 gap-3" style={group(1)}>
            <Stat tone="primary" icon={<Layers className="w-[22px] h-[22px]" />} value={workspaces.length} label="Workspaces" />
            <Stat tone="blue" icon={<FolderKanban className="w-[22px] h-[22px]" />} value={sum((w) => w.projectCount)} label="Projects" />
            <Stat tone="violet" icon={<Sparkles className="w-[22px] h-[22px]" />} value={sum((w) => w.diagramCount)} label="Diagrams" />
            <Stat tone="amber" icon={<Users className="w-[22px] h-[22px]" />} value={sum((w) => w.memberCount)} label="People" />
          </div>

          <section className="arrive mt-10" style={group(3)}>
            <SectionTitle>Your workspaces</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {mine.map((w) => (
                <WorkspaceCard key={w.id} workspace={w} current={w.id === current?.id} />
              ))}
              <NewWorkspaceCard />
            </div>
          </section>

          {shared.length > 0 && (
            <section className="arrive mt-10" style={group(4)}>
              <SectionTitle>Shared with you</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {shared.map((w) => (
                  <WorkspaceCard key={w.id} workspace={w} current={w.id === current?.id} />
                ))}
              </div>
            </section>
          )}
        </div>

        <aside aria-label="Recents" className="arrive order-3 space-y-3 lg:sticky lg:top-0" style={group(2)}>
          <SectionTitle>Recents</SectionTitle>
          {recent === null && (
            <div className="py-8 flex justify-center text-muted" role="status" aria-label="Loading your recent diagrams">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
          {recent?.length === 0 && (
            <div className="rounded-[20px] bg-surface lifted px-4 py-8 text-center">
              <p className="text-[14px] font-medium text-ink">Nothing here yet</p>
              <p className="mt-1 text-[12.5px] text-muted">The last diagrams you open appear here.</p>
              <button onClick={() => void startDiagram()} className="mt-4 h-10 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white text-[13.5px] font-medium">
                Start your first diagram
              </button>
            </div>
          )}
          {recent?.slice(0, 3).map((c) => (
            <DiagramRow key={c.id} card={c} />
          ))}
        </aside>
      </div>
    </PageFrame>
  );
};
