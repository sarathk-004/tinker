import { describe, expect, it } from 'vitest';
import { downstreamNodeIds } from '../../src/modules/diagrams/domain/index.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nodes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: id(i + 1) }));
const edges = (pairs: [number, number][]) =>
  pairs.map(([s, t], i) => ({ id: id(100 + i), sourceNodeId: id(s), targetNodeId: id(t) }));

describe('downstreamNodeIds', () => {
  it('walks forward breadth-first and excludes the start', () => {
    const graph = { nodes: nodes(5), edges: edges([[1, 2], [1, 3], [2, 4], [3, 4], [4, 5]]) };
    expect(downstreamNodeIds(graph, id(1))).toEqual([id(2), id(3), id(4), id(5)]);
    expect(downstreamNodeIds(graph, id(4))).toEqual([id(5)]);
    expect(downstreamNodeIds(graph, id(5))).toEqual([]);
  });

  it('A04: terminates on cycles and lists each affected node once', () => {
    const graph = { nodes: nodes(3), edges: edges([[1, 2], [2, 3], [3, 1], [3, 2]]) };
    expect(downstreamNodeIds(graph, id(1))).toEqual([id(2), id(3)]);
    expect(downstreamNodeIds(graph, id(2))).toEqual([id(3), id(1)]);
  });

  it('does not report the start node even when a cycle returns to it', () => {
    const graph = { nodes: nodes(2), edges: edges([[1, 2], [2, 1]]) };
    expect(downstreamNodeIds(graph, id(1))).toEqual([id(2)]);
  });

  it('returns nothing for an unknown start node and ignores upstream nodes', () => {
    const graph = { nodes: nodes(3), edges: edges([[1, 2], [2, 3]]) };
    expect(downstreamNodeIds(graph, id(99))).toEqual([]);
    expect(downstreamNodeIds(graph, id(3))).toEqual([]);
  });
});
