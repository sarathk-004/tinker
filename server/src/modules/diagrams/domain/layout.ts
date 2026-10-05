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

// Candidate offsets around the wanted spot, nearest first. Ties prefer sideways over up/down, then up, then right (left-to-right flow). Built once.
const OFFSETS: ReadonlyArray<readonly [number, number]> = (() => {
  const list: Array<[number, number]> = [];
  for (let i = -3; i <= 3; i++) for (let j = -6; j <= 6; j++) list.push([i * (NODE_WIDTH + CLEARANCE), j * STEP]);
  return list.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2) || Math.abs(a[1]) - Math.abs(b[1]) || a[1] - b[1] || b[0] - a[0]);
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
    const wanted = hints[id] ?? laidOut[id];
    if (!wanted) continue;
    next[id] = nearestFreeSpot(wanted, Object.values(next));
  }
  return next;
}
