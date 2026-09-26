import React from 'react';
import { useDiagramStore } from '../diagram/store';
import { RotateCcw, ArrowRightLeft, ArrowUpDown, Cpu, Settings } from 'lucide-react';

interface HeaderProps {
  layoutDir: 'LR' | 'TB';
  onToggleLayout: () => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({ layoutDir, onToggleLayout, onOpenSettings }) => {
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const reset = useDiagramStore((s) => s.reset);

  return (
    <header className="h-14 px-6 border-b border-[#e6e5e0] bg-[#f7f7f4] flex items-center justify-between z-20 select-none">
      {/* Brand & Wordmark - Cursor Style */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-[#f54e00] flex items-center justify-center text-white font-medium">
            <Cpu className="w-4 h-4" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-normal tracking-[-0.3px] text-[#26251e] font-sans">
              tinker
            </span>
            <span className="text-[11px] font-mono font-medium uppercase tracking-[0.5px] px-2 py-0.5 rounded-full bg-[#e6e5e0] text-[#26251e]">
              Gemini 3.8 Flash
            </span>
          </div>
        </div>
      </div>

      {/* Right controls - Cursor 8px rounded cards with hairline depth */}
      <div className="flex items-center gap-2">
        {/* Node & Edge counts */}
        <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-[#5a5852] bg-white px-3 py-1.5 rounded-md border border-[#e6e5e0]">
          <span className="text-[#26251e] font-medium">{nodes.length}</span> nodes
          <span className="text-[#a09c92]">·</span>
          <span className="text-[#26251e] font-medium">{edges.length}</span> edges
        </div>

        {/* Layout toggle */}
        <button
          onClick={onToggleLayout}
          title={`Switch layout to ${layoutDir === 'LR' ? 'Top-to-Bottom' : 'Left-to-Right'}`}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#26251e] bg-white hover:bg-[#fafaf7] border border-[#e6e5e0] hover:border-[#cfcdc4] rounded-md transition-all"
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

        {/* Voice & API Settings */}
        <button
          onClick={onOpenSettings}
          title="Configure Gemini Audio Models & API Key"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#26251e] bg-white hover:bg-[#fafaf7] border border-[#e6e5e0] hover:border-[#cfcdc4] rounded-md transition-all"
        >
          <Settings className="w-3.5 h-3.5 text-[#f54e00]" />
          <span>Models</span>
        </button>

        {/* Reset Canvas */}
        <button
          onClick={reset}
          title="Reset canvas"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#5a5852] hover:text-[#cf2d56] bg-white hover:bg-[#fafaf7] border border-[#e6e5e0] hover:border-[#cfcdc4] rounded-md transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Reset</span>
        </button>
      </div>
    </header>
  );
};
