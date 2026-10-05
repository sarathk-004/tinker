import { describe, expect, it } from 'vitest';
import { diagramCommandSchema, graphSchema, type Graph, type GraphNode, type Presentation } from '../contracts';
import { addNodeCommand, groupCommand, insertBetweenCommand, nodeEditCommands, toNodeData, toViewEdges, toViewNodes, typeToKind } from './adapters';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const node = (id: number, name: string, kind: GraphNode['kind'] = 'SERVICE', extra: Partial<GraphNode> = {}): GraphNode => ({ id: U(id), name, kind, metadata: {}, ...extra });
const graph = (nodes: GraphNode[], edges: Graph['edges'] = []): Graph => ({ schemaVersion: 1, nodes, edges });
const edge = (id: number, s: number, t: number, extra: Partial<Graph['edges'][number]> = {}) => ({ id: U(id), sourceNodeId: U(s), targetNodeId: U(t), metadata: {}, ...extra });
const presentation = (positions: Presentation['nodePositions'] = {}): Presentation => ({ nodePositions: positions, viewport: { x: 0, y: 0, zoom: 1 } });
const ctx = { layoutDir: 'LR' as const, highlightedIds: [] as string[] };

describe('canonical -> canvas', () => {
  it('maps a node to what the card shows: name, kind, technology, icon from metadata, description and group', () => {
    const data = toNodeData(node(1, 'Orders', 'SERVICE', { technology: 'Node.js', metadata: { icon: 'lambda', description: 'Handles orders', group: 'Backend' } }));
    expect(data).toMatchObject({ id: U(1), label: 'Orders', type: 'service', awsIcon: 'lambda', subType: 'Node.js', description: 'Handles orders', group: 'Backend' });
  });

  it('falls back to an inferred icon when metadata has none or an unknown one', () => {
    expect(toNodeData(node(1, 'Redis cache', 'CACHE')).awsIcon).toBe('redis');
    expect(toNodeData(node(2, 'PostgreSQL', 'DATABASE', { metadata: { icon: 'not-an-icon' } })).awsIcon).toBe('rds');
    expect(toNodeData(node(3, 'Mystery', 'GENERIC')).awsIcon).toBe('generic');
  });

  it('positions come from the presentation; highlight and dim flags are derived, and ids stay canonical', () => {
    const g = graph([node(1, 'A'), node(2, 'B')]);
    const nodes = toViewNodes(g, presentation({ [U(1)]: { x: 10, y: 20 }, [U(2)]: { x: 30, y: 40 } }), { ...ctx, highlightedIds: [U(1)] });
    expect(nodes.map((n) => n.id)).toEqual([U(1), U(2)]);
    expect(nodes[0]!.position).toEqual({ x: 10, y: 20 });
    expect(nodes[0]!.data).toMatchObject({ isHighlighted: true, isDimmed: false });
    expect(nodes[1]!.data).toMatchObject({ isHighlighted: false, isDimmed: true });
    expect(nodes.every((n) => n.selected === undefined)).toBe(true); // selection is owned by React Flow
  });

  it('handles face the layout direction', () => {
    const g = graph([node(1, 'A')]);
    const lr = toViewNodes(g, presentation(), ctx)[0]!;
    const tb = toViewNodes(g, presentation(), { ...ctx, layoutDir: 'TB' })[0]!;
    expect([lr.sourcePosition, lr.targetPosition]).toEqual(['right', 'left']);
    expect([tb.sourcePosition, tb.targetPosition]).toEqual(['bottom', 'top']);
  });

  it('edges keep their canonical ids, show the relationship, mark bidirectional via metadata, and use distinct curves when crowded', () => {
    const g = graph([node(1, 'A'), node(2, 'B')], [edge(10, 1, 2, { relationship: 'HTTP' }), edge(11, 2, 1, { metadata: { bidirectional: true } })]);
    const edges = toViewEdges(g, []);
    expect(edges.map((e) => e.id)).toEqual([U(10), U(11)]);
    expect(edges[0]).toMatchObject({ source: U(1), target: U(2), label: 'HTTP', type: 'default' });
    expect(edges[1]).toHaveProperty('markerStart');
    expect(edges[0]).not.toHaveProperty('markerStart');
  });
});

