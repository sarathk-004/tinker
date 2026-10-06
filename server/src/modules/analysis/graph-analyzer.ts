import type { Graph } from '@tinker/shared';

/**
 * Deterministic graph facts (no model). An edge source -> target means "source sends to / calls target".
 * Downstream of X = everything X reaches; upstream of X = everything that reaches X. Results are in discovery order
 * (breadth first). X itself is never included.
 */
export interface Adjacency {
  out: Map<string, string[]>;
  into: Map<string, string[]>;
}

export function adjacency(graph: Graph): Adjacency {
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const n of graph.nodes) (out.set(n.id, []), into.set(n.id, []));
  for (const e of graph.edges) {
    out.get(e.sourceNodeId)?.push(e.targetNodeId);
    into.get(e.targetNodeId)?.push(e.sourceNodeId);
  }
  return { out, into };
}

function reach(start: string, next: Map<string, string[]>): string[] {
  const seen = new Set<string>([start]);
  const order: string[] = [];
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const n of next.get(queue[i]!) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      order.push(n);
      queue.push(n);
    }
  }
  return order;
}

export const downstreamOf = (graph: Graph, nodeId: string, adj: Adjacency = adjacency(graph)): string[] => reach(nodeId, adj.out);
export const upstreamOf = (graph: Graph, nodeId: string, adj: Adjacency = adjacency(graph)): string[] => reach(nodeId, adj.into);

/** Groups of two or more components that can reach each other (plus self-loops), via Tarjan's algorithm (iterative). */
export function findCycles(graph: Graph, adj: Adjacency = adjacency(graph)): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;

  for (const root of graph.nodes.map((n) => n.id)) {
    if (index.has(root)) continue;
    const work: Array<{ node: string; next: number }> = [{ node: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const targets = adj.out.get(frame.node) ?? [];
      if (frame.next < targets.length) {
        const to = targets[frame.next++]!;
        if (!index.has(to)) {
          index.set(to, counter);
          low.set(to, counter++);
          stack.push(to);
          onStack.add(to);
          work.push({ node: to, next: 0 });
        } else if (onStack.has(to)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(to)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) === index.get(frame.node)) {
        const group: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          group.push(member);
        } while (member !== frame.node);
        const selfLoop = group.length === 1 && (adj.out.get(group[0]!) ?? []).includes(group[0]!);
        if (group.length > 1 || selfLoop) cycles.push(group.reverse());
      }
    }
  }
  return cycles;
}

/** Components with nothing sending to them / that send to nothing (documented entry and exit points). */
export function entryPoints(graph: Graph, adj: Adjacency = adjacency(graph)): string[] {
  return graph.nodes.filter((n) => (adj.into.get(n.id) ?? []).length === 0 && (adj.out.get(n.id) ?? []).length > 0).map((n) => n.id);
}
export function exitPoints(graph: Graph, adj: Adjacency = adjacency(graph)): string[] {
  return graph.nodes.filter((n) => (adj.out.get(n.id) ?? []).length === 0 && (adj.into.get(n.id) ?? []).length > 0).map((n) => n.id);
}
export function isolatedNodes(graph: Graph, adj: Adjacency = adjacency(graph)): string[] {
  return graph.nodes.filter((n) => (adj.out.get(n.id) ?? []).length === 0 && (adj.into.get(n.id) ?? []).length === 0).map((n) => n.id);
}

const ESCAPE = /[.*+?^$|(){}[\]\\]/g;

/**
 * Components named in the question (case-insensitive, whole words, longest names first, no overlaps). Names under two
 * characters are ignored. This is how "What happens if Orders goes down?" finds Orders without asking a model.
 */
export function findMentions(graph: Graph, question: string): string[] {
  const text = question.toLowerCase();
  const taken: Array<[number, number]> = [];
  const found: Array<{ id: string; at: number }> = [];
  const byLength = [...graph.nodes].sort((a, b) => b.name.length - a.name.length);
  for (const n of byLength) {
    const name = n.name.trim().toLowerCase();
    if (name.length < 2) continue;
    const escaped = name.replace(ESCAPE, '\\$&');
    const pattern = new RegExp('(?<![\\p{L}\\p{N}])' + escaped + '(?![\\p{L}\\p{N}])', 'u');
    const m = pattern.exec(text);
    if (!m) continue;
    const range: [number, number] = [m.index, m.index + name.length];
    if (taken.some(([a, b]) => range[0] < b && a < range[1])) continue;
    taken.push(range);
    found.push({ id: n.id, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.id);
}
