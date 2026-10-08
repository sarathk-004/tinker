import React, { useCallback, useEffect, useState } from 'react';
import { FolderInput, Loader2, Plus, Settings } from 'lucide-react';
import type { DiagramCard } from '../contracts';
import { api } from '../document/instance';
import { DitherGradient } from '../components/dither-kit/gradient';
import { ProjectDialog } from '../components/ProjectDialog';
import { CoverArt, presetFor } from '../components/ProjectCoverArt';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { Crumbs, DiagramCardView, PageFrame, SectionTitle } from './pages';
import { useUi } from './uiStore';

/** Moves a diagram to another project of the same workspace. */
const MoveMenu: React.FC<{ card: DiagramCard; onMoved: () => void }> = ({ card, onMoved }) => {
  const projects = useWorkspaceStore((s) => s.projects);
  const others = projects.filter((p) => p.id !== card.projectId);
  if (others.length === 0) return null;
  return (
    <label className="absolute right-2.5 top-[7.5rem] flex items-center gap-1 text-[11.5px] text-muted hover:text-ink cursor-pointer" title="Move to another project">
      <FolderInput className="w-3.5 h-3.5" />
      <select
        aria-label={`Move ${card.name} to another project`}
        value=""
        onChange={async (e) => {
          if (!e.target.value) return;
          const problem = await useWorkspaceStore.getState().moveDiagram(card.id, e.target.value);
          if (!problem) onMoved();
        }}
        className="bg-transparent outline-none cursor-pointer w-16 text-[11.5px]"
      >
        <option value="">Move…</option>
        {others.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
};

/** One project: its diagrams as cards. */
export const ProjectPage: React.FC = () => {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const project = useWorkspaceStore((s) => s.project);
  const projectCount = useWorkspaceStore((s) => s.projects.length);
  const [cards, setCards] = useState<DiagramCard[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!project) return;
    try {
      setCards(await api.projectDiagrams(project.id));
    } catch {
      setCards([]);
    }
  }, [project?.id]);

  useEffect(() => {
    setCards(null);
    void load();
  }, [load]);

  if (!workspace || !project) return null;
  const canEdit = workspace.role !== 'VIEWER';
  const owner = workspace.role === 'OWNER';
  const preset = presetFor(project.id, project.cover);

  const start = async () => {
    setCreating(true);
    await useWorkspaceStore.getState().newDiagramInEditor(project.id);
    setCreating(false);
  };

  return (
    <PageFrame>
      <Crumbs
        items={[
          { label: 'All workspaces', go: () => useUi.getState().set({ view: 'dashboard' }) },
          { label: workspace.name, go: () => useUi.getState().set({ view: 'workspace' }) },
          { label: project.name },
        ]}
      />
      <div className="arrive relative overflow-hidden rounded-[28px] bg-surface lifted px-6 sm:px-8 py-7" style={{ ['--group' as string]: 0 }}>
        {preset && <DitherGradient from={preset.from} to={preset.to} direction={preset.direction} cell={4} opacity={0.55} className="[mask-image:linear-gradient(to_left,black,transparent_65%)]" />}
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <CoverArt projectId={project.id} cover={project.cover} preview={project.latestDiagram?.preview ?? null} className="w-16 h-16 rounded-2xl flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.03em] text-ink truncate">{project.name}</h1>
              {project.description && <p className="pretty mt-2 max-w-2xl text-[14px] leading-relaxed text-body">{project.description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <button onClick={() => setEditing(true)} className="h-10 px-3.5 rounded-xl bg-surface lifted text-[13px] font-medium flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5" aria-hidden /> Project settings
              </button>
            )}
            {canEdit && (
              <button onClick={() => void start()} disabled={creating} className="h-10 pl-3 pr-3.5 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-60 text-white text-[13px] font-medium flex items-center gap-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.18)]">
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Plus className="w-3.5 h-3.5" aria-hidden />} New diagram
              </button>
            )}
          </div>
        </div>
      </div>

      <section className="arrive mt-8" style={{ ['--group' as string]: 1 }}>
        <SectionTitle>Diagrams</SectionTitle>
        {cards === null && (
          <div className="py-10 flex justify-center text-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {cards?.length === 0 && (
          <div className="rounded-[20px] bg-surface lifted px-4 py-10 text-center">
            <p className="text-[14px] text-ink font-medium">No diagrams in this project yet</p>
            <p className="mt-1 text-[13px] text-muted">{canEdit ? 'Start one, or describe a system to Tinker and let it draw.' : 'Nothing here yet.'}</p>
          </div>
        )}
        {cards && cards.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <DiagramCardView key={c.id} card={c} extra={canEdit ? <MoveMenu card={c} onMoved={() => void load()} /> : undefined} />
            ))}
          </div>
        )}
      </section>

      {editing && <ProjectDialog project={project} canDelete={owner && projectCount > 1} onClose={() => setEditing(false)} onDeleted={() => useUi.getState().set({ view: 'workspace' })} />}
    </PageFrame>
  );
};
