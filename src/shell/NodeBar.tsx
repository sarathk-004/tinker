import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { AWSIcon } from '../components/icons/AWSIcons';
import { useDiagramStore } from '../diagram/store';
import { MONO_LABEL } from './Popover';
import { useUi } from './uiStore';

/** The bottom bar over the canvas: what is selected, with a way into its properties. Appears only when exactly one component is selected. */
export const NodeBar: React.FC = () => {
  const selectedIds = useDiagramStore((s) => s.selectedNodeIds);
  const node = useDiagramStore((s) => (s.selectedNodeIds.length === 1 ? s.nodes.find((n) => n.id === s.selectedNodeIds[0]) : undefined));
  if (selectedIds.length !== 1 || !node) return null;
  const { label, type, awsIcon, subType, group, description } = node.data;
  return (
    <div className="absolute left-5 bottom-5 z-20 max-w-[min(560px,calc(100%-2.5rem))] flex items-center gap-4 pl-3 pr-4 h-14 rounded-xl border border-[#e6e5e0] bg-white shadow-[0_4px_18px_rgba(38,37,30,0.06)] animate-fade-in">
      <span className="w-9 h-9 rounded-lg bg-[#fafaf7] border border-[#e6e5e0] flex items-center justify-center flex-shrink-0"><AWSIcon name={awsIcon} type={type} size={22} /></span>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-[#26251e] truncate leading-tight">{label}</div>
        <div className={`${MONO_LABEL} truncate mt-0.5`}>{[subType ?? type, group].filter(Boolean).join(' · ')}</div>
      </div>
      {description && <div className="hidden md:block min-w-0 flex-1 pl-4 border-l border-[#efeee8] text-[12.5px] text-[#5a5852] truncate">{description}</div>}
      <button onClick={() => useUi.getState().set({ editingNodeId: node.id })} className="ml-auto flex items-center gap-1 text-[13px] font-medium text-[#f54e00] hover:text-[#d04200] whitespace-nowrap">
        Edit properties <ArrowUpRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

/** The thin strip under the canvas: how big the diagram is, and the gestures that are easy to miss. */
export const StatusFooter: React.FC = () => {
  const nodes = useDiagramStore((s) => s.nodes.length);
  const edges = useDiagramStore((s) => s.edges.length);
  return (
    <div className="h-8 flex-shrink-0 flex items-center justify-between gap-4 px-6 border-t border-[#e6e5e0] bg-white text-[12px] text-[#807d72] overflow-hidden">
      <span className="flex items-center gap-2 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-[#1f8a65]" />
        {nodes} component{nodes === 1 ? '' : 's'} · {edges} connection{edges === 1 ? '' : 's'}
      </span>
      <span className="hidden md:flex items-center gap-3 whitespace-nowrap">
        <span>Space to pan</span>
        <span aria-hidden>·</span>
        <span>Scroll to zoom</span>
        <span aria-hidden>·</span>
        <span>Delete removes the selection</span>
      </span>
    </div>
  );
};
