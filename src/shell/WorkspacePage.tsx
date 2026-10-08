import React, { useEffect, useState } from 'react';
import { Copy, FolderKanban, Globe, Lock, Plus, Settings, Users } from 'lucide-react';
import type { ProjectSummary } from '../contracts';
import { ProjectDialog } from '../components/ProjectDialog';
import { workspaceLink } from '../components/WorkspaceSettingsDialog';
import { timeAgo } from '../components/VersionsPanel';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { Crumbs, PageFrame, SectionTitle } from './pages';
import { useUi } from './uiStore';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const ProjectCard: React.FC<{ project: ProjectSummary; canEdit: boolean; onEdit: () => void }> = ({ project: p, canEdit, onEdit }) => (
  <div className="group relative rounded-2xl border border-line bg-surface hover:border-line-strong hover:shadow-[0_4px_18px_rgba(38,37,30,0.07)] transition-all">
    <button onClick={() => void useWorkspaceStore.getState().openProject(p.id)} className="w-full text-left p-4 pb-3.5 rounded-2xl" aria-label={`Open ${p.name}`}>
      <span className="w-9 h-9 rounded-xl bg-primary-tint text-primary flex items-center justify-center">
        <FolderKanban className="w-[18px] h-[18px]" />
      </span>
      <h3 className="mt-3 text-[15.5px] font-semibold tracking-[-0.01em] text-ink truncate pr-8">{p.name}</h3>
      <p className="mt-1 min-h-[2.5rem] text-[13px] leading-relaxed text-body line-clamp-2">{p.description || 'No description yet.'}</p>
      <div className="mt-3 pt-3 border-t border-fill flex items-center gap-3 text-[12px] text-muted">
        <span>{plural(p.diagramCount, 'diagram')}</span>
        <span className="ml-auto">{timeAgo(p.updatedAt)}</span>
      </div>
    </button>
    {canEdit && (
      <button onClick={onEdit} aria-label={`Settings for ${p.name}`} title="Project settings" className="absolute right-3 top-3 p-1.5 rounded-lg text-muted hover:text-ink hover:bg-canvas">
        <Settings className="w-4 h-4" />
      </button>
    )}
  </div>
);

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

  return (
    <PageFrame>
      <Crumbs items={[{ label: 'All workspaces', go: () => useUi.getState().set({ view: 'dashboard' }) }, { label: workspace.name }]} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-ink truncate">{workspace.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="px-1.5 py-0.5 rounded-md bg-fill font-mono text-[10px] uppercase tracking-[0.08em] text-body">{workspace.personal ? 'Personal' : 'Team'}</span>
            <span className="flex items-center gap-1 text-[12px] text-muted">
              {workspace.visibility === 'PUBLIC' ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              {workspace.visibility === 'PUBLIC' ? 'Anyone with the link can view' : 'Private'}
            </span>
            <span className="flex items-center gap-1 text-[12px] text-muted">
              <Users className="w-3.5 h-3.5" />
              {plural(workspace.memberCount, 'person')}
            </span>
          </div>
          {workspace.description && <p className="mt-2 max-w-2xl text-[14px] text-body">{workspace.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(workspaceLink(workspace.id)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="h-9 px-3 rounded-lg border border-line bg-surface hover:bg-canvas text-[13px] font-medium flex items-center gap-1.5"
          >
            <Copy className="w-3.5 h-3.5" /> {copied ? 'Link copied' : 'Copy link'}
          </button>
          <button onClick={() => useUi.getState().set({ workspaceSettingsId: workspace.id })} className="h-9 px-3 rounded-lg border border-line bg-surface hover:bg-canvas text-[13px] font-medium flex items-center gap-1.5">
            <Settings className="w-3.5 h-3.5" /> {owner ? 'Settings & people' : 'People'}
          </button>
        </div>
      </div>

      <section className="mt-8">
        <SectionTitle>Projects</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} canEdit={canEdit} onEdit={() => setDialog(p)} />
          ))}
          {canEdit && (
            <button onClick={() => setDialog('new')} className="rounded-2xl border border-dashed border-line-strong bg-surface/60 hover:border-ink hover:bg-surface min-h-[10.5rem] flex flex-col items-center justify-center gap-2 text-body hover:text-ink transition-colors">
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
