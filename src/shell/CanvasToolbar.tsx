import React, { useState } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { ArrowRightLeft, ArrowUpDown, ChevronDown, Edit3, Hand, Layers, LayoutGrid, Maximize, MousePointer2, Play, Plus, Redo2, Trash2, Undo2, ZoomIn, ZoomOut, Shapes } from 'lucide-react';
import { AWSIcon } from '../components/icons/AWSIcons';
import { useDiagramStore } from '../diagram/store';
import { useHistoryStore } from '../history/history';
import { MOD_KEY } from './TopBar';
import { MENU_PANEL, MONO_LABEL, useDismiss } from './Popover';
import { PALETTE, type QuickComponent } from './palette';
import { useUi } from './uiStore';

const IconButton: React.FC<{ label: string; onClick: () => void; disabled?: boolean; active?: boolean; danger?: boolean; children: React.ReactNode; badge?: number }> = ({ label, onClick, disabled, active, danger, children, badge }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    aria-pressed={active}
    className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors disabled:opacity-35 disabled:hover:bg-transparent ${
      active ? 'bg-[#fdebe3] text-[#f54e00]' : danger ? 'text-[#5a5852] hover:text-[#cf2d56] hover:bg-[#cf2d56]/10' : 'text-[#5a5852] hover:text-[#26251e] hover:bg-[#f7f7f4]'
    }`}
  >
    {children}
    {badge ? <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#cf2d56] text-white font-mono text-[9.5px] leading-4 text-center">{badge}</span> : null}
  </button>
);

const Divider = () => <span className="mx-1.5 h-5 w-px bg-[#e6e5e0]" aria-hidden />;

const AddComponent: React.FC = () => {
  const [open, setOpen] = useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const add = (c: QuickComponent) => {
    void useDiagramStore.getState().addNode({ label: c.label, type: c.type, awsIcon: c.awsIcon, subType: c.subType });
    setOpen(false);
  };
  const categories = [...new Set(PALETTE.map((c) => c.category))];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-1.5 h-9 pl-3 pr-2.5 rounded-lg bg-[#f54e00] hover:bg-[#d04200] text-white text-[13.5px] font-medium transition-colors">
        <Plus className="w-4 h-4" /> Add component <ChevronDown className="w-3.5 h-3.5 opacity-80" />
      </button>
      {open && (
        <div role="menu" className={`${MENU_PANEL} right-0 top-full mt-2 w-80 max-h-[26rem] overflow-y-auto`}>
          {categories.map((category) => (
            <div key={category} className="pb-1">
              <div className={`px-2.5 pt-2 pb-1 ${MONO_LABEL}`}>{category}</div>
              {PALETTE.filter((c) => c.category === category).map((c) => (
                <button key={c.label} role="menuitem" onClick={() => add(c)} className="w-full flex items-center gap-3 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f7f7f4]">
                  <span className="w-8 h-8 rounded-md bg-[#fafaf7] border border-[#e6e5e0] flex items-center justify-center flex-shrink-0"><AWSIcon name={c.awsIcon} type={c.type} size={20} /></span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-[#26251e] truncate">{c.label}</span>
                    <span className="block text-[11.5px] text-[#807d72] truncate">{c.subType}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** The tab row: the Diagram tab on the left, then tools, history, zoom and the editing actions. */
export const CanvasToolbar: React.FC = () => {
  const tool = useUi((s) => s.tool);
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const busy = useHistoryStore((s) => s.busy);
  const hasDiagram = useDiagramStore((s) => s.doc.diagram !== null);
  const nodeCount = useDiagramStore((s) => s.nodes.length);
  const selected = useDiagramStore((s) => s.selectedNodeIds);
  const layoutDir = useDiagramStore((s) => s.layoutDir);
  const playing = useDiagramStore((s) => s.isPlayingFlow);
  const store = useDiagramStore.getState;

  const group = () => {
    const s = store();
    if (s.selectedNodeIds.length >= 2) return void s.groupNodes(s.selectedNodeIds, 'Backend Services');
    const pool = s.nodes.filter((n) => ['service', 'database', 'cache'].includes(n.data.type)).map((n) => n.id);
    void s.groupNodes(pool.length >= 2 ? pool : s.nodes.slice(0, 3).map((n) => n.id), 'Backend Services');
  };
  const edit = () => {
    const s = store();
    const id = s.selectedNodeIds[0] ?? s.nodes[s.nodes.length - 1]?.id;
    if (id) useUi.getState().set({ editingNodeId: id });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-6 min-h-12 py-1 border-b border-[#e6e5e0] flex-shrink-0 bg-white">
      <div className="flex items-stretch h-10 flex-shrink-0">
        <button className="flex items-center gap-2 px-1 mr-6 h-full text-[14px] font-medium text-[#f54e00] border-b-2 border-[#f54e00] -mb-px" aria-current="page">
          <Shapes className="w-4 h-4" /> Diagram
        </button>
      </div>

      <div className="flex items-center flex-shrink-0">
        <IconButton label="Select (drag to draw a selection box)" active={tool === 'select'} onClick={() => useUi.getState().set({ tool: 'select' })}><MousePointer2 className="w-[18px] h-[18px]" /></IconButton>
        <IconButton label="Pan (or hold Space)" active={tool === 'pan'} onClick={() => useUi.getState().set({ tool: 'pan' })}><Hand className="w-[18px] h-[18px]" /></IconButton>
        <Divider />
        <IconButton label={`Undo (${MOD_KEY} Z)`} disabled={!hasDiagram || !canUndo || busy} onClick={() => void useHistoryStore.getState().undo()}><Undo2 className="w-[18px] h-[18px]" /></IconButton>
        <IconButton label={`Redo (${MOD_KEY} ⇧ Z)`} disabled={!hasDiagram || !canRedo || busy} onClick={() => void useHistoryStore.getState().redo()}><Redo2 className="w-[18px] h-[18px]" /></IconButton>
        <Divider />
        <IconButton label="Zoom out" onClick={() => void flow.zoomOut({ duration: 150 })}><ZoomOut className="w-[18px] h-[18px]" /></IconButton>
        <button onClick={() => void flow.zoomTo(1, { duration: 150 })} title="Reset zoom to 100%" className="w-12 h-9 rounded-lg font-mono text-[12px] text-[#26251e] hover:bg-[#f7f7f4]">{Math.round(zoom * 100)}%</button>
        <IconButton label="Zoom in" onClick={() => void flow.zoomIn({ duration: 150 })}><ZoomIn className="w-[18px] h-[18px]" /></IconButton>
        <IconButton label="Fit the diagram to the screen" onClick={() => void flow.fitView({ padding: 0.25, duration: 300 })}><Maximize className="w-[18px] h-[18px]" /></IconButton>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <IconButton label="Rename or edit a component" disabled={nodeCount === 0} onClick={edit}><Edit3 className="w-[18px] h-[18px]" /></IconButton>
        <IconButton label="Tag the selected components with a group name" disabled={nodeCount < 2} onClick={group}><Layers className="w-[18px] h-[18px]" /></IconButton>
        <IconButton label={playing ? 'Playing…' : 'Play the flow, component by component'} active={playing} disabled={nodeCount === 0 || playing} onClick={() => void store().playFlow()}><Play className="w-[18px] h-[18px]" /></IconButton>
        <IconButton label={`Tidy the layout (now ${layoutDir === 'LR' ? 'left to right' : 'top to bottom'}). Saved as a position update`} disabled={nodeCount === 0} onClick={() => void store().applyLayout()}><LayoutGrid className="w-[18px] h-[18px]" /></IconButton>
        <IconButton label={`Switch to ${layoutDir === 'LR' ? 'top-to-bottom' : 'left-to-right'} layout`} disabled={nodeCount === 0} onClick={() => void store().applyLayout(layoutDir === 'LR' ? 'TB' : 'LR')}>
          {layoutDir === 'LR' ? <ArrowRightLeft className="w-[18px] h-[18px]" /> : <ArrowUpDown className="w-[18px] h-[18px]" />}
        </IconButton>
        <IconButton label="Delete the selected components (Delete)" danger disabled={nodeCount === 0} badge={selected.length || undefined} onClick={() => void store().deleteSelected()}><Trash2 className="w-[18px] h-[18px]" /></IconButton>
        <Divider />
        <AddComponent />
      </div>
    </div>
  );
};
