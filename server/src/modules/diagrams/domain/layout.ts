import dagre from '@dagrejs/dagre';
import type { Graph, Position } from '@tinker/shared';

// Same geometry as the prototype's layout (src/diagram/layout.ts) so positions look familiar.
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 90;
const CLEARANCE = 40; // minimum empty space kept around a newly placed node
const STEP = NODE_HEIGHT + CLEARANCE;
const MAX_STEPS = 200;

/** Deterministic dagre layout of the whole graph, left-to-right. Pure: same graph in, same positions out. */
export function layoutGraph(graph: Pick<Graph, 'nodes' | 'edges'>): Record<string, Position> {
  if (graph.nodes.length === 0) return {};
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 100, marginx: 40, marginy: 40 });
  for (const node of graph.nodes) g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of graph.edges) g.setEdge(edge.sourceNodeId, edge.targetNodeId, {}, edge.id);
  dagre.layout(g);

  const positions: Record<string, Position> = {};
  for (const node of graph.nodes) {
    const p = g.node(node.id);
    positions[node.id] = { x: Math.round(p.x - NODE_WIDTH / 2), y: Math.round(p.y - NODE_HEIGHT / 2) };
  }
  return positions;
}

function overlaps(a: Position, b: Position): boolean {
  return (
    Math.abs(a.x - b.x) < NODE_WIDTH + CLEARANCE && Math.abs(a.y - b.y) < NODE_HEIGHT + CLEARANCE
  );
}

// Candidate offsets around the wanted spot, nearest first. Ties prefer sideways over up/down, then down, then right (left-to-right flow). Built once.
const OFFSETS: ReadonlyArray<readonly [number, number]> = (() => {
  const list: Array<[number, number]> = [];
  for (let i = -3; i <= 3; i++) for (let j = -6; j <= 6; j++) list.push([i * (NODE_WIDTH + CLEARANCE), j * STEP]);
  return list.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2) || Math.abs(a[1]) - Math.abs(b[1]) || b[1] - a[1] || b[0] - a[0]);
})();

/**
 * First free spot at or near `wanted`: the spot itself, then the nearest free grid slot around it (so a node inserted between
 * two vertically stacked nodes lands beside them, not far below). Falls back to scanning downwards. Deterministic.
 */
function nearestFreeSpot(wanted: Position, taken: Position[]): Position {
  for (const [dx, dy] of OFFSETS) {
    const candidate = { x: wanted.x + dx, y: wanted.y + dy };
    if (!taken.some((t) => overlaps(candidate, t))) return candidate;
  }
  for (let i = 1; i <= MAX_STEPS; i++) {
    const candidate = { x: wanted.x, y: wanted.y + 7 * STEP + i * STEP };
    if (!taken.some((t) => overlaps(candidate, t))) return candidate;
  }
  return wanted;
}

const GAP = 90; // clear space between a new component and the one it is connected to

/** Where a component with no connections goes: under the existing diagram, lined up with its left edge, so it is easy to find and to wire up. */
function belowTheDiagram(existing: Record<string, Position>): Position | null {
  const all = Object.values(existing);
  if (all.length === 0) return null;
  return { x: Math.min(...all.map((p) => p.x)), y: Math.max(...all.map((p) => p.y)) + NODE_HEIGHT + CLEARANCE };
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Put components that were just ADDED (and then connected, in the same plan) next to what they are connected to: to the right of what
 * feeds them, to the left of what they feed, between the two when both exist (below instead of right in a top-to-bottom diagram).
 * They are settled one at a time, starting with those connected to components that already existed, so a chain added in one request
 * ("Orders to Cache to Database") lays out as a chain. Components with no connection keep the position they were given.
 * Pure and deterministic; never touches positions of components that were not just added.
 */
export function settleNewNodes(
  graph: Pick<Graph, 'nodes' | 'edges'>,
  positions: Record<string, Position>,
  newIds: readonly string[],
  direction: 'LR' | 'TB' = 'LR',
): Record<string, Position> {
  const next = { ...positions };
  const fresh = new Set(newIds);
  const unsettled = new Set(newIds.filter((id) => next[id]));
  const feeds = (id: string) => graph.edges.filter((e) => e.targetNodeId === id).map((e) => e.sourceNodeId);
  const fedBy = (id: string) => graph.edges.filter((e) => e.sourceNodeId === id).map((e) => e.targetNodeId);
  const anchored = (own: string) => (other: string) => other !== own && !!next[other] && !unsettled.has(other);
  const isOld = (other: string) => !fresh.has(other);

  for (;;) {
    // Prefer a component connected to something that existed before; otherwise one connected to something already settled.
    const candidates = [...unsettled].filter((id) => [...feeds(id), ...fedBy(id)].some(anchored(id)));
    const pick = candidates.find((id) => [...feeds(id), ...fedBy(id)].some((o) => anchored(id)(o) && isOld(o))) ?? candidates[0];
    if (!pick) break;
    const before = feeds(pick).filter(anchored(pick));
    const after = fedBy(pick).filter(anchored(pick));
    const pos = (id: string) => next[id]!;
    const step = direction === 'LR' ? { x: NODE_WIDTH + GAP, y: 0 } : { x: 0, y: NODE_HEIGHT + GAP };
    let wanted: Position;
    if (before.length > 0 && after.length > 0) {
      wanted = { x: mean([...before, ...after].map((id) => pos(id).x)), y: mean([...before, ...after].map((id) => pos(id).y)) };
    } else if (before.length > 0) {
      wanted = { x: mean(before.map((id) => pos(id).x)) + step.x, y: mean(before.map((id) => pos(id).y)) + step.y };
    } else {
      wanted = { x: mean(after.map((id) => pos(id).x)) - step.x, y: mean(after.map((id) => pos(id).y)) - step.y };
    }
    const { [pick]: _own, ...others } = next;
    next[pick] = nearestFreeSpot(wanted, Object.values(others));
    unsettled.delete(pick);
  }
  return next;
}

/**
 * Decision P2: existing positions are preserved; only the listed new nodes receive a position.
 * Each new node starts from `hints[id]` (e.g. the midpoint of an insert) or its dagre-derived position,
 * then moves to the nearest free spot so it never lands on top of another node.
 * Returns a new nodePositions object (never mutates the input).
 */
export function placeNewNodes(
  graph: Pick<Graph, 'nodes' | 'edges'>,
  existing: Record<string, Position>,
  newNodeIds: readonly string[],
  hints: Readonly<Record<string, Position>> = {},
): Record<string, Position> {
  if (newNodeIds.length === 0) return { ...existing };
  const laidOut = layoutGraph(graph);
  const next = { ...existing };
  for (const id of newNodeIds) {
    // A hint (a drop point, the middle of an insert) wins. Without one, a new component goes under the existing diagram: the whole-graph
    // layout would put an unconnected component wherever it likes, often far from everything.
    const wanted = hints[id] ?? belowTheDiagram(next) ?? laidOut[id];
    if (!wanted) continue;
    next[id] = nearestFreeSpot(wanted, Object.values(next));
  }
  return next;
}
