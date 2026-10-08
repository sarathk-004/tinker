import React from 'react';
import { ChevronDown, ChevronRight, FileText, History, LayoutGrid, Plus, Trash2, X } from 'lucide-react';
import { useDiagramStore } from '../diagram/store';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { VersionsPanel } from '../components/VersionsPanel';
import { AdvisorPanel } from './AdvisorPanel';
import { useUi } from './uiStore';

const NavRow: React.FC<{ icon: React.ReactNode; label: string; count?: number | string; active?: boolean; open?: boolean; onClick: () => void }> = ({ icon, label, count, active, open, onClick }) => (
  <button
    onClick={onClick}
    aria-expanded={open}
    className={`w-full flex items-center gap-3 h-10 px-3 rounded-lg text-[14px] font-medium transition-colors ${active ? 'bg-[#fdebe3] text-[#f54e00]' : 'text-[#26251e] hover:bg-[#f7f7f4]'}`}
  >
    <span className={active ? 'text-[#f54e00]' : 'text-[#5a5852]'}>{icon}</span>
    <span className="flex-1 text-left">{label}</span>
    {count !== undefined && <span className={`font-mono text-[11px] ${active ? 'text-[#f54e00]/80' : 'text-[#807d72]'}`}>{count}</span>}
    {open !== undefined && (open ? <ChevronDown className="w-3.5 h-3.5 text-[#807d72]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#807d72]" />)}
  </button>
);

/** The left column: this workspace's diagrams, version history of the open diagram, and the architecture advisor. */
export const LeftNav: React.FC<{ overlay?: boolean }> = ({ overlay = false }) => {
  const diagrams = useWorkspaceStore((s) => s.diagrams);
  const currentId = useDiagramStore((s) => s.doc.diagram?.id);
  const current = useDiagramStore((s) => s.doc.diagram);
  const versionsOpen = useUi((s) => s.versionsOpen);
  const closeOverlay = () => overlay && useUi.getState().set({ navOpen: false });

  return (
    <nav aria-label="Workspace" className="h-full w-[264px] flex-shrink-0 flex flex-col bg-white border-r border-[#e6e5e0] overflow-hidden">
      {overlay && (
        <div className="flex items-center justify-between px-4 h-12 border-b border-[#e6e5e0] lg:hidden">
          <span className="text-[14px] font-semibold">Navigation</span>
          <button onClick={closeOverlay} aria-label="Close navigation" className="p-1.5 rounded-lg hover:bg-[#f7f7f4]"><X className="w-4 h-4" /></button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-4 pb-3">
        <NavRow icon={<LayoutGrid className="w-[18px] h-[18px]" />} label="Diagrams" count={diagrams.length} active onClick={() => undefined} />
        <div className="mt-1 mb-2 ml-[22px] pl-3 border-l border-[#e6e5e0] space-y-0.5">
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
                  className={`w-full flex items-center gap-2 h-8 px-2.5 rounded-md text-[13.5px] text-left transition-colors ${active ? 'text-[#f54e00] font-medium' : 'text-[#5a5852] hover:text-[#26251e] hover:bg-[#f7f7f4]'}`}
                >
                  <FileText className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                  <span className="truncate">{d.name}</span>
                </button>
                {active && (
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete "${d.name}"? You can ask support to restore it within 30 days.`)) void useWorkspaceStore.getState().deleteCurrent();
                    }}
                    aria-label={`Delete ${d.name}`}
                    title="Delete this diagram"
                    className="absolute right-1.5 top-1.5 p-1 rounded-md text-[#807d72] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[#cf2d56] hover:bg-[#cf2d56]/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          <button onClick={() => void useWorkspaceStore.getState().createDiagram()} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-md text-[13.5px] text-[#807d72] hover:text-[#f54e00] hover:bg-[#f7f7f4]">
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
          <div className="mt-1 mb-2 h-80 rounded-xl border border-[#e6e5e0] bg-white overflow-hidden flex flex-col">
            <VersionsPanel />
          </div>
        )}
      </div>

      <AdvisorPanel />
    </nav>
  );
};
