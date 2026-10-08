import { groupChain, groupJoin, groupLabel, groupParent, groupSegments, isInGroup } from '../contracts';

/** What the canvas knows about a component when it draws groups: where it is, how big it is, and its innermost group path. */
export interface PlacedNode {
  id: string;
  group?: string | undefined;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface GroupBox {
  path: string;
  label: string;
  /** 0 for a top-level group; deeper groups are drawn on top of the ones that contain them. */
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Every component inside this group, including those in groups nested within it. */
  memberIds: string[];
  /** The groups directly inside this one. */
  childPaths: string[];
}

export const NODE_W = 232;
export const NODE_H = 104;
const PAD = 26; // space between the outermost components and a box
const NEST = 20; // each level of nesting adds this much, so an outer box always encloses an inner one
const HEADER = 30; // room above the components for the name

export const groupOfNode = (n: { metadata?: Record<string, unknown> }): string | undefined => {
  const g = n.metadata?.['group'];
  return typeof g === 'string' && g.length > 0 ? g : undefined;
};

/**
 * One box per group that has at least one component in it (also through groups nested inside it). A box is the smallest rectangle around
 * its members, widened a little per level of nesting so that an outer group visibly contains an inner one. `exclude` leaves some components
 * out of the calculation: used to ask "where would this box be WITHOUT the component being dragged".
 */
export function computeGroupBoxes(nodes: readonly PlacedNode[], exclude: ReadonlySet<string> = new Set()): GroupBox[] {
  const members = new Map<string, PlacedNode[]>();
  for (const n of nodes) {
    if (exclude.has(n.id)) continue;
    for (const path of groupChain(n.group)) members.set(path, [...(members.get(path) ?? []), n]);
  }
  const paths = [...members.keys()];
  const depthOf = (p: string) => groupSegments(p).length - 1;
  const below = (p: string) => Math.max(0, ...paths.filter((q) => q.startsWith(p + ' / ')).map((q) => depthOf(q) - depthOf(p)));

  return paths
    .map((path): GroupBox => {
      const list = members.get(path)!;
      const pad = PAD + NEST * below(path);
      const minX = Math.min(...list.map((n) => n.x));
      const minY = Math.min(...list.map((n) => n.y));
      const maxX = Math.max(...list.map((n) => n.x + (n.width ?? NODE_W)));
      const maxY = Math.max(...list.map((n) => n.y + (n.height ?? NODE_H)));
      return {
        path,
        label: groupLabel(path),
        depth: depthOf(path),
        x: minX - pad,
        y: minY - pad - HEADER,
        width: maxX - minX + pad * 2,
        height: maxY - minY + pad * 2 + HEADER,
        memberIds: list.map((n) => n.id),
        childPaths: paths.filter((q) => groupParent(q) === path),
      };
    })
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
}

const contains = (b: GroupBox, p: { x: number; y: number }) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/** The deepest box a point is inside (null when it is in none). */
export function innermostBoxAt(boxes: readonly GroupBox[], point: { x: number; y: number }): GroupBox | null {
  let best: GroupBox | null = null;
  for (const b of boxes) if (contains(b, point) && (!best || b.depth > best.depth)) best = b;
  return best;
}

const centreOf = (n: PlacedNode) => ({ x: n.x + (n.width ?? NODE_W) / 2, y: n.y + (n.height ?? NODE_H) / 2 });

/**
 * After components are dragged: which group should each one be in now? A component belongs to the innermost box it was dropped inside
 * (boxes are measured WITHOUT the dragged components, so dragging one out of its box does not stretch the box to follow it). Returns only
 * the components whose group changes, grouped by their new group so each becomes one command.
 */
export function regroupAfterDrag(all: readonly PlacedNode[], draggedIds: readonly string[]): Array<{ group: string | null; nodeIds: string[] }> {
  const dragged = new Set(draggedIds);
  const boxes = computeGroupBoxes(all, dragged);
  const byTarget = new Map<string | null, string[]>();
  for (const n of all) {
    if (!dragged.has(n.id)) continue;
    const target = innermostBoxAt(boxes, centreOf(n))?.path ?? null;
    if ((target ?? undefined) === n.group) continue;
    byTarget.set(target, [...(byTarget.get(target) ?? []), n.id]);
  }
  return [...byTarget.entries()].map(([group, nodeIds]) => ({ group, nodeIds }));
}

/**
 * After a whole group is dragged: should it now sit inside another group (or have left the one it was in)? Returns the group's new path,
 * or null when nothing changes. The group's own members are left out of the measurement, so it can only land in a box that is not itself
 * or one of its own inner boxes.
 */
export function reparentAfterGroupDrag(all: readonly PlacedNode[], path: string, droppedBox: { x: number; y: number; width: number; height: number }): string | null {
  const inside = new Set(all.filter((n) => isInGroup(n.group, path)).map((n) => n.id));
  const boxes = computeGroupBoxes(all, inside);
  const centre = { x: droppedBox.x + droppedBox.width / 2, y: droppedBox.y + droppedBox.height / 2 };
  const parent = innermostBoxAt(boxes, centre)?.path ?? '';
  const next = groupJoin(parent, groupLabel(path));
  return next === path ? null : next;
}

/** A name for a new group that is not taken by a sibling: "New group", then "New group 2", "New group 3". */
export function freshGroupName(existing: readonly string[], parent: string, base = 'New group'): string {
  const taken = new Set(existing);
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? base : `${base} ${i}`;
    if (!taken.has(groupJoin(parent, name))) return name;
  }
  return base;
}

/** The group a new group should live in: the one every selected component already shares (empty when they differ or have none). */
export function sharedParentGroup(groups: ReadonlyArray<string | undefined>): string {
  const first = groups[0];
  return first && groups.every((g) => g === first) ? first : '';
}

/** Canvas ids for the boxes (a component's id is a UUID, a note's starts with "note:", a box's with "group:"). */
export const GROUP_NODE_PREFIX = 'group:';
export const isGroupNodeId = (id: string): boolean => id.startsWith(GROUP_NODE_PREFIX);
export const groupNodeId = (path: string): string => `${GROUP_NODE_PREFIX}${path}`;
export const groupPathOfNodeId = (id: string): string => id.slice(GROUP_NODE_PREFIX.length);
