/** Snapping and alignment guides for dragging a component: pure geometry, so the maths is tested without a browser. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Guides {
  /** Vertical lines: the x they sit on and how far they run. */
  vertical: Array<{ x: number; y1: number; y2: number }>;
  /** Horizontal lines: the y they sit on and how far they run. */
  horizontal: Array<{ y: number; x1: number; x2: number }>;
}

export const NO_GUIDES: Guides = { vertical: [], horizontal: [] };

/** The three lines of a box along one axis: its start, its middle, its end. */
const lines = (start: number, size: number): number[] => [start, start + size / 2, start + size];

interface Best {
  /** How far to move the dragged box to line up. */
  shift: number;
  /** The coordinate of the line it lines up with. */
  at: number;
}

function nearest(moving: number[], other: number[], threshold: number): Best | null {
  let best: Best | null = null;
  for (const m of moving) {
    for (const o of other) {
      const d = o - m;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.shift))) best = { shift: d, at: o };
    }
  }
  return best;
}

/**
 * Where a dragged box lands when it is near enough to line up (left, middle or right edge; top, middle or bottom) with another box, and
 * the guide lines to draw for it. `threshold` is in the same units as the boxes (pass a screen distance divided by the zoom).
 */
export function snapBox(moving: Box, others: readonly Box[], threshold: number): { x: number; y: number; guides: Guides } {
  let bestX: (Best & { other: Box }) | null = null;
  let bestY: (Best & { other: Box }) | null = null;
  for (const o of others) {
    const bx = nearest(lines(moving.x, moving.width), lines(o.x, o.width), threshold);
    if (bx && (!bestX || Math.abs(bx.shift) < Math.abs(bestX.shift))) bestX = { ...bx, other: o };
    const by = nearest(lines(moving.y, moving.height), lines(o.y, o.height), threshold);
    if (by && (!bestY || Math.abs(by.shift) < Math.abs(bestY.shift))) bestY = { ...by, other: o };
  }
  const x = moving.x + (bestX?.shift ?? 0);
  const y = moving.y + (bestY?.shift ?? 0);

  // After snapping, every other box that now shares a line gets one guide, running across both.
  const guides: Guides = { vertical: [], horizontal: [] };
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const snapped: Box = { ...moving, x, y };
  if (bestX) {
    for (const o of others) {
      const hit = lines(snapped.x, snapped.width).find((m) => lines(o.x, o.width).some((l) => near(l, m)));
      if (hit !== undefined) guides.vertical.push({ x: hit, y1: Math.min(snapped.y, o.y), y2: Math.max(snapped.y + snapped.height, o.y + o.height) });
    }
  }
  if (bestY) {
    for (const o of others) {
      const hit = lines(snapped.y, snapped.height).find((m) => lines(o.y, o.height).some((l) => near(l, m)));
      if (hit !== undefined) guides.horizontal.push({ y: hit, x1: Math.min(snapped.x, o.x), x2: Math.max(snapped.x + snapped.width, o.x + o.width) });
    }
  }
  return { x, y, guides };
}
