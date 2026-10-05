import { describe, expect, it } from 'vitest';
import { LIMITS, graphSchema, presentationSchema, type DiagramCommand, type GraphEdge, type GraphNode } from '@tinker/shared';
import { applyCommand, type DiagramDoc, type DomainError } from '../../src/modules/diagrams/domain/index.ts';

/** Deterministic id source: proves the engine takes ids from the outside and never generates its own. */
function sequence(start = 1) {
  let n = start;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`;
}
/** Default id source shared across calls so chained commands in one test never reuse an id. */
const autoId = sequence(5000);
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const ORDERS = uid(901);
const POSTGRES = uid(902);
const E_ORDERS_PG = uid(903);
const node = (id: string, name: string, kind: GraphNode['kind'] = 'SERVICE'): GraphNode => ({ id, name, kind, metadata: {} });
const edge = (id: string, s: string, t: string, relationship?: string, metadata: GraphEdge['metadata'] = {}): GraphEdge => ({
  id, sourceNodeId: s, targetNodeId: t, ...(relationship ? { relationship } : {}), metadata,
});

function ordersToPostgres(): DiagramDoc {
  return {
    graph: {
      schemaVersion: 1,
      nodes: [node(ORDERS, 'Orders'), node(POSTGRES, 'PostgreSQL', 'DATABASE')],
      edges: [edge(E_ORDERS_PG, ORDERS, POSTGRES, 'SQL', { protocol: 'tcp' })],
    },
    presentation: {
      nodePositions: { [ORDERS]: { x: 40, y: 40 }, [POSTGRES]: { x: 360, y: 40 } },
      viewport: { x: 5, y: 6, zoom: 1.5 },
    },
  };
}

/** Run a command against a frozen copy (any in-place mutation throws), assert the result stays a valid document. */
function run(doc: DiagramDoc, command: DiagramCommand, newId: () => string = autoId) {
  const result = applyCommand(deepFreeze(structuredClone(doc)), command, newId);
  if (result.ok) {
    expect(graphSchema.safeParse(result.value.graph).success).toBe(true);
    expect(presentationSchema.safeParse(result.value.presentation).success).toBe(true);
  }
  return result;
}
function expectOk(doc: DiagramDoc, command: DiagramCommand, newId?: () => string): DiagramDoc {
  const result = run(doc, command, newId);
  if (!result.ok) throw new Error(`expected success, got ${result.error.reason}: ${result.error.message}`);
  return result.value;
}
function expectError(doc: DiagramDoc, command: DiagramCommand): DomainError {
  const before = JSON.stringify(doc);
  const result = run(doc, command);
  if (result.ok) throw new Error('expected a domain error');
  expect(JSON.stringify(doc), 'input document must be unchanged').toBe(before);
  return result.error;
}

describe('A01 / gate: Orders -> PostgreSQL becomes Orders -> Redis -> PostgreSQL', () => {
  const command: DiagramCommand = {
    type: 'INSERT_BETWEEN',
    sourceNodeId: ORDERS,
    targetNodeId: POSTGRES,
    node: { name: 'Redis', kind: 'CACHE', technology: 'Redis' },
  };

  it('removes the original edge and adds one node and two edges in a single operation', () => {
    const out = expectOk(ordersToPostgres(), command, sequence(1));
    const redis = out.graph.nodes.find((n) => n.name === 'Redis');
    expect(redis).toMatchObject({ id: uid(1), kind: 'CACHE', technology: 'Redis' });
    expect(out.graph.nodes).toHaveLength(3);
    expect(out.graph.edges).toHaveLength(2);
    expect(out.graph.edges.some((e) => e.id === E_ORDERS_PG)).toBe(false);
    expect(out.graph.edges.map((e) => [e.sourceNodeId, e.targetNodeId])).toEqual([
      [ORDERS, uid(1)],
      [uid(1), POSTGRES],
    ]);
  });

  it('copies the original relationship and metadata onto both replacement edges (D06)', () => {
    const out = expectOk(ordersToPostgres(), command);
    for (const e of out.graph.edges) {
      expect(e.relationship).toBe('SQL');
      expect(e.metadata).toEqual({ protocol: 'tcp' });
    }
    expect(out.graph.edges[0]?.metadata).not.toBe(out.graph.edges[1]?.metadata);
  });

  it('keeps existing positions and viewport, and places only the new node (P2)', () => {
    const out = expectOk(ordersToPostgres(), command);
    expect(out.presentation.nodePositions[ORDERS]).toEqual({ x: 40, y: 40 });
    expect(out.presentation.nodePositions[POSTGRES]).toEqual({ x: 360, y: 40 });
    const redisId = out.graph.nodes.find((n) => n.name === 'Redis')?.id ?? '';
    const placed = out.presentation.nodePositions[redisId];
    expect(placed).toBeDefined();
    expect(Number.isFinite(placed?.x) && Number.isFinite(placed?.y)).toBe(true);
    expect(out.presentation.viewport).toEqual({ x: 5, y: 6, zoom: 1.5 });
  });

  it('never stacks the new node on top of an existing one, even when the gap is too small', () => {
    const out = expectOk(ordersToPostgres(), command);
    const redis = out.graph.nodes.find((n) => n.name === 'Redis')?.id ?? '';
    const at = out.presentation.nodePositions;
    for (const other of [ORDERS, POSTGRES]) {
      const clearX = Math.abs((at[redis]?.x ?? 0) - (at[other]?.x ?? 0)) >= 220;
      const clearY = Math.abs((at[redis]?.y ?? 0) - (at[other]?.y ?? 0)) >= 90;
      expect(clearX || clearY, `Redis overlaps ${other}`).toBe(true);
    }
  });

  it('is deterministic for the same input and id source', () => {
    expect(expectOk(ordersToPostgres(), command, sequence(1))).toEqual(expectOk(ordersToPostgres(), command, sequence(1)));
  });
});

describe('A02: invalid operations leave the document unchanged', () => {
  const doc = ordersToPostgres();

  it('insert with no connection between the nodes -> EDGE_REQUIRED', () => {
    const lonely: DiagramDoc = { ...doc, graph: { ...doc.graph, edges: [] } };
    expect(expectError(lonely, { type: 'INSERT_BETWEEN', sourceNodeId: ORDERS, targetNodeId: POSTGRES, node: { name: 'Redis', kind: 'CACHE' } }).reason).toBe('EDGE_REQUIRED');
  });

  it('insert in the wrong direction -> EDGE_REQUIRED', () => {
    expect(expectError(doc, { type: 'INSERT_BETWEEN', sourceNodeId: POSTGRES, targetNodeId: ORDERS, node: { name: 'Redis', kind: 'CACHE' } }).reason).toBe('EDGE_REQUIRED');
  });

  it('insert with unknown endpoints -> NODE_NOT_FOUND', () => {
    expect(expectError(doc, { type: 'INSERT_BETWEEN', sourceNodeId: uid(7), targetNodeId: POSTGRES, node: { name: 'X', kind: 'CACHE' } }).reason).toBe('NODE_NOT_FOUND');
    expect(expectError(doc, { type: 'INSERT_BETWEEN', sourceNodeId: ORDERS, targetNodeId: uid(7), node: { name: 'X', kind: 'CACHE' } }).reason).toBe('NODE_NOT_FOUND');
  });

  it('insert with an edgeId that is not between these nodes -> EDGE_NOT_FOUND', () => {
    expect(expectError(doc, { type: 'INSERT_BETWEEN', sourceNodeId: ORDERS, targetNodeId: POSTGRES, edgeId: uid(55), node: { name: 'X', kind: 'CACHE' } }).reason).toBe('EDGE_NOT_FOUND');
  });
});

describe('parallel edges', () => {
  const E2 = uid(904);
  const parallel = (): DiagramDoc => {
    const doc = ordersToPostgres();
    return { ...doc, graph: { ...doc.graph, edges: [...doc.graph.edges, edge(E2, ORDERS, POSTGRES, 'events')] } };
  };

  it('insert without edgeId is ambiguous; with edgeId only that edge is replaced', () => {
    const insert = { type: 'INSERT_BETWEEN', sourceNodeId: ORDERS, targetNodeId: POSTGRES, node: { name: 'Kafka', kind: 'QUEUE' } } as const;
    const err = expectError(parallel(), insert);
    expect(err.reason).toBe('AMBIGUOUS_EDGE');
    expect(err.details?.edgeIds).toEqual([E_ORDERS_PG, E2]);
    const out = expectOk(parallel(), { ...insert, edgeId: E2 });
    expect(out.graph.edges.some((e) => e.id === E_ORDERS_PG)).toBe(true);
    expect(out.graph.edges.some((e) => e.id === E2)).toBe(false);
    expect(out.graph.edges).toHaveLength(3);
  });

  it('disconnect by source/target is ambiguous; by edgeId removes exactly one', () => {
    expect(expectError(parallel(), { type: 'DISCONNECT', sourceNodeId: ORDERS, targetNodeId: POSTGRES }).reason).toBe('AMBIGUOUS_EDGE');
    const out = expectOk(parallel(), { type: 'DISCONNECT', edgeId: E2 });
    expect(out.graph.edges.map((e) => e.id)).toEqual([E_ORDERS_PG]);
  });
});

describe('A03: REMOVE_NODE is plain removal (P1)', () => {
  it('removes the node, incident edges and its position, with no bridging edge', () => {
    const C = uid(905);
    const doc = ordersToPostgres();
    const chain: DiagramDoc = {
      graph: { ...doc.graph, nodes: [...doc.graph.nodes, node(C, 'Redis', 'CACHE')], edges: [edge(uid(906), ORDERS, C), edge(uid(907), C, POSTGRES)] },
      presentation: { ...doc.presentation, nodePositions: { ...doc.presentation.nodePositions, [C]: { x: 200, y: 40 } } },
    };
    const out = expectOk(chain, { type: 'REMOVE_NODE', nodeId: C });
    expect(out.graph.nodes.map((n) => n.id)).toEqual([ORDERS, POSTGRES]);
    expect(out.graph.edges).toEqual([]);
    expect(Object.keys(out.presentation.nodePositions).sort()).toEqual([ORDERS, POSTGRES].sort());
  });

  it('rejects an unknown node', () => {
    expect(expectError(ordersToPostgres(), { type: 'REMOVE_NODE', nodeId: uid(7) }).reason).toBe('NODE_NOT_FOUND');
  });
});

describe('ADD_NODE', () => {
  it('adds a node with a server-assigned id, default metadata and a finite position', () => {
    const out = expectOk({ graph: { schemaVersion: 1, nodes: [], edges: [] }, presentation: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } } }, { type: 'ADD_NODE', node: { name: 'Orders', kind: 'SERVICE' } }, sequence(42));
    expect(out.graph.nodes).toEqual([{ id: uid(42), name: 'Orders', kind: 'SERVICE', metadata: {} }]);
    expect(out.presentation.nodePositions[uid(42)]).toBeDefined();
  });

  it('allows two nodes with the same name (they have distinct ids)', () => {
    const doc = ordersToPostgres();
    const out = expectOk(doc, { type: 'ADD_NODE', node: { name: 'Orders', kind: 'SERVICE' } });
    expect(out.graph.nodes.filter((n) => n.name === 'Orders')).toHaveLength(2);
  });

  it('enforces the node limit', () => {
    const nodes = Array.from({ length: LIMITS.maxNodes }, (_, i) => node(uid(1000 + i), `N${i}`));
    const full: DiagramDoc = { graph: { schemaVersion: 1, nodes, edges: [] }, presentation: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } } };
    const err = expectError(full, { type: 'ADD_NODE', node: { name: 'One too many', kind: 'GENERIC' } });
    expect(err.reason).toBe('LIMIT_EXCEEDED');
  });
});

describe('RENAME_NODE and UPDATE_NODE', () => {
  it('renames without touching technology or kind (no icon re-inference)', () => {
    const doc = ordersToPostgres();
    const withTech: DiagramDoc = { ...doc, graph: { ...doc.graph, nodes: [{ ...node(ORDERS, 'Orders'), technology: 'Node.js' }, doc.graph.nodes[1] as GraphNode] } };
    const out = expectOk(withTech, { type: 'RENAME_NODE', nodeId: ORDERS, name: 'Billing' });
    expect(out.graph.nodes[0]).toMatchObject({ name: 'Billing', kind: 'SERVICE', technology: 'Node.js' });
  });

  it('updates kind, sets/clears technology, replaces metadata', () => {
    const doc = ordersToPostgres();
    const a = expectOk(doc, { type: 'UPDATE_NODE', nodeId: ORDERS, updates: { kind: 'GATEWAY', technology: 'Envoy', metadata: { icon: 'api-gateway' } } });
    expect(a.graph.nodes[0]).toMatchObject({ kind: 'GATEWAY', technology: 'Envoy', metadata: { icon: 'api-gateway' } });
    const b = expectOk(a, { type: 'UPDATE_NODE', nodeId: ORDERS, updates: { technology: null } });
    expect(b.graph.nodes[0]).not.toHaveProperty('technology');
    expect(b.graph.nodes[0]?.metadata).toEqual({ icon: 'api-gateway' });
  });

  it('rejects unknown nodes', () => {
    expect(expectError(ordersToPostgres(), { type: 'RENAME_NODE', nodeId: uid(7), name: 'x' }).reason).toBe('NODE_NOT_FOUND');
    expect(expectError(ordersToPostgres(), { type: 'UPDATE_NODE', nodeId: uid(7), updates: { kind: 'CACHE' } }).reason).toBe('NODE_NOT_FOUND');
  });
});

describe('CONNECT / DISCONNECT', () => {
  const base = (): DiagramDoc => ({
    graph: { schemaVersion: 1, nodes: [node(ORDERS, 'Orders'), node(POSTGRES, 'PostgreSQL', 'DATABASE')], edges: [] },
    presentation: { nodePositions: { [ORDERS]: { x: 0, y: 0 }, [POSTGRES]: { x: 300, y: 0 } }, viewport: { x: 0, y: 0, zoom: 1 } },
  });

  it('connects existing nodes and records relationship/metadata', () => {
    const out = expectOk(base(), { type: 'CONNECT', sourceNodeId: ORDERS, targetNodeId: POSTGRES, relationship: 'SQL', metadata: { bidirectional: true } }, sequence(77));
    expect(out.graph.edges).toEqual([{ id: uid(77), sourceNodeId: ORDERS, targetNodeId: POSTGRES, relationship: 'SQL', metadata: { bidirectional: true } }]);
  });

  it('rejects unknown endpoints, self-loops and duplicates; allows a different relationship or the reverse direction', () => {
    expect(expectError(base(), { type: 'CONNECT', sourceNodeId: uid(7), targetNodeId: POSTGRES }).reason).toBe('NODE_NOT_FOUND');
    expect(expectError(base(), { type: 'CONNECT', sourceNodeId: ORDERS, targetNodeId: uid(7) }).reason).toBe('NODE_NOT_FOUND');
    expect(expectError(base(), { type: 'CONNECT', sourceNodeId: ORDERS, targetNodeId: ORDERS }).reason).toBe('SELF_LOOP_UNSUPPORTED');
    const once = expectOk(base(), { type: 'CONNECT', sourceNodeId: ORDERS, targetNodeId: POSTGRES, relationship: 'SQL' });
    expect(expectError(once, { type: 'CONNECT', sourceNodeId: ORDERS, targetNodeId: POSTGRES, relationship: 'SQL' }).reason).toBe('DUPLICATE_EDGE');
    expect(expectOk(once, { type: 'CONNECT', sourceNodeId: ORDERS, targetNodeId: POSTGRES, relationship: 'events' }).graph.edges).toHaveLength(2);
    expect(expectOk(once, { type: 'CONNECT', sourceNodeId: POSTGRES, targetNodeId: ORDERS, relationship: 'SQL' }).graph.edges).toHaveLength(2);
  });

  it('enforces the edge limit', () => {
    const nodes = Array.from({ length: 60 }, (_, i) => node(uid(2000 + i), `N${i}`));
    const edges: GraphEdge[] = [];
    for (let s = 0; s < 60 && edges.length < LIMITS.maxEdges; s++) {
      for (let t = 0; t < 60 && edges.length < LIMITS.maxEdges; t++) {
        if (s !== t) edges.push(edge(uid(10000 + edges.length), uid(2000 + s), uid(2000 + t)));
      }
    }
    const full: DiagramDoc = { graph: { schemaVersion: 1, nodes, edges }, presentation: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } } };
    expect(edges).toHaveLength(LIMITS.maxEdges);
    expect(expectError(full, { type: 'CONNECT', sourceNodeId: uid(2000), targetNodeId: uid(2001), relationship: 'new' }).reason).toBe('LIMIT_EXCEEDED');
  });

  it('disconnects one directed edge only (the reverse edge stays)', () => {
    let doc = expectOk(base(), { type: 'CONNECT', sourceNodeId: ORDERS, targetNodeId: POSTGRES });
    doc = expectOk(doc, { type: 'CONNECT', sourceNodeId: POSTGRES, targetNodeId: ORDERS });
    const out = expectOk(doc, { type: 'DISCONNECT', sourceNodeId: ORDERS, targetNodeId: POSTGRES });
    expect(out.graph.edges.map((e) => [e.sourceNodeId, e.targetNodeId])).toEqual([[POSTGRES, ORDERS]]);
  });

  it('disconnect rejects unknown edges and unknown nodes', () => {
    expect(expectError(base(), { type: 'DISCONNECT', edgeId: uid(7) }).reason).toBe('EDGE_NOT_FOUND');
    expect(expectError(base(), { type: 'DISCONNECT', sourceNodeId: ORDERS, targetNodeId: POSTGRES }).reason).toBe('EDGE_NOT_FOUND');
    expect(expectError(base(), { type: 'DISCONNECT', sourceNodeId: uid(7), targetNodeId: POSTGRES }).reason).toBe('NODE_NOT_FOUND');
  });
});

describe('placement of new nodes', () => {
  it('adding many nodes never produces overlaps and never moves existing nodes', () => {
    let doc = ordersToPostgres();
    const original = structuredClone(doc.presentation.nodePositions);
    for (let i = 0; i < 12; i++) doc = expectOk(doc, { type: 'ADD_NODE', node: { name: `Extra ${i}`, kind: 'GENERIC' } });
    for (const [id, p] of Object.entries(original)) expect(doc.presentation.nodePositions[id]).toEqual(p);
    const spots = Object.values(doc.presentation.nodePositions);
    expect(spots).toHaveLength(14);
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const a = spots[i]!, b = spots[j]!;
        expect(Math.abs(a.x - b.x) >= 220 || Math.abs(a.y - b.y) >= 90, `nodes ${i} and ${j} overlap`).toBe(true);
      }
    }
  });
});

describe('inserting between vertically stacked nodes', () => {
  it('places the new node beside them near the midpoint instead of far below', () => {
    const doc = ordersToPostgres();
    const stacked: DiagramDoc = { ...doc, presentation: { ...doc.presentation, nodePositions: { [ORDERS]: { x: 40, y: 40 }, [POSTGRES]: { x: 40, y: 190 } } } };
    const out = expectOk(stacked, { type: 'INSERT_BETWEEN', sourceNodeId: ORDERS, targetNodeId: POSTGRES, node: { name: 'Redis', kind: 'CACHE' } });
    const redis = out.graph.nodes.find((n) => n.name === 'Redis')?.id ?? '';
    const at = out.presentation.nodePositions[redis]!;
    expect(Math.abs(at.y - 115)).toBeLessThanOrEqual(130); // within one row of the midpoint
    expect(Math.abs(at.x - 40) >= 220 || Math.abs(at.y - 40) >= 90).toBe(true);
    expect(Math.abs(at.x - 40) >= 220 || Math.abs(at.y - 190) >= 90).toBe(true);
  });
});

describe('RESET', () => {
  it('clears nodes, edges and positions but keeps the viewport', () => {
    const out = expectOk(ordersToPostgres(), { type: 'RESET' });
    expect(out.graph).toEqual({ schemaVersion: 1, nodes: [], edges: [] });
    expect(out.presentation).toEqual({ nodePositions: {}, viewport: { x: 5, y: 6, zoom: 1.5 } });
  });
});

describe('purity', () => {
  it('never mutates its input (deep-frozen) for any command, including failures', () => {
    const doc = deepFreeze(ordersToPostgres());
    const commands: DiagramCommand[] = [
      { type: 'ADD_NODE', node: { name: 'A', kind: 'GENERIC' } },
      { type: 'REMOVE_NODE', nodeId: ORDERS },
      { type: 'RENAME_NODE', nodeId: ORDERS, name: 'B' },
      { type: 'UPDATE_NODE', nodeId: ORDERS, updates: { kind: 'CACHE' } },
      { type: 'CONNECT', sourceNodeId: POSTGRES, targetNodeId: ORDERS },
      { type: 'DISCONNECT', edgeId: E_ORDERS_PG },
      { type: 'INSERT_BETWEEN', sourceNodeId: ORDERS, targetNodeId: POSTGRES, node: { name: 'R', kind: 'CACHE' } },
      { type: 'RESET' },
      { type: 'REMOVE_NODE', nodeId: uid(7) },
    ];
    for (const command of commands) expect(() => applyCommand(doc, command, sequence())).not.toThrow();
  });
});
