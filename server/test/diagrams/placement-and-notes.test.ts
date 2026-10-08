import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIMITS } from '@tinker/shared';
import { settleNewNodes, NODE_HEIGHT, NODE_WIDTH } from '../../src/modules/diagrams/domain/layout.ts';
import { aiCmd, call, cmd, createDiagramFor, key, startHarness, type Harness, type TestUser } from '../support/harness.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const edge = (n: number, a: number, b: number) => ({ id: id(100 + n), sourceNodeId: id(a), targetNodeId: id(b), metadata: {} });
const node = (n: number) => ({ id: id(n), name: `N${n}`, kind: 'SERVICE' as const, metadata: {} });

describe('settleNewNodes: components added in one plan land next to what they connect to', () => {
  it('goes right of what feeds it, left of what it feeds, and between when both exist', () => {
    const graph = { nodes: [node(1), node(2), node(3), node(4)], edges: [edge(1, 1, 3), edge(2, 3, 2), edge(3, 1, 4)] };
    const placed = settleNewNodes(graph, { [id(1)]: { x: 0, y: 0 }, [id(2)]: { x: 800, y: 0 }, [id(3)]: { x: 5000, y: 5000 }, [id(4)]: { x: -9000, y: 9000 } }, [id(3), id(4)]);
    expect(placed[id(3)]!.x).toBeGreaterThan(0);
    expect(placed[id(3)]!.x).toBeLessThan(800); // between 1 and 2
    expect(Math.abs(placed[id(3)]!.y)).toBeLessThan(NODE_HEIGHT * 3);
    expect(placed[id(4)]!.x).toBeGreaterThanOrEqual(NODE_WIDTH); // right of its source, not at (-9000, 9000)
    expect(placed[id(1)]).toEqual({ x: 0, y: 0 }); // existing components never move
    expect(placed[id(2)]).toEqual({ x: 800, y: 0 });
  });

  it('a chain added at once lays out as a chain, left to right', () => {
    const graph = { nodes: [node(1), node(2), node(3)], edges: [edge(1, 1, 2), edge(2, 2, 3)] };
    const placed = settleNewNodes(graph, { [id(1)]: { x: 0, y: 0 }, [id(2)]: { x: 9000, y: 9000 }, [id(3)]: { x: 9000, y: -9000 } }, [id(2), id(3)]);
    expect(placed[id(2)]!.x).toBeGreaterThan(placed[id(1)]!.x);
    expect(placed[id(3)]!.x).toBeGreaterThan(placed[id(2)]!.x);
    expect(Math.abs(placed[id(3)]!.y - placed[id(1)]!.y)).toBeLessThan(NODE_HEIGHT * 2);
  });

  it('top-to-bottom diagrams grow downwards; two new components never overlap', () => {
    const graph = { nodes: [node(1), node(2), node(3)], edges: [edge(1, 1, 2), edge(2, 1, 3)] };
    const placed = settleNewNodes(graph, { [id(1)]: { x: 0, y: 0 }, [id(2)]: { x: 7000, y: 7000 }, [id(3)]: { x: 7000, y: 7500 } }, [id(2), id(3)], 'TB');
    expect(placed[id(2)]!.y).toBeGreaterThan(0);
    expect(placed[id(3)]!.y).toBeGreaterThan(0);
    const dx = Math.abs(placed[id(2)]!.x - placed[id(3)]!.x);
    const dy = Math.abs(placed[id(2)]!.y - placed[id(3)]!.y);
    expect(dx >= NODE_WIDTH || dy >= NODE_HEIGHT).toBe(true);
  });

  it('a component with no connections keeps its position, and an empty list changes nothing', () => {
    const graph = { nodes: [node(1), node(2)], edges: [] };
    const positions = { [id(1)]: { x: 0, y: 0 }, [id(2)]: { x: 40, y: 400 } };
    expect(settleNewNodes(graph, positions, [id(2)])).toEqual(positions);
    expect(settleNewNodes(graph, positions, [])).toEqual(positions);
  });
});

