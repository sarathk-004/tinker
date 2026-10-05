import type { GraphNode } from '@tinker/shared';
import type { DiagramDoc } from '../../src/modules/diagrams/domain/index.ts';

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type NodeSpec = string | [name: string, kind?: GraphNode['kind'], technology?: string];
type EdgeSpec = [from: string, to: string, relationship?: string];

/** Build a valid document: nodes get ids 1..N in order, edges ids 101.. in order; every node gets a position. */
export function mkDoc(nodes: NodeSpec[], edges: EdgeSpec[] = []): DiagramDoc {
  const list: GraphNode[] = nodes.map((spec, i) => {
    const [name, kind = 'SERVICE', technology] = Array.isArray(spec) ? spec : [spec];
    return { id: uid(i + 1), name, kind, ...(technology ? { technology } : {}), metadata: {} };
  });
  const idOf = (name: string) => {
    const n = list.find((x) => x.name === name);
    if (!n) throw new Error(`no node ${name}`);
    return n.id;
  };
  return {
    graph: {
      schemaVersion: 1,
      nodes: list,
      edges: edges.map(([from, to, relationship], i) => ({
        id: uid(101 + i),
        sourceNodeId: idOf(from),
        targetNodeId: idOf(to),
        ...(relationship ? { relationship } : {}),
        metadata: {},
      })),
    },
    presentation: {
      nodePositions: Object.fromEntries(list.map((n, i) => [n.id, { x: i * 300, y: 0 }])),
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };
}

export const ordersToPostgres = () => mkDoc([['Orders', 'SERVICE'], ['PostgreSQL', 'DATABASE', 'PostgreSQL']], [['Orders', 'PostgreSQL', 'SQL']]);
