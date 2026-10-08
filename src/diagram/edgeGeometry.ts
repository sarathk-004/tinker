/**
 * Where a connection leaves one component and enters another. The line runs between the two centres and is cut where it crosses each
 * box, so a connection uses whichever side faces the other component (top and bottom included), without the diagram having to
 * remember a side for every connection. Pure: the same boxes always give the same answer.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';
export interface Anchor {
  x: number;
  y: number;
  side: Side;
}

const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** The point on the border of `box` that faces `toward`, and which side that point is on. */
export function anchorToward(box: Box, toward: { x: number; y: number }): Anchor {
  const c = centre(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  if (dx === 0 && dy === 0) return { x: c.x + halfW, y: c.y, side: 'right' };
  // Compare the direction with the box's own diagonal: a wide box is "reached from the side" more often than a tall one.
  const horizontal = Math.abs(dx) * halfH > Math.abs(dy) * halfW;
  if (horizontal) return dx > 0 ? { x: c.x + halfW, y: c.y + (dy * halfW) / Math.abs(dx), side: 'right' } : { x: c.x - halfW, y: c.y + (dy * halfW) / Math.abs(dx), side: 'left' };
  return dy > 0 ? { x: c.x + (dx * halfH) / Math.abs(dy), y: c.y + halfH, side: 'bottom' } : { x: c.x + (dx * halfH) / Math.abs(dy), y: c.y - halfH, side: 'top' };
}

export function edgeAnchors(source: Box, target: Box): { from: Anchor; to: Anchor } {
  return { from: anchorToward(source, centre(target)), to: anchorToward(target, centre(source)) };
}

/** Two connections between the same pair of components (or one each way) are pushed apart so they do not lie on top of each other. */
export function spread(anchor: Anchor, index: number, count: number, gap = 14): Anchor {
  if (count <= 1) return anchor;
  const shift = (index - (count - 1) / 2) * gap;
  return anchor.side === 'left' || anchor.side === 'right' ? { ...anchor, y: anchor.y + shift } : { ...anchor, x: anchor.x + shift };
}