describe('through the API', () => {
  let h: Harness;
  let u: TestUser;
  beforeAll(async () => {
    h = await startHarness({ env: { AI_RATE_LIMIT_PER_MINUTE: '1000' } });
    u = await h.newUser('placer');
  });
  afterAll(() => h.close());

  const patch = (diagramId: string, expectedVersion: number, body: Record<string, unknown>) =>
    call(h, u, 'PATCH', `/v1/diagrams/${diagramId}/presentation`, { expectedVersion, ...body }, { 'idempotency-key': key() });

  it('"put a cache between Orders and the database" with Yes lands the new components beside Orders, not far away', async () => {
    const { diagram } = await createDiagramFor(h, u, 'Placement');
    const added = await aiCmd(h, u, diagram.diagramId, diagram.version, 'add Orders');
    const asked = await aiCmd(h, u, diagram.diagramId, added.body.diagram.version, 'put a cache between Orders and the database');
    const yes = await aiCmd(h, u, diagram.diagramId, added.body.diagram.version, 'yes', { conversationId: asked.body.conversationId });
    expect(yes.body.status).toBe('APPLIED');
    const after = (await call(h, u, 'GET', `/v1/diagrams/${diagram.diagramId}`)).body;
    const pos = (name: string) => after.presentation.nodePositions[after.graph.nodes.find((n: { name: string }) => n.name === name).id] as { x: number; y: number };
    const orders = pos('Orders');
    const cache = pos('Cache');
    const database = pos('Database');
    expect(cache.x).toBeGreaterThan(orders.x);
    expect(database.x).toBeGreaterThan(cache.x);
    expect(Math.hypot(cache.x - orders.x, cache.y - orders.y)).toBeLessThan(500);
    expect(Math.hypot(database.x - cache.x, database.y - cache.y)).toBeLessThan(500);
  });

  it('a plain "add X" with no connection goes under the diagram, not to a far corner', async () => {
    const { diagram } = await createDiagramFor(h, u, 'Stacking');
    let version = diagram.version as number;
    for (const name of ['Orders', 'Billing']) version = (await aiCmd(h, u, diagram.diagramId, version, `add ${name}`)).body.diagram.version;
    const g = (await call(h, u, 'GET', `/v1/diagrams/${diagram.diagramId}`)).body;
    const positions = Object.values(g.presentation.nodePositions) as Array<{ x: number; y: number }>;
    expect(positions).toHaveLength(2);
    expect(Math.abs(positions[0]!.x - positions[1]!.x)).toBeLessThan(NODE_WIDTH + 100);
  });

  it('notes and remembered layouts are saved, restored on reload, and pruned when a component goes', async () => {
    const { diagram } = await createDiagramFor(h, u, 'Notes');
    const a = await cmd(diagram.diagramId, u, h, diagram.version, { type: 'ADD_NODE', node: { name: 'Orders', kind: 'SERVICE' } });
    const b = await cmd(diagram.diagramId, u, h, a.body.version, { type: 'ADD_NODE', node: { name: 'Billing', kind: 'SERVICE' } });
    const [n1, n2] = (b.body.graph.nodes as Array<{ id: string }>).map((n) => n.id);
    const note = { id: crypto.randomUUID(), x: 10, y: 20, text: 'Remember to ask about SLAs', width: 240 };
    const saved = await patch(diagram.diagramId, b.body.version, { notes: [note], layoutDir: 'TB', layouts: { LR: { [n1!]: { x: 1, y: 2 }, [n2!]: { x: 3, y: 4 }, [crypto.randomUUID()]: { x: 9, y: 9 } } } });
    expect(saved.status).toBe(200);
    expect(saved.body.presentation.notes).toEqual([note]);
    expect(saved.body.presentation.layoutDir).toBe('TB');
    expect(Object.keys(saved.body.presentation.layouts.LR)).toHaveLength(2); // the unknown component was dropped

    const reloaded = (await call(h, u, 'GET', `/v1/diagrams/${diagram.diagramId}`)).body;
    expect(reloaded.presentation.notes).toEqual([note]);

    const removed = await cmd(diagram.diagramId, u, h, saved.body.version, { type: 'REMOVE_NODE', nodeId: n1 });
    expect(Object.keys(removed.body.presentation.layouts.LR)).toEqual([n2]);
    expect(removed.body.presentation.notes).toEqual([note]); // notes are not components: they stay
  });

  it('too many or too long notes, and an empty patch, are refused', async () => {
    const { diagram } = await createDiagramFor(h, u, 'Limits');
    const mk = (n: number) => Array.from({ length: n }, () => ({ id: crypto.randomUUID(), x: 0, y: 0, text: 'x' }));
    expect((await patch(diagram.diagramId, diagram.version, { notes: mk(LIMITS.maxNotes + 1) })).status).toBe(400);
    expect((await patch(diagram.diagramId, diagram.version, { notes: [{ ...mk(1)[0], text: 'y'.repeat(LIMITS.maxNoteChars + 1) }] })).status).toBe(400);
    expect((await patch(diagram.diagramId, diagram.version, {})).status).toBe(400);
    const ok = await patch(diagram.diagramId, diagram.version, { notes: mk(LIMITS.maxNotes) });
    expect(ok.status).toBe(200);
  });
});
