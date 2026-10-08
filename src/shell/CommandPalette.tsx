import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Box, CornerDownLeft, Download, FileText, History, LayoutGrid, Plus, Redo2, Search, Undo2, Users } from 'lucide-react';
import { useDiagramStore } from '../diagram/store';
import { useHistoryStore } from '../history/history';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { timeAgo } from '../components/VersionsPanel';
import { exportCurrent } from './exportCurrent';
import { MOD_KEY } from './TopBar';
import { rankItems, type PaletteGroup, type PaletteItem } from './search';
import { useUi } from './uiStore';

const GROUP_ICON: Record<PaletteGroup, React.ReactNode> = {
  Diagrams: <FileText className="w-4 h-4" />,
  Components: <Box className="w-4 h-4" />,
  Workspaces: <Users className="w-4 h-4" />,
  Actions: <Download className="w-4 h-4" />,
};

/** Cmd/Ctrl+K: jump to a diagram, a component, a workspace, or run an action. */
export const CommandPalette: React.FC = () => {
  const open = useUi((s) => s.paletteOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  const diagrams = useWorkspaceStore((s) => s.diagrams);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const nodes = useDiagramStore((s) => s.nodes);
  const currentId = useDiagramStore((s) => s.doc.diagram?.id);

  const close = React.useCallback(() => useUi.getState().set({ paletteOpen: false }), []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];
    for (const d of diagrams) {
      list.push({
        id: `d:${d.id}`,
        group: 'Diagrams',
        title: d.name,
        subtitle: d.id === currentId ? 'Open now' : `Updated ${timeAgo(d.updatedAt)}`,
        run: () => void useWorkspaceStore.getState().openDiagram(d.id),
      });
    }
    for (const n of nodes) {
      list.push({
        id: `n:${n.id}`,
        group: 'Components',
        title: n.data.label,
        subtitle: n.data.subType ?? n.data.type,
        keywords: `${n.data.type} ${n.data.group ?? ''} ${n.data.description ?? ''}`,
        run: () => {
          useDiagramStore.getState().setSelectedNodeIds([n.id]);
          useDiagramStore.getState().highlight([n.id]);
          void flow.fitView({ nodes: [{ id: n.id }], duration: 350, maxZoom: 1.1, padding: 0.6 });
          setTimeout(() => useDiagramStore.getState().clearHighlight(), 1600);
        },
      });
    }
    for (const w of workspaces) {
      if (w.id === workspace?.id) continue;
      list.push({ id: `w:${w.id}`, group: 'Workspaces', title: w.name, subtitle: w.personal ? 'Personal workspace' : 'Switch workspace', run: () => void useWorkspaceStore.getState().switchWorkspace(w.id) });
    }
    const hasDiagram = !!currentId;
    const actions: Array<[string, string, string, React.ReactNode, () => void, boolean]> = [
      ['new', 'New diagram', 'Start an empty diagram in this workspace', <Plus key="a" className="w-4 h-4" />, () => void useWorkspaceStore.getState().createDiagram(), true],
      ['undo', 'Undo', `${MOD_KEY} Z`, <Undo2 key="b" className="w-4 h-4" />, () => void useHistoryStore.getState().undo(), hasDiagram],
      ['redo', 'Redo', `${MOD_KEY} ⇧ Z`, <Redo2 key="c" className="w-4 h-4" />, () => void useHistoryStore.getState().redo(), hasDiagram],
      ['layout', 'Tidy the layout', 'Re-arrange every component (saved as a position update)', <LayoutGrid key="d" className="w-4 h-4" />, () => void useDiagramStore.getState().applyLayout(), hasDiagram && nodes.length > 0],
      ['versions', 'Version history', 'See and restore earlier versions', <History key="e" className="w-4 h-4" />, () => useUi.getState().set({ versionsOpen: true, navOpen: true }), hasDiagram],
      ['png', 'Export as PNG image', undefined as unknown as string, <Download key="f" className="w-4 h-4" />, () => void exportCurrent('png', flow), hasDiagram],
      ['svg', 'Export as SVG', undefined as unknown as string, <Download key="g" className="w-4 h-4" />, () => void exportCurrent('svg', flow), hasDiagram],
      ['json', 'Export as JSON', undefined as unknown as string, <Download key="h" className="w-4 h-4" />, () => void exportCurrent('json', flow), hasDiagram],
      ['md', 'Export as Markdown summary', undefined as unknown as string, <Download key="i" className="w-4 h-4" />, () => void exportCurrent('md', flow), hasDiagram],
    ];
    for (const [id, title, subtitle, , run, enabled] of actions) {
      if (enabled) list.push({ id: `a:${id}`, group: 'Actions', title, ...(subtitle ? { subtitle } : {}), keywords: 'export download', run });
    }
    return list;
  }, [diagrams, nodes, workspaces, workspace?.id, currentId, flow]);

  const results = useMemo(() => rankItems(items, query), [items, query]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    close();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  let lastGroup: PaletteGroup | null = null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[14vh] px-4 bg-[#26251e]/25 backdrop-blur-[1px]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="Search" aria-modal="true" onKeyDown={onKeyDown} className="w-full max-w-xl rounded-2xl border border-[#e6e5e0] bg-white shadow-[0_24px_70px_rgba(38,37,30,0.22)] overflow-hidden animate-fade-in">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-[#efeee8]">
          <Search className="w-[18px] h-[18px] text-[#807d72]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search diagrams, components, actions…"
            aria-label="Search"
            role="combobox"
            aria-expanded
            aria-controls="palette-results"
            className="flex-1 bg-transparent text-[15px] text-[#26251e] placeholder-[#a09c92] outline-none"
          />
          <kbd className="font-mono text-[10.5px] text-[#807d72] px-1.5 py-0.5 rounded-md border border-[#e6e5e0] bg-[#fafaf7]">Esc</kbd>
        </div>
        <div ref={listRef} id="palette-results" role="listbox" className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13.5px] text-[#807d72]">Nothing matches “{query}”.</div>
          ) : (
            results.map((item, index) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <React.Fragment key={item.id}>
                  {header && <div className="px-3 pt-2.5 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#807d72]">{header}</div>}
                  <button
                    role="option"
                    aria-selected={index === active}
                    data-index={index}
                    onMouseMove={() => setActive(index)}
                    onClick={() => choose(item)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left ${index === active ? 'bg-[#f7f7f4]' : ''}`}
                  >
                    <span className={`flex-shrink-0 ${index === active ? 'text-[#f54e00]' : 'text-[#807d72]'}`}>{GROUP_ICON[item.group]}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] text-[#26251e] truncate">{item.title}</span>
                      {item.subtitle && <span className="block text-[12px] text-[#807d72] truncate">{item.subtitle}</span>}
                    </span>
                    {index === active && <CornerDownLeft className="w-3.5 h-3.5 text-[#a09c92]" />}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-4 px-4 h-9 border-t border-[#efeee8] bg-[#fafaf7] font-mono text-[10.5px] text-[#807d72]">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
};
