import React, { useEffect, useState } from 'react';
import { Copy, Globe, LayoutGrid, Loader2, Lock, Plus, Settings, Users } from 'lucide-react';
import type { ProjectSummary } from '../contracts';
import { DitherGradient } from '../components/dither-kit/gradient';
import { ProjectCoverArt, presetFor } from '../components/ProjectCoverArt';
import { TiltCard } from '../components/TiltCard';
import { ProjectDialog } from '../components/ProjectDialog';
import { workspaceLink } from '../components/WorkspaceSettingsDialog';
import { timeAgo } from '../components/VersionsPanel';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { Crumbs, PageFrame, SectionTitle } from './pages';
import { useUi } from './uiStore';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const ProjectCard: React.FC<{ project: ProjectSummary; canEdit: boolean; onEdit: () => void }> = ({ project: p, canEdit, onEdit }) => {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    await useWorkspaceStore.getState().openProjectLatest(p.id);
    setOpening(false);
  };
  return (
    <TiltCard className="rounded-[20px]">
    <div className="group relative rounded-[20px] bg-surface lifted lifted-hover transition-shadow">
      <button onClick={() => void open()} data-sound="lift" className="w-full text-left rounded-[20px]" aria-label={`Open ${p.name}`} title={p.latestDiagram ? `Opens ${p.latestDiagram.name}` : 'Starts the first diagram'}>
        <ProjectCoverArt project={p} className="h-32 m-2 mb-0 rounded-xl" />
        <div className="px-4 pt-3 pb-3.5">
          <h3 className="text-[15.5px] font-semibold tracking-[-0.01em] text-ink truncate pr-8">{p.name}</h3>
          <p className="mt-1 min-h-[2.5rem] text-[13px] leading-relaxed text-body line-clamp-2">{p.description || (p.latestDiagram ? `Last worked on: ${p.latestDiagram.name}` : 'No diagrams yet.')}</p>
          <div className="mt-2.5 pt-2.5 border-t border-fill flex items-center gap-3 text-[12px] text-muted">
            <span>{plural(p.diagramCount, 'diagram')}</span>
            <span className="ml-auto">{opening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : timeAgo(p.updatedAt)}</span>
          </div>
        </div>
      </button>
      <div className="absolute right-3.5 top-3.5 flex items-center gap-1 rounded-lg bg-surface/90 border border-line p-0.5 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 focus-within:opacity-100 transition-opacity">
        <button onClick={() => void useWorkspaceStore.getState().openProject(p.id)} aria-label={`All diagrams in ${p.name}`} title="All diagrams" className="p-1.5 rounded-md text-body hover:text-ink hover:bg-canvas">
          <LayoutGrid className="w-4 h-4" />
        </button>
        {canEdit && (
          <button onClick={onEdit} aria-label={`Settings for ${p.name}`} title="Project settings and cover" className="p-1.5 rounded-md text-body hover:text-ink hover:bg-canvas">
            <Settings className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
    </TiltCard>
  );
};

/** One workspace: its details and its projects. */
export const WorkspacePage: React.FC = () => {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const projects = useWorkspaceStore((s) => s.projects);
  const [dialog, setDialog] = useState<ProjectSummary | 'new' | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void useWorkspaceStore.getState().loadProjects();
  }, [workspace?.id]);

  if (!workspace) return null;
  const canEdit = workspace.role !== 'VIEWER';
  const owner = workspace.role === 'OWNER';
  const preset = presetFor(workspace.id, workspace.cover)!;

  return (
    <PageFrame>
      <Crumbs items={[{ label: 'Dashboard', go: () => useUi.getState().set({ view: 'dashboard' }) }, { label: workspace.name }]} />
      <div className="arrive relative overflow-hidden rounded-[28px] bg-surface lifted px-6 sm:px-8 py-7" style={{ ['--group' as string]: 0 }}>
        <DitherGradient from={preset.from} to={preset.to} direction={preset.direction} cell={4} opacity={0.55} className="[mask-image:linear-gradient(to_left,black,transparent_65%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.03em] text-ink truncate">{workspace.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="px-1.5 py-0.5 rounded-md bg-fill font-mono text-[10px] uppercase tracking-[0.08em] text-body whitespace-nowrap">{workspace.personal ? 'Personal' : 'Team'}</span>
              <span className="flex items-center gap-1 text-[12px] text-muted whitespace-nowrap">
                {workspace.visibility === 'PUBLIC' ? <Globe className="w-3.5 h-3.5" aria-hidden /> : <Lock className="w-3.5 h-3.5" aria-hidden />}
                {workspace.visibility === 'PUBLIC' ? 'Anyone with the link can view' : 'Private'}
              </span>
              <span className="tabular flex items-center gap-1 text-[12px] text-muted whitespace-nowrap">
                <Users className="w-3.5 h-3.5" aria-hidden />
                {plural(workspace.memberCount, 'person')}
              </span>
            </div>
            {workspace.description && <p className="pretty mt-3 max-w-2xl text-[14px] leading-relaxed text-body">{workspace.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(workspaceLink(workspace.id)).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="h-10 px-3.5 rounded-xl bg-surface lifted text-[13px] font-medium flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" aria-hidden /> {copied ? 'Link copied' : 'Copy link'}
            </button>
            <button onClick={() => useUi.getState().set({ workspaceSettingsId: workspace.id })} className="h-10 px-3.5 rounded-xl bg-surface lifted text-[13px] font-medium flex items-center gap-1.5">
              <Settings className="w-3.5 h-3.5" aria-hidden /> {owner ? 'Settings and people' : 'People'}
            </button>
          </div>
        </div>
      </div>

      <section className="arrive mt-8" style={{ ['--group' as string]: 1 }}>
        <SectionTitle>Projects</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} canEdit={canEdit} onEdit={() => setDialog(p)} />
          ))}
          {canEdit && (
            <button onClick={() => setDialog('new')} className="rounded-[20px] border border-dashed border-line-strong bg-surface hover:border-ink min-h-[15rem] flex flex-col items-center justify-center gap-2 text-body hover:text-ink transition-colors">
              <Plus className="w-5 h-5 text-primary" />
              <span className="text-[14px] font-medium">New project</span>
              <span className="text-[12px] text-muted">Group related diagrams</span>
            </button>
          )}
        </div>
        {projects.length === 0 && <p className="mt-3 text-[13px] text-muted">Loading projects…</p>}
      </section>

      {dialog && (
        <ProjectDialog
          project={dialog === 'new' ? undefined : dialog}
          canDelete={owner && projects.length > 1}
          onClose={() => setDialog(null)}
        />
      )}
    </PageFrame>
  );
};
