import React from 'react';
import { useDiagramStore } from '../diagram/store';
import { RotateCcw, ArrowRightLeft, ArrowUpDown, Undo2, Redo2, KeyRound } from 'lucide-react';
import { useAiKeyStore } from '../ai/aiKey';
import { useWorkspaceStore } from '../workspace/workspaceStore';
import { useHistoryStore } from '../history/history';
import { TinkerLogo } from './TinkerLogo';
import { DiagramBar } from './DiagramBar';

export const Header: React.FC = () => {
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const layoutDir = useDiagramStore((s) => s.layoutDir);
  const hasDiagram = useDiagramStore((s) => s.doc.diagram !== null);
  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const busy = useHistoryStore((s) => s.busy);
  const keyMode = useWorkspaceStore((s) => s.features.aiKey.mode);
  const keySource = useWorkspaceStore((s) => s.features.aiKey.source);

  const toggleLayout = () => void useDiagramStore.getState().applyLayout(layoutDir === 'LR' ? 'TB' : 'LR');
  const resetCanvas = () => {
    if (window.confirm('Clear every node and connection in this diagram? You can restore earlier versions later.')) {
      void useDiagramStore.getState().reset();
    }
  };

  return (
    <header className="h-14 px-6 border-b border-[#e6e5e0] bg-[#f7f7f4] flex items-center justify-between z-20 select-none">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <TinkerLogo size={28} />
          <span className="text-base font-semibold tracking-[-0.3px] text-[#26251e] font-sans">tinker</span>
        </div>
        <DiagramBar />
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-[#5a5852] bg-white px-3 py-1.5 rounded-md border border-[#e6e5e0]">
          <span className="text-[#26251e] font-medium">{nodes.length}</span> nodes
          <span className="text-[#a09c92]">·</span>
          <span className="text-[#26251e] font-medium">{edges.length}</span> edges
        </div>

        {keyMode !== 'server' && (
          <button
            onClick={() => useAiKeyStore.getState().show()}
            title={keySource === 'USER' ? 'Your own Gemini key is in use. Click to change or remove it.' : 'Add your own Gemini key to turn on free-form AI, voice and spoken replies.'}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-all ${
              keySource === 'NONE' ? 'text-[#f54e00] bg-[#f54e00]/5 border-[#f54e00]/40 hover:bg-[#f54e00]/10' : 'text-[#26251e] bg-white border-[#e6e5e0] hover:border-[#cfcdc4] hover:bg-[#fafaf7]'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{keySource === 'NONE' ? 'Add AI key' : 'AI key'}</span>
          </button>
        )}

        <div className="flex items-center rounded-md border border-[#e6e5e0] bg-white overflow-hidden">
          <button
            onClick={() => void useHistoryStore.getState().undo()}
            disabled={!hasDiagram || !canUndo || busy}
            title="Undo (Ctrl+Z): go back to the previous saved version. It is saved as a new version, so nothing is lost."
            aria-label="Undo"
            className="p-1.5 text-[#26251e] hover:bg-[#fafaf7] disabled:opacity-35 disabled:hover:bg-white"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => void useHistoryStore.getState().redo()}
            disabled={!hasDiagram || !canRedo || busy}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            className="p-1.5 text-[#26251e] hover:bg-[#fafaf7] border-l border-[#e6e5e0] disabled:opacity-35 disabled:hover:bg-white"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          onClick={toggleLayout}
          disabled={!hasDiagram}
          title={`Re-arrange everything ${layoutDir === 'LR' ? 'Top-to-Bottom' : 'Left-to-Right'} (saved as a position update)`}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#26251e] bg-white hover:bg-[#fafaf7] border border-[#e6e5e0] hover:border-[#cfcdc4] rounded-md transition-all disabled:opacity-40"
        >
          {layoutDir === 'LR' ? (
            <>
              <ArrowRightLeft className="w-3.5 h-3.5 text-[#5a5852]" />
              <span>LR Layout</span>
            </>
          ) : (
            <>
              <ArrowUpDown className="w-3.5 h-3.5 text-[#5a5852]" />
              <span>TB Layout</span>
            </>
          )}
        </button>

        <button
          onClick={resetCanvas}
          disabled={!hasDiagram}
          title="Clear the diagram"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#5a5852] hover:text-[#cf2d56] bg-white hover:bg-[#fafaf7] border border-[#e6e5e0] hover:border-[#cfcdc4] rounded-md transition-all disabled:opacity-40"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Reset</span>
        </button>
      </div>
    </header>
  );
};
