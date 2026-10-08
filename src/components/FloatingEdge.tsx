import React from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Position, useInternalNode, type EdgeProps } from '@xyflow/react';
import { edgeAnchors, spread, type Box, type Side } from '../diagram/edgeGeometry';
import { useDiagramStore } from '../diagram/store';
import { useUi } from '../shell/uiStore';

const POSITION: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

/** A connection data shape: how many connections share this pair of components, and which one this is (so they do not overlap). */
export interface FloatingEdgeData extends Record<string, unknown> {
  index?: number;
  count?: number;
  bidirectional?: boolean;
}

/** Draws a connection between the facing sides of its two components, whichever sides those are. */
export const FloatingEdge: React.FC<EdgeProps> = ({ id, source, target, markerStart, markerEnd, style, label, selected, data }) => {
  const editing = useUi((u) => u.editingEdgeId === id);
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t || !s.measured.width || !t.measured.width) return null;

  const box = (n: typeof s): Box => ({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width: n.measured.width ?? 0, height: n.measured.height ?? 0 });
  const { from, to } = edgeAnchors(box(s), box(t));
  const { index = 0, count = 1, bidirectional = false } = (data ?? {}) as FloatingEdgeData;
  const text = typeof label === 'string' ? label : '';
  const a = spread(from, index, count);
  const b = spread(to, index, count);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: a.x,
    sourceY: a.y,
    sourcePosition: POSITION[a.side],
    targetX: b.x,
    targetY: b.y,
    targetPosition: POSITION[b.side],
    borderRadius: 14,
    offset: 22,
  });

  const stop = () => useUi.getState().set({ editingEdgeId: null });
  const commit = (value: string) => {
    stop();
    if (value.trim() !== text) void useDiagramStore.getState().updateEdge(id, { relationship: value.trim() || null });
  };
  const chip = `px-1.5 py-[3px] rounded-md border text-[10.5px] font-mono tracking-[0.02em] ${selected ? 'border-primary text-primary-hover bg-surface' : 'border-line text-body bg-canvas'}`;

  return (
    <>
      {selected && <BaseEdge id={`${id}-glow`} path={path} style={{ stroke: 'rgb(var(--primary) / 0.22)', strokeWidth: 10, fill: 'none' }} interactionWidth={0} />}
      <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} style={style} interactionWidth={18} />
      <EdgeLabelRenderer>
        <div className="nodrag nopan absolute flex items-center gap-1" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}>
          {editing ? (
            <input
              autoFocus
              defaultValue={text}
              maxLength={120}
              aria-label="Text on this connection"
              placeholder="e.g. HTTPS"
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commit(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commit(e.currentTarget.value);
                if (e.key === 'Escape') stop();
              }}
              className={`${chip} w-32 outline-none`}
            />
          ) : (
            <>
              {text ? (
                <button onDoubleClick={() => useUi.getState().set({ editingEdgeId: id })} title="Double-click to edit" className={chip}>
                  {text}
                </button>
              ) : (
                selected && (
                  <button onClick={() => useUi.getState().set({ editingEdgeId: id })} className={`${chip} text-muted`}>
                    + Add text
                  </button>
                )
              )}
              {selected && (
                <button
                  onClick={() => void useDiagramStore.getState().updateEdge(id, { bidirectional: !bidirectional })}
                  aria-pressed={bidirectional}
                  title={bidirectional ? 'Arrow points both ways: click for one way' : 'Make the arrow point both ways'}
                  className={`${chip} ${bidirectional ? 'text-primary-hover' : 'text-muted'}`}
                >
                  <ArrowLeftRight className="w-3 h-3" />
                </button>
              )}
            </>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
