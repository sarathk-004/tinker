import React from 'react';
import { BaseEdge, getSmoothStepPath, Position, useInternalNode, type EdgeProps } from '@xyflow/react';
import { edgeAnchors, spread, type Box, type Side } from '../diagram/edgeGeometry';

const POSITION: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

/** A connection data shape: how many connections share this pair of components, and which one this is (so they do not overlap). */
export interface FloatingEdgeData extends Record<string, unknown> {
  index?: number;
  count?: number;
}

/** Draws a connection between the facing sides of its two components, whichever sides those are. */
export const FloatingEdge: React.FC<EdgeProps> = ({ id, source, target, markerStart, markerEnd, style, label, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius, data }) => {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t || !s.measured.width || !t.measured.width) return null;

  const box = (n: typeof s): Box => ({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width: n.measured.width ?? 0, height: n.measured.height ?? 0 });
  const { from, to } = edgeAnchors(box(s), box(t));
  const { index = 0, count = 1 } = (data ?? {}) as FloatingEdgeData;
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

  return (
    <BaseEdge
      id={id}
      path={path}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={style}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelStyle={labelStyle}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      interactionWidth={18}
    />
  );
};
