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
  const activeAction = useDiagramStore((s) => s.activeAction);
  const reset = useDiagramStore((s) => s.reset);

  return (
    <header className="h-16 px-6 border-b border-slate-800/80 bg-[#090b10]/90 backdrop-blur-xl flex items-center justify-between z-20 select-none">
      {/* Brand & Tagline */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/20 text-slate-950 font-black">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-extrabold tracking-tight text-white">tinker</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                AWS Architecture
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Speak your system into existence</p>
          </div>
        </div>
      </div>

      {/* Center status badge if action occurred */}
      {activeAction && (
        <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs text-slate-300 animate-fade-in shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
          <span className="font-mono text-slate-400 truncate max-w-xs">{activeAction}</span>
        </div>
      )}

      {/* Right controls */}
      <div className="flex items-center gap-3">
        {/* Node & Edge counts */}
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400 bg-[#121620] px-3 py-1.5 rounded-lg border border-slate-800">
          <span>{nodes.length} nodes</span>
          <span className="text-slate-600">·</span>
          <span>{edges.length} edges</span>
        </div>

        {/* Layout toggle */}
        <button
          onClick={onToggleLayout}
          title={`Switch layout to ${layoutDir === 'LR' ? 'Top-to-Bottom' : 'Left-to-Right'}`}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-[#121620] hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors"
        >
          {layoutDir === 'LR' ? (
            <>
              <ArrowRightLeft className="w-3.5 h-3.5 text-amber-400" />
              <span>LR</span>
            </>
          ) : (
            <>
              <ArrowUpDown className="w-3.5 h-3.5 text-amber-400" />
              <span>TB</span>
            </>
          )}
        </button>

        {/* API Settings Modal */}
        <button
          onClick={onOpenSettings}
          title="Configure Gemini API Key"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-[#121620] hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors"
        >
          <Settings className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Settings</span>
        </button>

        {/* Reset Canvas */}
        <button
          onClick={reset}
          title="Reset canvas"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-lg transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>
      </div>
    </header>
  );
};
