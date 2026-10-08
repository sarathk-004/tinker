import React, { useState } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { ArrowRightLeft, ArrowUpDown, ChevronDown, Edit3, Expand, Hand, Layers, LayoutGrid, Minimize, Magnet, MousePointer2, Play, Plus, Redo2, Scan, Shapes, Trash2, Type, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { AWSIcon } from '../components/icons/AWSIcons';
import { useDiagramStore } from '../diagram/store';
import { useHistoryStore } from '../history/history';
import { useAddComponent } from './addComponent';
import { toggleFullscreen, useFullscreen } from './fullscreen';
import { MOD_KEY } from './TopBar';
import { MENU_PANEL, MONO_LABEL, useDismiss } from './Popover';
import { groupByCategory, searchComponents } from './palette';
import { groupSelected } from './groupActions';
import { saveSnap, useUi } from './uiStore';

const IconButton: React.FC<{ label: string; onClick: () => void; disabled?: boolean; active?: boolean; danger?: boolean; children: React.ReactNode; badge?: number }> = ({ label, onClick, disabled, active, danger, children, badge }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    aria-pressed={active}
    className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors disabled:opacity-35 disabled:hover:bg-transparent ${
      active ? 'bg-primary-tint text-primary' : danger ? 'text-body hover:text-danger hover:bg-danger/10' : 'text-body hover:text-ink hover:bg-canvas'
    }`}
  >
    {children}
    {badge ? <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white font-mono text-[9.5px] leading-4 text-center">{badge}</span> : null}
  </button>
);

const Divider = () => <span className="mx-1.5 h-5 w-px bg-line" aria-hidden />;
const ICON = 'w-[18px] h-[18px]';

const AddComponent: React.FC = () => {
  const [open, setOpen] = useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const add = useAddComponent();
  const hasDiagram = useDiagramStore((s) => s.doc.diagram !== null);
  const [query, setQuery] = useState('');
  const matches = searchComponents(query);
  const groups = query.trim() ? [{ category: `${matches.length} found`, items: matches }] : groupByCategory(matches);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} disabled={!hasDiagram} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-1.5 h-9 pl-3 pr-2.5 rounded-lg bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-[13.5px] font-medium transition-colors">
        <Plus className="w-4 h-4" /> Add component <ChevronDown className="w-3.5 h-3.5 opacity-80" />
      </button>
      {open && (
        <div role="menu" className={`${MENU_PANEL} right-0 top-full mt-2 w-80 max-h-[26rem] overflow-y-auto`}>
          <div className="sticky top-0 z-10 bg-surface pb-1.5">
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search, e.g. monitoring, queue, security" aria-label="Search components" className="w-full h-8 px-2.5 rounded-lg border border-line bg-soft text-[13px] text-ink placeholder:text-muted outline-none focus:border-ink" />
          </div>
          {groups.length === 0 && <p className="px-2.5 py-4 text-[13px] text-muted">No component matches.</p>}
          {groups.map(({ category, items }) => (
            <div key={category} className="pb-1">
              <div className={`px-2.5 pt-2 pb-1 ${MONO_LABEL}`}>{category}</div>
              {items.map((c) => (
                <button
                  key={c.label}
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setQuery('');
                    void add(c);
                  }}
                  className="w-full flex items-center gap-3 px-2.5 py-1.5 rounded-lg text-left hover:bg-canvas"
                >
                  <span className="w-8 h-8 rounded-md bg-soft border border-line flex items-center justify-center flex-shrink-0"><AWSIcon name={c.awsIcon} type={c.type} size={20} /></span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-ink truncate">{c.label}</span>
                    <span className="block text-[11.5px] text-muted truncate">{c.subType}</span>
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
  const selectedGroup = useUi((s) => s.selectedGroupPath);
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const fullscreen = useFullscreen();
  const snap = useUi((s) => s.snap);
  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const busy = useHistoryStore((s) => s.busy);
  const hasDiagram = useDiagramStore((s) => s.doc.diagram !== null);
  const nodeCount = useDiagramStore((s) => s.nodes.length);
  const selected = useDiagramStore((s) => s.selectedNodeIds);
  const layoutDir = useDiagramStore((s) => s.layoutDir);
  const playing = useDiagramStore((s) => s.isPlayingFlow);
  const store = useDiagramStore.getState;
  const setTool = (t: 'pan' | 'select' | 'text') => useUi.getState().set({ tool: t });

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-6 min-h-12 py-1 border-b border-line flex-shrink-0 bg-surface">
      <div className="flex items-stretch h-10 flex-shrink-0">
        <button className="flex items-center gap-2 px-1 mr-6 h-full text-[14px] font-medium text-primary border-b-2 border-primary -mb-px" aria-current="page">
          <Shapes className="w-4 h-4" /> Diagram
        </button>
      </div>

      <div className="flex items-center flex-shrink-0">
        <IconButton label="Pan tool (H). Drag the canvas to move around" active={tool === 'pan'} onClick={() => setTool('pan')}><Hand className={ICON} /></IconButton>
        <IconButton label="Select tool (V). Drag a box around components" active={tool === 'select'} onClick={() => setTool('select')}><MousePointer2 className={ICON} /></IconButton>
        <IconButton label="Text tool (T). Click the canvas to add a note" active={tool === 'text'} disabled={!hasDiagram} onClick={() => setTool('text')}><Type className={ICON} /></IconButton>
        <Divider />
        <IconButton label={`Undo (${MOD_KEY} Z)`} disabled={!hasDiagram || !canUndo || busy} onClick={() => void useHistoryStore.getState().undo()}><Undo2 className={ICON} /></IconButton>
        <IconButton label={`Redo (${MOD_KEY} ⇧ Z)`} disabled={!hasDiagram || !canRedo || busy} onClick={() => void useHistoryStore.getState().redo()}><Redo2 className={ICON} /></IconButton>
        <Divider />
        <IconButton label="Zoom out" onClick={() => void flow.zoomOut({ duration: 150 })}><ZoomOut className={ICON} /></IconButton>
        <button onClick={() => void flow.zoomTo(1, { duration: 150 })} title="Reset zoom to 100%" className="w-12 h-9 rounded-lg font-mono text-[12px] text-ink hover:bg-canvas">{Math.round(zoom * 100)}%</button>
        <IconButton label="Zoom in" onClick={() => void flow.zoomIn({ duration: 150 })}><ZoomIn className={ICON} /></IconButton>
        <IconButton label="Resize the view to fit the whole diagram (K)" onClick={() => void flow.fitView({ padding: 0.25, duration: 300, maxZoom: 1 })}><Scan className={ICON} /></IconButton>
        <IconButton label={snap ? 'Snapping is on: components line up as you drag (hold Alt to skip)' : 'Snapping is off'} active={snap} onClick={() => { saveSnap(!snap); useUi.getState().set({ snap: !snap }); }}><Magnet className={ICON} /></IconButton>
        <IconButton label={fullscreen ? 'Leave full screen (F)' : 'Full screen (F)'} active={fullscreen} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize className={ICON} /> : <Expand className={ICON} />}</IconButton>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <IconButton
          label="Rename or edit the selected component or group (R). Select one first"
          disabled={selected.length !== 1 && !(selected.length === 0 && selectedGroup)}
          onClick={() => useUi.getState().set(selected.length === 1 ? { editingNodeId: selected[0]! } : { editingGroupPath: selectedGroup })}
        ><Edit3 className={ICON} /></IconButton>
        <IconButton label="Group the selected components (G). Select two or more first" disabled={selected.length < 2} onClick={() => void groupSelected()}><Layers className={ICON} /></IconButton>
        <IconButton label={playing ? 'Playing…' : 'Play the flow, component by component'} active={playing} disabled={nodeCount === 0 || playing} onClick={() => void store().playFlow()}><Play className={ICON} /></IconButton>
        <IconButton label={`Tidy the layout (L). Now ${layoutDir === 'LR' ? 'left to right' : 'top to bottom'}; saved as a position update`} disabled={nodeCount === 0} onClick={() => void store().applyLayout()}><LayoutGrid className={ICON} /></IconButton>
        <IconButton label={`Switch to ${layoutDir === 'LR' ? 'top-to-bottom' : 'left-to-right'} layout`} disabled={nodeCount === 0} onClick={() => void store().applyLayout(layoutDir === 'LR' ? 'TB' : 'LR')}>
          {layoutDir === 'LR' ? <ArrowRightLeft className={ICON} /> : <ArrowUpDown className={ICON} />}
        </IconButton>
        <IconButton label="Delete the selected components (Delete)" danger disabled={selected.length === 0} badge={selected.length || undefined} onClick={() => void store().deleteSelected()}><Trash2 className={ICON} /></IconButton>
        <Divider />
        <AddComponent />
      </div>
    </div>
  );
};
