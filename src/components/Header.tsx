import React from 'react';
import { useDiagramStore } from '../diagram/store';
import { RotateCcw, ArrowRightLeft, ArrowUpDown } from 'lucide-react';
import { TinkerLogo } from './TinkerLogo';
import { DiagramBar } from './DiagramBar';

export const Header: React.FC = () => {
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const layoutDir = useDiagramStore((s) => s.layoutDir);
  const hasDiagram = useDiagramStore((s) => s.doc.diagram !== null);

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