describe('UI intent -> commands (every output is a valid contract command)', () => {
  const valid = (c: unknown) => expect(diagramCommandSchema.safeParse(c).success, JSON.stringify(c)).toBe(true);

  it('add node carries kind, technology and the chosen icon in metadata; the server assigns the id', () => {
    const c = addNodeCommand({ label: 'EC2 Microservice', type: 'service', awsIcon: 'ec2', subType: 'Amazon EC2' });
    valid(c);
    expect(c.node).toEqual({ name: 'EC2 Microservice', kind: 'SERVICE', technology: 'Amazon EC2', metadata: { icon: 'ec2' } });
    expect(JSON.stringify(c)).not.toContain('"id"');
  });

  it('infers type/icon/technology when only a name is given, and trims overlong values to the contract limits', () => {
    const c = addNodeCommand({ label: 'Redis between them' });
    valid(c);
    expect(c.node).toMatchObject({ name: 'Redis', kind: 'CACHE', metadata: { icon: 'redis' } });
    valid(addNodeCommand({ label: 'x'.repeat(500), subType: 'y'.repeat(500), description: 'z'.repeat(2000) }));
  });

  it('insert between maps to INSERT_BETWEEN and can name the edge', () => {
    const c = insertBetweenCommand(U(1), U(2), { label: 'Redis', type: 'cache', awsIcon: 'redis' }, U(9));
    valid(c);
    expect(c).toMatchObject({ type: 'INSERT_BETWEEN', sourceNodeId: U(1), targetNodeId: U(2), edgeId: U(9) });
  });

  it('editing sends only what changed: rename and update are separate commands, nothing for a no-op', () => {
    const original = node(1, 'Orders', 'SERVICE', { technology: 'Node.js', metadata: { icon: 'ec2' } });
    expect(nodeEditCommands(original, { label: 'Orders', subType: 'Node.js', awsIcon: 'ec2', type: 'service' })).toEqual([]);

    const renamed = nodeEditCommands(original, { label: 'Billing', subType: 'Node.js', awsIcon: 'ec2', type: 'service' });
    expect(renamed).toEqual([{ type: 'RENAME_NODE', nodeId: U(1), name: 'Billing' }]);

    const all = nodeEditCommands(original, { label: 'Billing', subType: '', awsIcon: 'lambda', type: 'database', description: 'Charges cards' });
    all.forEach(valid);
    expect(all.map((c) => c.type)).toEqual(['RENAME_NODE', 'UPDATE_NODE']);
    const update = all[1] as Extract<(typeof all)[number], { type: 'UPDATE_NODE' }>;
    expect(update.updates).toMatchObject({ kind: 'DATABASE', technology: null, metadata: { icon: 'lambda', description: 'Charges cards' } });
  });

  it('grouping keeps existing metadata and adds the group', () => {
    const c = groupCommand(node(1, 'A', 'SERVICE', { metadata: { icon: 'ec2' } }), 'Backend');
    valid(c);
    expect(c.updates.metadata).toEqual({ icon: 'ec2', group: 'Backend' });
  });

  it('every legacy type maps to a NodeKind and back to the same type', () => {
    for (const t of ['client', 'gateway', 'service', 'database', 'cache', 'queue', 'storage', 'external', 'generic'] as const) {
      expect(typeToKind(t).toLowerCase()).toBe(t);
    }
  });

  it('a document built only from these mappings still satisfies the contract (round trip)', () => {
    const g = graph([node(1, 'Orders', 'SERVICE', { technology: 'Node.js', metadata: { icon: 'ec2' } }), node(2, 'DB', 'DATABASE')], [edge(10, 1, 2)]);
    expect(graphSchema.safeParse(g).success).toBe(true);
    expect(toViewNodes(g, presentation({ [U(1)]: { x: 0, y: 0 }, [U(2)]: { x: 1, y: 1 } }), ctx)).toHaveLength(2);
  });
});
