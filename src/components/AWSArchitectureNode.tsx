import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { DiagramNode } from '../types/diagram';
import { AWSIcon } from './icons/AWSIcons';
import { useDiagramStore } from '../diagram/store';
import { Trash2, Play } from 'lucide-react';
import clsx from 'clsx';

export const AWSArchitectureNode: React.FC<NodeProps<DiagramNode>> = memo(({ data, selected }) => {
  const { id, label, type, awsIcon, subType, group, isHighlighted, isDimmed } = data;
  const store = useDiagramStore();

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

  const handleNodeClick = () => {
    store.setSelectedNodeIds([id]);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    store.removeNode(id);
  };

  const handlePlayFromNode = (e: React.MouseEvent) => {
    e.stopPropagation();
    store.playFlow([id]);
  };

  return (
    <div
      onClick={handleNodeClick}
      className={clsx(
        'relative group min-w-[210px] rounded-lg px-3.5 py-3 transition-all duration-200 select-none bg-white border cursor-pointer',
        isHighlighted
          ? 'border-[#f54e00] ring-2 ring-[#f54e00]/25 z-50 scale-105 shadow-md'
          : selected
          ? 'border-[#f54e00] ring-1 ring-[#f54e00]/20 shadow-xs'
          : 'border-[#e6e5e0] hover:border-[#cfcdc4]',
        isDimmed && 'opacity-25 blur-[0.4px] scale-95'
      )}
    >
      {/* Floating Hover Actions */}
      <div className="absolute -top-3 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-white border border-[#e6e5e0] rounded-md px-1 py-0.5 shadow-xs z-30">
        <button
          onClick={handlePlayFromNode}
          title="Play flow from here"
          className="p-1 rounded text-[#807d72] hover:text-[#f54e00] hover:bg-[#fafaf7] transition-colors"
        >
          <Play className="w-3 h-3" />
        </button>
        <button
          onClick={handleDelete}
          title="Delete node"
          className="p-1 rounded text-[#807d72] hover:text-[#cf2d56] hover:bg-[#cf2d56]/10 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

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
        <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 p-1.5 rounded-md bg-[#fafaf7] border border-[#e6e5e0] group-hover:border-[#cfcdc4] transition-colors">
          <AWSIcon name={awsIcon} type={type} size={26} />
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
                'text-[10px] font-mono font-medium tracking-wide uppercase px-2 py-0.5 rounded-full border truncate max-w-[140px]',
                getBadgeColor()
              )}
            >
              {subType || type}
            </span>
            {group && (
              <span
                title={`Group: ${group}`}
                className="text-[10px] font-mono tracking-wide px-1.5 py-0.5 rounded border border-dashed border-[#cfcdc4] text-[#807d72] truncate max-w-[90px]"
              >
                {group}
              </span>
            )}
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
