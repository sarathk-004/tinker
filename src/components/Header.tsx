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
    <header className="h-16 px-6 border-b border-[#1c2d38] bg-[#001e2b]/95 backdrop-blur-xl flex items-center justify-between z-20 select-none">
      {/* Brand & Tagline - MongoDB Theme */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#00ed64] flex items-center justify-center shadow-lg shadow-[#00ed64]/20 text-[#001e2b] font-black">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-extrabold tracking-tight text-white font-sans">tinker</span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[#00ed64]/10 text-[#00ed64] border border-[#00ed64]/25 font-mono">
                Gemini 3.8 Flash
              </span>
            </div>
            <p className="text-[11px] text-[#a8b3bc] font-medium">AWS Architecture Studio</p>
          </div>
        </div>
      </div>

      {/* Right controls - MongoDB Pill Button Style */}
      <div className="flex items-center gap-2.5">
        {/* Node & Edge counts */}
        <div className="flex items-center gap-2 text-xs font-mono text-[#a8b3bc] bg-[#002636] px-3.5 py-1.5 rounded-full border border-[#1c2d38]">
          <span className="text-white font-semibold">{nodes.length}</span> nodes
          <span className="text-[#5c6c7a]">·</span>
          <span className="text-white font-semibold">{edges.length}</span> edges
        </div>

        {/* Layout toggle pill */}
        <button
          onClick={onToggleLayout}
          title={`Switch layout to ${layoutDir === 'LR' ? 'Top-to-Bottom' : 'Left-to-Right'}`}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#002636] hover:bg-[#003d4f] border border-[#1c2d38] hover:border-[#00ed64]/40 rounded-full transition-all"
        >
          {layoutDir === 'LR' ? (
            <>
              <ArrowRightLeft className="w-3.5 h-3.5 text-[#00ed64]" />
              <span>LR Layout</span>
            </>
          ) : (
            <>
              <ArrowUpDown className="w-3.5 h-3.5 text-[#00ed64]" />
              <span>TB Layout</span>
            </>
          )}
        </button>

        {/* API Settings Modal button */}
        <button
          onClick={onOpenSettings}
          title="Configure Gemini API Key & Nuanced Voice"
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#002636] hover:bg-[#003d4f] border border-[#1c2d38] hover:border-[#00ed64]/40 rounded-full transition-all"
        >
          <Settings className="w-3.5 h-3.5 text-[#00ed64]" />
          <span className="hidden sm:inline">Settings</span>
        </button>

        {/* Reset Canvas pill */}
        <button
          onClick={reset}
          title="Reset canvas"
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-rose-400 bg-[#002636] hover:bg-rose-950/40 border border-[#1c2d38] hover:border-rose-800/50 rounded-full transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Reset</span>
        </button>
      </div>
    </header>
  );
};
