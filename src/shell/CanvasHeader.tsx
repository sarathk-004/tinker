import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Cloud, CloudOff, Download, FileJson, FileText, Image as ImageIcon, Loader2, Shapes } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { useDiagramStore } from '../diagram/store';
import { session } from '../document/instance';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { exportCurrent } from './exportCurrent';
import type { ExportFormat } from './exportDiagram';
import { MENU_ITEM, MENU_PANEL, useDismiss } from './Popover';
import { useUi } from './uiStore';

/** Saved / Saving / Not saved / Changed elsewhere: the one place the user learns whether their work is safe. */
export const SaveStatus: React.FC = () => {
  const { status, pending } = useDiagramStore((s) => s.doc);
  const base = 'flex items-center gap-1.5 text-[13px] whitespace-nowrap';
  if (status === 'conflict') return <span className={`${base} text-danger font-medium`}><AlertTriangle className="w-4 h-4" />Changed elsewhere</span>;
  if (status === 'blocked') return <span className={`${base} text-danger font-medium`}><CloudOff className="w-4 h-4" />Unavailable</span>;
  if (status === 'failed') {
    return (
      <button onClick={() => session.retry()} title="Retry saving now" className={`${base} text-[#8a5a12] font-medium hover:underline`}>
        <CloudOff className="w-4 h-4" />Not saved · Retry
      </button>
    );
  }
  if (status === 'saving' || pending > 0) return <span className={`${base} text-body`}><Loader2 className="w-4 h-4 animate-spin" />Saving{pending > 1 ? ` (${pending})` : '…'}</span>;
  return <span className={`${base} text-body`}><Cloud className="w-4 h-4 text-success" /><span>All saved</span></span>;
};

const FORMATS: Array<[ExportFormat, string, string, React.ReactNode]> = [
  ['png', 'PNG image', 'For slides and chat', <ImageIcon key="p" className="w-4 h-4" />],
  ['svg', 'SVG', 'Sharp at any size', <Shapes key="s" className="w-4 h-4" />],
  ['md', 'Markdown summary', 'Components and connections as text', <FileText key="m" className="w-4 h-4" />],
  ['json', 'JSON', 'The saved diagram, as data', <FileJson key="j" className="w-4 h-4" />],
];

const ExportMenu: React.FC = () => {
  const flow = useReactFlow();
  const hasDiagram = useDiagramStore((s) => s.doc.diagram !== null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = React.useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);

  const run = async (format: ExportFormat) => {
    setBusy(format);
    setError(null);
    const problem = await exportCurrent(format, flow);
    setBusy(null);
    if (problem) setError(problem);
    else setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={!hasDiagram}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 h-9 px-3.5 rounded-lg border border-line bg-surface hover:border-line-strong hover:bg-soft text-[13.5px] font-medium text-ink disabled:opacity-40"
      >
        <Download className="w-4 h-4 text-body" /> Export
      </button>
      {open && (
        <div role="menu" className={`${MENU_PANEL} right-0 top-full mt-2 w-72`}>
          {FORMATS.map(([format, title, hint, icon]) => (
            <button key={format} role="menuitem" onClick={() => void run(format)} disabled={busy !== null} className={MENU_ITEM}>
              <span className="text-body">{busy === format ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}</span>
              <span className="flex-1">
                <span className="block font-medium">{title}</span>
                <span className="block text-[12px] text-muted">{hint}</span>
              </span>
            </button>
          ))}
          {error && <p className="px-2.5 py-1.5 text-[12px] text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
};

/** Breadcrumb, the diagram's name (click to rename), its version, whether it is saved, and Export. */
export const CanvasHeader: React.FC = () => {
  const diagram = useDiagramStore((s) => s.doc.diagram);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const versionsOpen = useUi((s) => s.versionsOpen);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    setEditing(false);
    if (draft.trim()) void useWorkspaceStore.getState().renameDiagram(draft);
  };

  return (
    <div className="flex items-end justify-between gap-4 px-6 pt-4 pb-3 flex-shrink-0 bg-surface">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[12.5px] text-muted mb-0.5">
          <span className="truncate max-w-[200px]">{workspace?.name ?? 'Workspace'}</span>
          <ChevronRight className="w-3 h-3 flex-shrink-0" />
          <span className="truncate max-w-[260px]">{diagram?.name ?? 'No diagram'}</span>
        </div>
        <div className="flex items-center gap-3 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={draft}
              maxLength={160}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditing(false);
              }}
              aria-label="Diagram name"
              className="min-w-0 w-[min(480px,60vw)] text-[24px] font-semibold tracking-[-0.025em] text-ink bg-surface border border-ink rounded-lg px-2 -ml-2 outline-none"
            />
          ) : (
            <button
              onClick={() => {
                setDraft(diagram?.name ?? '');
                setEditing(true);
              }}
              disabled={!diagram}
              title="Rename diagram"
              className="min-w-0 text-left text-[24px] font-semibold tracking-[-0.025em] text-ink truncate rounded-lg px-2 -ml-2 hover:bg-canvas"
            >
              {diagram?.name ?? 'No diagram'}
            </button>
          )}
          {diagram && (
            <button
              onClick={() => useUi.getState().set({ versionsOpen: !versionsOpen, navOpen: true })}
              title="Version history"
              aria-label={`Version ${diagram.version}. Open version history`}
              className="flex items-center gap-1 h-6 px-2 rounded-md bg-fill hover:bg-line font-mono text-[11.5px] text-body flex-shrink-0"
            >
              v{diagram.version} <ChevronDown className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 flex-shrink-0 pb-0.5">
        <SaveStatus />
        <ExportMenu />
      </div>
    </div>
  );
};

