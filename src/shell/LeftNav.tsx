import React from 'react';
import { ChevronDown, ChevronRight, History, LayoutGrid, Plus, Trash2, X } from 'lucide-react';
import { useDiagramStore } from '../diagram/store';
import { CoverArt } from '../components/ProjectCoverArt';
import { DiagramIcon } from '../components/DiagramIcon';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { VersionsPanel } from '../components/VersionsPanel';
import { AdvisorPanel } from './AdvisorPanel';
import { useUi } from './uiStore';

const NavRow: React.FC<{ icon: React.ReactNode; label: string; count?: number | string; active?: boolean; open?: boolean; onClick: () => void }> = ({ icon, label, count, active, open, onClick }) => (
  <button
    onClick={onClick}
    aria-expanded={open}
    className={`w-full flex items-center gap-3 h-10 px-3 rounded-lg text-[14px] font-medium transition-colors ${active ? 'bg-primary-tint text-primary' : 'text-ink hover:bg-canvas'}`}
  >
    <span className={active ? 'text-primary' : 'text-body'}>{icon}</span>
    <span className="flex-1 text-left">{label}</span>
    {count !== undefined && <span className={`font-mono text-[11px] ${active ? 'text-primary/80' : 'text-muted'}`}>{count}</span>}
    {open !== undefined && (open ? <ChevronDown className="w-3.5 h-3.5 text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-muted" />)}
  </button>
);

/** The left column: this workspace's diagrams, version history of the open diagram, and the architecture advisor. */
export const LeftNav: React.FC<{ overlay?: boolean }> = ({ overlay = false }) => {
  const allDiagrams = useWorkspaceStore((s) => s.diagrams);
  const projects = useWorkspaceStore((s) => s.projects);
  const currentId = useDiagramStore((s) => s.doc.diagram?.id);
  const current = useDiagramStore((s) => s.doc.diagram);
  const versionsOpen = useUi((s) => s.versionsOpen);
  const projectId = current?.projectId;
  const project = projects.find((p) => p.id === projectId);
  const diagrams = projectId ? allDiagrams.filter((d) => d.projectId === projectId) : allDiagrams;
  const closeOverlay = () => overlay && useUi.getState().set({ navOpen: false });

  return (
    <nav aria-label="Workspace" className="h-full w-[264px] flex-shrink-0 flex flex-col bg-surface border-r border-line overflow-hidden">
      {overlay && (
        <div className="flex items-center justify-between px-4 h-12 border-b border-line lg:hidden">
          <span className="text-[14px] font-semibold">Navigation</span>
          <button onClick={closeOverlay} aria-label="Close navigation" className="p-1.5 rounded-lg hover:bg-canvas"><X className="w-4 h-4" /></button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-4 pb-3">
        <NavRow icon={project ? <CoverArt projectId={project.id} cover={project.cover} preview={null} className="w-[18px] h-[18px] rounded-[5px]" /> : <LayoutGrid className="w-[18px] h-[18px]" />} label={project ? project.name : 'Diagrams'} count={diagrams.length} active onClick={() => project && void useWorkspaceStore.getState().openProject(project.id)} />
        <div className="mt-1 mb-2 ml-[22px] pl-3 border-l border-line space-y-0.5">
          {diagrams.map((d) => {
            const active = d.id === currentId;
            return (
              <div key={d.id} className="group relative">
                <button
                  onClick={() => {
                    closeOverlay();
                    void useWorkspaceStore.getState().openDiagram(d.id);
                  }}
                  aria-current={active ? 'true' : undefined}
                  title={d.name}
                  className={`w-full flex items-center gap-2 h-8 px-2.5 rounded-md text-[13.5px] text-left transition-colors ${active ? 'text-primary font-medium' : 'text-body hover:text-ink hover:bg-canvas'}`}
                >
                  <DiagramIcon icon={d.icon} size={22} />
                  <span className="truncate">{d.name}</span>
                </button>
                {active && (
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete "${d.name}"? You can ask support to restore it within 30 days.`)) void useWorkspaceStore.getState().deleteCurrent();
                    }}
                    aria-label={`Delete ${d.name}`}
                    title="Delete this diagram"
                    className="absolute right-1.5 top-1.5 p-1 rounded-md text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger hover:bg-danger/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          <button onClick={() => void useWorkspaceStore.getState().createDiagram()} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-md text-[13.5px] text-muted hover:text-primary hover:bg-canvas">
            <Plus className="w-3.5 h-3.5" /> New diagram
          </button>
        </div>

        <NavRow
          icon={<History className="w-[18px] h-[18px]" />}
          label="Version history"
          count={current ? `v${current.version}` : undefined}
          open={versionsOpen}
          onClick={() => useUi.getState().set({ versionsOpen: !versionsOpen })}
        />
        {versionsOpen && (
          <div className="mt-1 mb-2 h-80 rounded-xl border border-line bg-surface overflow-hidden flex flex-col">
            <VersionsPanel />
          </div>
        )}
      </div>

      <AdvisorPanel />
    </nav>
  );
};
