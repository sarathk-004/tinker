import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { DiagramNode } from '../types/diagram';
import { AWSIcon } from './icons/AWSIcons';
import clsx from 'clsx';

export const AWSArchitectureNode: React.FC<NodeProps<DiagramNode>> = memo(({ data, selected }) => {
  const { label, type, awsIcon, subType, isHighlighted, isDimmed } = data;

  // In-product timeline pastels from Cursor Design System
  const getBadgeColor = () => {
    switch (type) {
      case 'gateway':
        return 'text-[#26251e] bg-[#9fbbe0]/30 border-[#9fbbe0]/70'; // pastel blue
      case 'cache':
        return 'text-[#26251e] bg-[#dfa88f]/30 border-[#dfa88f]/70'; // peach
      case 'database':
        return 'text-[#26251e] bg-[#9fc9a2]/35 border-[#9fc9a2]/70'; // mint
      case 'queue':
        return 'text-[#26251e] bg-[#c08532]/25 border-[#c08532]/60'; // warm gold
      case 'storage':
        return 'text-[#26251e] bg-[#c0a8dd]/30 border-[#c0a8dd]/70'; // lavender
      case 'client':
        return 'text-[#5a5852] bg-[#fafaf7] border-[#e6e5e0]';
      case 'service':
      default:
        return 'text-[#26251e] bg-[#e6e5e0] border-[#cfcdc4]';
    }
  };

  return (
    <div
      className={clsx(
        'relative group min-w-[200px] rounded-lg px-3.5 py-3 transition-all duration-200 select-none bg-white border',
        isHighlighted
          ? 'border-[#f54e00] ring-2 ring-[#f54e00]/25 z-50 scale-105'
          : selected
          ? 'border-[#f54e00] ring-1 ring-[#f54e00]/20'
          : 'border-[#e6e5e0] hover:border-[#cfcdc4]',
        isDimmed && 'opacity-25 blur-[0.4px] scale-95'
      )}
    >
      {/* Input handles - Cursor dark ink */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-[#26251e] !border !border-white hover:!bg-[#f54e00] hover:!scale-125 !transition-all"
      />
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-[#26251e] !border !border-white hover:!bg-[#f54e00] hover:!scale-125 !transition-all"
      />

      <div className="flex items-center gap-3">
        {/* AWS Icon Container */}
        <div className="flex-shrink-0 p-2 rounded-md bg-[#fafaf7] border border-[#e6e5e0] group-hover:border-[#cfcdc4] transition-colors">
          <AWSIcon name={awsIcon} type={type} size={24} />
        </div>

        {/* Node Labels */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-[#26251e] text-[13px] tracking-tight truncate font-sans">
              {label}
            </span>
            {isHighlighted && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#f54e00] animate-pulse flex-shrink-0" />
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={clsx(
                'text-[10px] font-mono font-medium tracking-wide uppercase px-2 py-0.5 rounded-full border',
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
        className="!w-2 !h-2 !bg-[#26251e] !border !border-white hover:!bg-[#f54e00] hover:!scale-125 !transition-all"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-[#26251e] !border !border-white hover:!bg-[#f54e00] hover:!scale-125 !transition-all"
      />
    </div>
  );
});

AWSArchitectureNode.displayName = 'AWSArchitectureNode';
