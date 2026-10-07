import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { DiagramNode } from '../types/diagram';
import { AWSIcon } from './icons/AWSIcons';
import { useDiagramStore } from '../diagram/store';
import { Trash2, Play } from 'lucide-react';
import clsx from 'clsx';

const KIND_NAME: Record<string, string> = { client: 'Client', gateway: 'Gateway', service: 'Service', database: 'Database', cache: 'Cache', queue: 'Queue', storage: 'Storage', external: 'External', generic: 'Component' };

/** A small coloured tick before the category label, so the kind reads at a glance without a loud badge. */
const KIND_TINT: Record<string, string> = {
  gateway: '#9fbbe0',
  cache: '#dfa88f',
  database: '#9fc9a2',
  queue: '#c08532',
  storage: '#c0a8dd',
  client: '#807d72',
  service: '#cfcdc4',
};

const handle = '!w-2 !h-2 !bg-white !border !border-[#a09c92] !opacity-0 group-hover:!opacity-100 hover:!border-[#f54e00] hover:!bg-[#f54e00] !transition-all';

export const AWSArchitectureNode: React.FC<NodeProps<DiagramNode>> = memo(({ data, selected }) => {
  const { id, label, type, awsIcon, subType, description, group, isHighlighted, isDimmed } = data;
  const store = useDiagramStore();
  const category = (subType || KIND_NAME[type] || type).toUpperCase();
  const detail = description ?? (group ? `Group · ${group}` : KIND_NAME[type]);

  return (
    <div
      onClick={() => store.setSelectedNodeIds([id])}
      className={clsx(
        'relative group min-w-[212px] max-w-[260px] rounded-xl px-4 py-3.5 transition-all duration-150 select-none bg-white cursor-pointer',
        isHighlighted
          ? 'border-2 border-[#f54e00] shadow-[0_0_0_4px_rgba(245,78,0,0.12)] z-50'
          : selected
          ? 'border-2 border-[#f54e00] shadow-[0_4px_16px_rgba(38,37,30,0.07)]'
          : 'border border-[#e6e5e0] shadow-[0_1px_2px_rgba(38,37,30,0.04)] hover:border-[#cfcdc4] hover:shadow-[0_4px_14px_rgba(38,37,30,0.06)]',
        isDimmed && 'opacity-30',
      )}
    >
      {(selected || isHighlighted) && <span aria-hidden className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-[#f54e00]" />}

      <div className="absolute -top-3.5 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center bg-white border border-[#e6e5e0] rounded-lg px-0.5 py-0.5 shadow-sm z-10">
        <button onClick={(e) => { e.stopPropagation(); void store.playFlow([id]); }} title="Play the flow from here" aria-label="Play the flow from here" className="p-1 rounded-md text-[#807d72] hover:text-[#f54e00] hover:bg-[#fafaf7]">
          <Play className="w-3 h-3" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); void store.removeNode(id); }} title="Delete this component" aria-label="Delete this component" className="p-1 rounded-md text-[#807d72] hover:text-[#cf2d56] hover:bg-[#cf2d56]/10">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      <Handle type="target" position={Position.Left} className={handle} />
      <Handle type="target" position={Position.Top} className={handle} />

      <div className="flex items-center gap-2 mb-2">
        <AWSIcon name={awsIcon} type={type} size={20} />
        <span className="flex items-center gap-1.5 min-w-0 font-mono text-[10px] uppercase tracking-[0.07em] text-[#807d72]">
          <span aria-hidden className="w-1.5 h-1.5 rounded-sm flex-shrink-0" style={{ background: KIND_TINT[type] ?? '#cfcdc4' }} />
          <span className="truncate">{category}</span>
        </span>
      </div>
      <div className="text-[17px] font-semibold tracking-[-0.02em] leading-[1.2] text-[#26251e] truncate">{label}</div>
      {detail && <div className="mt-1 font-mono text-[11px] leading-snug text-[#807d72] truncate">{detail}</div>}

      <Handle type="source" position={Position.Right} className={handle} />
      <Handle type="source" position={Position.Bottom} className={handle} />
    </div>
  );
});

AWSArchitectureNode.displayName = 'AWSArchitectureNode';
