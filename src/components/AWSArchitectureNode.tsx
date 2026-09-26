import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { DiagramNode } from '../types/diagram';
import { AWSIcon } from './icons/AWSIcons';
import clsx from 'clsx';

export const AWSArchitectureNode: React.FC<NodeProps<DiagramNode>> = memo(({ data, selected }) => {
  const { label, type, awsIcon, subType, isHighlighted, isDimmed } = data;

  const getBadgeColor = () => {
    switch (type) {
      case 'gateway':
        return 'text-purple-400 bg-purple-950/60 border-purple-800/60';
      case 'cache':
        return 'text-red-400 bg-red-950/60 border-red-800/60';
      case 'database':
        return 'text-blue-400 bg-blue-950/60 border-blue-800/60';
      case 'queue':
        return 'text-pink-400 bg-pink-950/60 border-pink-800/60';
      case 'storage':
        return 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60';
      case 'client':
        return 'text-sky-400 bg-sky-950/60 border-sky-800/60';
      case 'service':
      default:
        return 'text-amber-400 bg-amber-950/60 border-amber-800/60';
    }
  };

  return (
    <div
      className={clsx(
        'relative group min-w-[210px] rounded-xl px-4 py-3 transition-all duration-300 shadow-xl select-none animate-in fade-in zoom-in-95',
        'bg-[#121620]/90 backdrop-blur-md border',
        isHighlighted
          ? 'border-amber-400 ring-2 ring-amber-400/50 shadow-amber-500/20 scale-105 z-50'
          : selected
          ? 'border-blue-400 ring-2 ring-blue-400/40'
          : 'border-slate-800/90 hover:border-slate-700 shadow-black/40',
        isDimmed && 'opacity-25 blur-[0.4px] scale-95'
      )}
    >
      {/* Input handles */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-amber-500 !border-2 !border-[#090b10] hover:!scale-125 !transition-transform"
      />
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2.5 !h-2.5 !bg-amber-500 !border-2 !border-[#090b10] hover:!scale-125 !transition-transform"
      />

      <div className="flex items-center gap-3">
        {/* AWS Icon Container */}
        <div className="flex-shrink-0 p-2 rounded-lg bg-slate-900/90 border border-slate-800 shadow-inner group-hover:border-slate-700 transition-colors">
          <AWSIcon name={awsIcon} type={type} size={26} />
        </div>

        {/* Labels */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-100 text-sm tracking-tight truncate">
              {label}
            </span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
          </div>

          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className={clsx(
                'text-[10px] font-medium tracking-wide uppercase px-1.5 py-0.5 rounded border',
                getBadgeColor()
              )}
            >
              {subType || type}
            </span>
          </div>
        </div>
      </div>

      {/* Output handles */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-amber-500 !border-2 !border-[#090b10] hover:!scale-125 !transition-transform"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2.5 !h-2.5 !bg-amber-500 !border-2 !border-[#090b10] hover:!scale-125 !transition-transform"
      />
    </div>
  );
});

AWSArchitectureNode.displayName = 'AWSArchitectureNode';
