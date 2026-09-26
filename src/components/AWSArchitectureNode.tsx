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
        return 'text-purple-300 bg-[#7b3ff2]/15 border-[#7b3ff2]/35';
      case 'cache':
        return 'text-pink-300 bg-[#f06bb8]/15 border-[#f06bb8]/35';
      case 'database':
        return 'text-[#00ed64] bg-[#00ed64]/15 border-[#00ed64]/35';
      case 'queue':
        return 'text-orange-300 bg-[#fa6e39]/15 border-[#fa6e39]/35';
      case 'storage':
        return 'text-blue-300 bg-[#3d4f9f]/15 border-[#3d4f9f]/35';
      case 'client':
        return 'text-slate-200 bg-[#002636] border-[#1c2d38]';
      case 'service':
      default:
        return 'text-[#00ed64] bg-[#00ed64]/10 border-[#00ed64]/30';
    }
  };

  return (
    <div
      className={clsx(
        'relative group min-w-[210px] rounded-xl px-4 py-3 transition-all duration-300 shadow-xl select-none animate-in fade-in zoom-in-95',
        'bg-[#001e2b]/95 backdrop-blur-md border',
        isHighlighted
          ? 'border-[#00ed64] ring-2 ring-[#00ed64]/50 shadow-[#00ed64]/20 scale-105 z-50'
          : selected
          ? 'border-[#00ed64] ring-2 ring-[#00ed64]/40'
          : 'border-[#1c2d38] hover:border-[#00ed64]/40 shadow-black/40',
        isDimmed && 'opacity-25 blur-[0.4px] scale-95'
      )}
    >
      {/* Input handles - MongoDB bright green */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-[#00ed64] !border-2 !border-[#001e2b] hover:!scale-125 !transition-transform"
      />
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2.5 !h-2.5 !bg-[#00ed64] !border-2 !border-[#001e2b] hover:!scale-125 !transition-transform"
      />

      <div className="flex items-center gap-3">
        {/* AWS Icon Container */}
        <div className="flex-shrink-0 p-2 rounded-xl bg-[#002636] border border-[#1c2d38] shadow-inner group-hover:border-[#00ed64]/40 transition-colors">
          <AWSIcon name={awsIcon} type={type} size={26} />
        </div>

        {/* Labels */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-white text-sm tracking-tight truncate font-sans">
              {label}
            </span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00ed64] animate-pulse flex-shrink-0" />
          </div>

          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className={clsx(
                'text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full border',
                getBadgeColor()
              )}
            >
              {subType || type}
            </span>
          </div>
        </div>
      </div>

      {/* Output handles - MongoDB bright green */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-[#00ed64] !border-2 !border-[#001e2b] hover:!scale-125 !transition-transform"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2.5 !h-2.5 !bg-[#00ed64] !border-2 !border-[#001e2b] hover:!scale-125 !transition-transform"
      />
    </div>
  );
});

AWSArchitectureNode.displayName = 'AWSArchitectureNode';
