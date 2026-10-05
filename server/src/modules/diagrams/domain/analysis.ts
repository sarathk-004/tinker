/**
 * Nodes reachable by following edges forward from `startNodeId` (excluding the start itself),
 * in breadth-first order. Terminates on cycles and lists each node once. Deterministic: ties follow edge order.
 * Unknown start node returns an empty list.
 */
export function downstreamNodeIds(graph: { nodes: { id: string }[]; edges: { sourceNodeId: string; targetNodeId: string }[] }, startNodeId: string): string[] {
  if (!graph.nodes.some((n) => n.id === startNodeId)) return [];
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.sourceNodeId);
    if (list) list.push(edge.targetNodeId);
    else outgoing.set(edge.sourceNodeId, [edge.targetNodeId]);
  }
  const seen = new Set<string>([startNodeId]);
  const order: string[] = [];
  const queue = [startNodeId];
  for (let i = 0; i < queue.length; i++) {
    for (const next of outgoing.get(queue[i] as string) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      order.push(next);
      queue.push(next);
    }
  }
  return order;
}
