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
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 p-1 rounded-md bg-white border border-[#e6e5e0] select-none">
      {/* Component Palette Dropdown - Cursor Orange Primary CTA */}
      <div className="relative">
        <button
          onClick={() => setShowPalette(!showPalette)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#f54e00] hover:bg-[#d04200] text-white text-xs font-medium transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Node</span>
          <ChevronDown className="w-3 h-3 ml-0.5 opacity-80" />
        </button>

        {showPalette && (
          <div className="absolute top-full left-0 mt-2 w-56 p-1.5 rounded-md bg-white border border-[#e6e5e0] z-50 flex flex-col gap-0.5 animate-fade-in shadow-sm">
            <div className="px-2.5 py-1 text-[11px] font-mono font-medium text-[#807d72] uppercase tracking-wider">
              AWS Components
            </div>
            {PALETTE.map((comp) => (
              <button
                key={comp.label}
                onClick={() => handleAdd(comp)}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[#26251e] hover:bg-[#fafaf7] transition-colors text-left"
              >
                <AWSIcon name={comp.awsIcon} type={comp.type} size={18} />
                <span className="truncate">{comp.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-4 w-px bg-[#e6e5e0] mx-0.5" />

      {/* Undo Button */}
      <button
        onClick={() => store.undo()}
        title="Undo previous change (Ctrl+Z)"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[#5a5852] hover:text-[#26251e] hover:bg-[#fafaf7] text-xs font-medium transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5 text-[#807d72]" />
        <span className="hidden sm:inline">Undo</span>
      </button>

      {/* Auto-Layout LR */}
      <button
        onClick={() => store.applyLayout('LR')}
        title="Auto-organize layout (Left-to-Right)"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[#5a5852] hover:text-[#26251e] hover:bg-[#fafaf7] text-xs font-medium transition-colors"
      >
        <LayoutGrid className="w-3.5 h-3.5 text-[#807d72]" />
        <span className="hidden sm:inline">Re-layout</span>
      </button>

      {/* Grouping */}
      <button
        onClick={() => {
          const selectedNodes = store.nodes.filter((n) => n.selected);
          if (selectedNodes.length >= 2) {
            store.groupNodes(
              selectedNodes.map((n) => n.id),
              'Backend Microservices'
            );
          } else {
            store.groupNodes(
              store.nodes.slice(0, 3).map((n) => n.id),
              'Core Services'
            );
          }
        }}
        title="Group selected nodes"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[#5a5852] hover:text-[#26251e] hover:bg-[#fafaf7] text-xs font-medium transition-colors"
      >
        <Layers className="w-3.5 h-3.5 text-[#807d72]" />
        <span className="hidden sm:inline">Group</span>
      </button>

      {/* Highlight Flow */}
      <button
        onClick={() => {
          if (store.highlightedIds.length > 0) {
            store.clearHighlight();
          } else {
            const firstTwo = store.nodes.slice(0, 2).map((n) => n.id);
            if (firstTwo.length > 0) store.highlight(firstTwo);
          }
        }}
        title="Toggle flow highlight"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[#5a5852] hover:text-[#26251e] hover:bg-[#fafaf7] text-xs font-medium transition-colors"
      >
        <Sparkles className="w-3.5 h-3.5 text-[#807d72]" />
        <span className="hidden sm:inline">Flow</span>
      </button>

      <div className="h-4 w-px bg-[#e6e5e0] mx-0.5" />

      {/* Delete selected */}
      <button
        onClick={() => {
          const selectedNodes = store.nodes.filter((n) => n.selected);
          selectedNodes.forEach((n) => store.removeNode(n.id));
        }}
        title="Delete selected nodes (Del / Backspace)"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[#5a5852] hover:text-[#cf2d56] hover:bg-[#fafaf7] text-xs font-medium transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
