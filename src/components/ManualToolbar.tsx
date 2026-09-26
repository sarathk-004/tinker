import React, { useState } from 'react';
import { useDiagramStore } from '../diagram/store';
import {
  Plus,
  RotateCcw,
  Sparkles,
  LayoutGrid,
  Trash2,
  ChevronDown,
  Layers,
} from 'lucide-react';
import { AWSIcon } from './icons/AWSIcons';
import { AWSServiceIcon, SystemNodeType } from '../types/diagram';

interface QuickComponent {
  label: string;
  type: SystemNodeType;
  awsIcon: AWSServiceIcon;
  subType?: string;
}

const PALETTE: QuickComponent[] = [
  { label: 'API Gateway', type: 'gateway', awsIcon: 'api-gateway', subType: 'Amazon API Gateway' },
  { label: 'Microservice', type: 'service', awsIcon: 'ec2', subType: 'Amazon EC2' },
  { label: 'Lambda Function', type: 'service', awsIcon: 'lambda', subType: 'AWS Lambda' },
  { label: 'PostgreSQL DB', type: 'database', awsIcon: 'rds', subType: 'Amazon RDS' },
  { label: 'Redis Cache', type: 'cache', awsIcon: 'redis', subType: 'ElastiCache' },
  { label: 'SQS Queue', type: 'queue', awsIcon: 'sqs', subType: 'Amazon SQS' },
  { label: 'S3 Storage', type: 'storage', awsIcon: 's3', subType: 'Amazon S3' },
  { label: 'Web Client', type: 'client', awsIcon: 'client' },
];

export const ManualToolbar: React.FC = () => {
  const store = useDiagramStore();
  const [showPalette, setShowPalette] = useState(false);

  const handleAdd = (comp: QuickComponent) => {
    store.addNode({
      label: comp.label,
      type: comp.type,
      awsIcon: comp.awsIcon,
      subType: comp.subType,
    });
    setShowPalette(false);
  };

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 p-1 rounded-2xl bg-[#11141c]/90 border border-slate-800/90 shadow-2xl backdrop-blur-xl select-none">
      {/* Component Palette Dropdown */}
      <div className="relative">
        <button
          onClick={() => setShowPalette(!showPalette)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Node</span>
          <ChevronDown className="w-3 h-3 ml-0.5 opacity-70" />
        </button>

        {showPalette && (
          <div className="absolute top-full left-0 mt-2 w-56 p-1.5 rounded-xl bg-[#121620] border border-slate-800 shadow-2xl backdrop-blur-2xl z-50 flex flex-col gap-1 animate-fade-in">
            <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              AWS Components
            </div>
            {PALETTE.map((comp) => (
              <button
                key={comp.label}
                onClick={() => handleAdd(comp)}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors text-left"
              >
                <AWSIcon name={comp.awsIcon} type={comp.type} size={18} />
                <span className="truncate">{comp.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-4 w-px bg-slate-800 mx-0.5" />

      {/* Undo Button */}
      <button
        onClick={() => store.undo()}
        title="Undo previous change (Ctrl+Z)"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/70 text-xs font-medium transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
        <span className="hidden sm:inline">Undo</span>
      </button>

      {/* Auto-Layout LR */}
      <button
        onClick={() => store.applyLayout('LR')}
        title="Auto-organize layout (Left-to-Right)"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/70 text-xs font-medium transition-colors"
      >
        <LayoutGrid className="w-3.5 h-3.5 text-slate-400" />
        <span className="hidden sm:inline">Re-layout</span>
      </button>

      {/* Clear Highlights */}
      {store.highlightedIds.length > 0 && (
        <button
          onClick={() => store.clearHighlight()}
          title="Clear highlights"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-amber-300 hover:bg-amber-500/10 text-xs font-medium transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Unhighlight</span>
        </button>
      )}

      {/* Canvas Node Count Badge */}
      <div className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono text-slate-400 bg-slate-900/60 rounded-xl border border-slate-800/60">
        <Layers className="w-3 h-3 text-slate-500" />
        <span>{store.nodes.length} nodes</span>
      </div>

      {/* Reset / Clear */}
      {store.nodes.length > 0 && (
        <button
          onClick={() => store.reset()}
          title="Clear Canvas"
          className="p-1.5 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors ml-0.5"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
