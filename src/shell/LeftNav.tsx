import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, FileText, History, LayoutGrid, Lightbulb, PlusCircle, Plus, Trash2, X } from 'lucide-react';
import { useAdvisor } from '../advisor/useAdvisor';
import { useDiagramStore } from '../diagram/store';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { VersionsPanel } from '../components/VersionsPanel';
import { MONO_LABEL } from './Popover';
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

const SEVERITY_DOT = { high: 'bg-[#cf2d56]', medium: 'bg-[#c08532]', low: 'bg-[#1f8a65]' } as const;

/** The left column: this workspace's diagrams, version history of the open diagram, and the architecture advisor. */
export const LeftNav: React.FC<{ overlay?: boolean }> = ({ overlay = false }) => {
  const diagrams = useWorkspaceStore((s) => s.diagrams);
  const currentId = useDiagramStore((s) => s.doc.diagram?.id);
  const current = useDiagramStore((s) => s.doc.diagram);
  const versionsOpen = useUi((s) => s.versionsOpen);
  const { suggestions, readiness, empty, count } = useAdvisor();
  const [advisorOpen, setAdvisorOpen] = useState(true);
  const closeOverlay = () => overlay && useUi.getState().set({ navOpen: false });

  const readinessColor = readiness >= 80 ? '#1f8a65' : readiness >= 50 ? '#c08532' : '#cf2d56';

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

      <div className="flex-shrink-0 border-t border-[#e6e5e0] px-3 pt-3 pb-3 max-h-[46%] overflow-y-auto">
        <button onClick={() => setAdvisorOpen((o) => !o)} aria-expanded={advisorOpen} className="w-full flex items-center justify-between px-1 mb-2">
          <span className={`flex items-center gap-1.5 ${MONO_LABEL}`}><Lightbulb className="w-3.5 h-3.5 text-[#f54e00]" /> Advisor</span>
          {!empty && (count >= 3 || suggestions.length > 0) && (
            <span className="font-mono text-[11px] px-2 py-0.5 rounded-md" style={{ color: readinessColor, background: `${readinessColor}1a` }}>
              {suggestions.length === 0 ? 'all clear' : `${suggestions.length} to review`}
            </span>
          )}
        </button>
        {advisorOpen &&
          (empty ? (
            <p className="px-1 text-[12.5px] leading-relaxed text-[#807d72]">Add a few components and the advisor will point out what a production system usually needs.</p>
          ) : count < 3 && suggestions.length === 0 ? (
            <p className="px-1 text-[12.5px] leading-relaxed text-[#807d72]">Nothing to flag yet. The advisor gets useful once the diagram has a few more components.</p>
          ) : (
            <div className="space-y-2">
              <div className="rounded-xl bg-[#fafaf7] border border-[#e6e5e0] p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12.5px] font-medium text-[#26251e]">Production readiness</span>
                  <span className="font-mono text-[12px] font-semibold" style={{ color: readinessColor }}>{readiness}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#efeee8] overflow-hidden"><div className="h-full rounded-full transition-all duration-300" style={{ width: `${readiness}%`, background: readinessColor }} /></div>
              </div>
              {suggestions.length === 0 ? (
                <div className="flex items-start gap-2 rounded-xl bg-[#e7f5ec] border border-[#1f8a65]/20 p-3">
                  <CheckCircle2 className="w-4 h-4 text-[#1f8a65] mt-0.5 flex-shrink-0" />
                  <p className="text-[12.5px] leading-snug text-[#26251e]">Entrance, caching, queueing, storage and sign-in are all covered.</p>
                </div>
              ) : (
                suggestions.map((s) => (
                  <div key={s.id} className="rounded-xl bg-[#fafaf7] border border-[#e6e5e0] p-3">
                    <div className="flex items-start gap-2">
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEVERITY_DOT[s.severity]}`} />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-[#26251e] leading-snug">{s.title}</div>
                        <div className={`mt-0.5 ${MONO_LABEL}`}>{s.category}</div>
                      </div>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-[#5a5852]">{s.reason}</p>
                    <button onClick={s.apply} className="mt-2 w-full h-8 rounded-lg border border-[#e6e5e0] bg-[#fafaf7] hover:bg-[#f54e00] hover:border-[#f54e00] hover:text-white text-[12.5px] font-medium flex items-center justify-center gap-1.5 transition-colors">
                      <PlusCircle className="w-3.5 h-3.5" /> {s.actionLabel}
                    </button>
                  </div>
                ))
              )}
            </div>
          ))}
      </div>
    </nav>
  );
};
