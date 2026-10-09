import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiCommandResponseSchema } from '@tinker/shared';
import { createFakeProvider } from '../../src/modules/ai/providers/fake.ts';
import { ProviderError } from '../../src/modules/ai/providers/types.ts';
import { aiCmd, cmd, createDiagramFor, startHarness, type Harness } from '../support/harness.ts';
import { applyCommand } from '../../src/modules/diagrams/domain/index.ts';
import { executePlan, buildAliases } from '../../src/modules/ai/domain/plan.ts';
import { roleOf, suggestWiring } from '../../src/modules/ai/domain/wiring.ts';
import { parseCommand } from '../../src/modules/ai/application/parser.ts';
import { mkDoc } from './helpers.ts';

const names = (doc: ReturnType<typeof mkDoc>) => new Map(doc.graph.nodes.map((n) => [n.id, n.name]));
const pairs = (doc: ReturnType<typeof mkDoc>) => {
  const n = names(doc);
  return suggestWiring(doc).edges.map((e) => `${n.get(e.source)} > ${n.get(e.target)}`);
};

const SHOP = () =>
  mkDoc([
    ['Web App', 'CLIENT'],
    ['CloudFront CDN', 'GATEWAY'],
    ['API Gateway', 'GATEWAY'],
    ['Orders Service', 'SERVICE'],
    ['Billing Service', 'SERVICE'],
    ['Orders DB', 'DATABASE', 'PostgreSQL'],
    ['Redis', 'CACHE'],
    ['Order Events', 'QUEUE'],
    ['Email Worker', 'SERVICE'],
    ['Assets', 'STORAGE', 'Amazon S3'],
    ['Stripe', 'EXTERNAL'],
    ['CloudWatch', 'SERVICE'],
  ]);

describe('what part each component plays', () => {
  it('reads kinds and names', () => {
    const roles = Object.fromEntries(SHOP().graph.nodes.map((n) => [n.name, roleOf(n)]));
    expect(roles).toMatchObject({ 'Web App': 'client', 'CloudFront CDN': 'edge', 'API Gateway': 'entry', 'Orders Service': 'service', 'Orders DB': 'database', Redis: 'cache', 'Order Events': 'queue', 'Email Worker': 'worker', Assets: 'storage', Stripe: 'external', CloudWatch: 'monitor' });
  });
});

describe('wiring unconnected components the way a system is usually built', () => {
  it('lays out a whole shop: clients, edge, gateway, services, data, queue and worker, third party and monitoring', () => {
    const got = pairs(SHOP());
    expect(got).toEqual(
      expect.arrayContaining([
        'Web App > CloudFront CDN',
        'CloudFront CDN > API Gateway',
        'API Gateway > Orders Service',
        'API Gateway > Billing Service',
        'Orders Service > Orders DB',
        'Orders Service > Redis',
        'Orders Service > Order Events',
        'Order Events > Email Worker',
        'Orders Service > Assets',
        'Billing Service > Stripe', // a payment provider goes with billing, though the names share no word
        'Orders Service > CloudWatch',
      ]),
    );
    // every component ends up connected
    expect(suggestWiring(SHOP()).unplaced).toEqual([]);
  });

  it('only ever adds: connections that already exist are left alone, in either direction', () => {
    const doc = mkDoc([['Web App', 'CLIENT'], ['API Gateway', 'GATEWAY'], ['Orders', 'SERVICE']], [['API Gateway', 'Web App'], ['API Gateway', 'Orders']]);
    expect(pairs(doc)).toEqual([]);
    expect(suggestWiring(doc).unplaced).toEqual([]);
  });

  it('matches a database to the service it is named after, and says when it had to guess', () => {
    const named = mkDoc([['Orders Service'], ['Billing Service'], ['Orders DB', 'DATABASE'], ['Billing DB', 'DATABASE']]);
    expect(pairs(named)).toEqual(expect.arrayContaining(['Orders Service > Orders DB', 'Billing Service > Billing DB']));
    expect(pairs(named)).not.toContain('Orders Service > Billing DB');
    expect(suggestWiring(named).guessed).toEqual([]);

    const unnamed = mkDoc([['Orders Service'], ['Billing Service'], ['Users Store', 'DATABASE'], ['Ledger Store', 'DATABASE']]);
    expect(suggestWiring(unnamed).guessed.length).toBeGreaterThan(0);
  });

  it('puts a queue between a publisher and a consumer even without a worker', () => {
    const doc = mkDoc([['Orders'], ['Shipping'], ['Events', 'QUEUE']]);
    expect(pairs(doc)).toEqual(expect.arrayContaining(['Orders > Events', 'Events > Shipping']));
  });

  it('leaves what it cannot place alone and says so', () => {
    const doc = mkDoc([['Orders'], ['Mystery Box', 'GENERIC']]);
    const r = suggestWiring(doc);
    expect(r.unplaced).toEqual(['Orders', 'Mystery Box']); // a lone service and a box of unknown purpose: nothing to join them to
  });

  it('is deterministic', () => {
    expect(pairs(SHOP())).toEqual(pairs(SHOP()));
  });
});

describe('asking for it in words', () => {
  const doc = SHOP();
  const phrasings = [
    'connect the components logically',
    'connect all the components',
    'Please wire everything up',
    'can you connect them logically?',
    'link all the nodes together properly',
    'map the components logically',
    'auto connect everything',
    'connect everything together',
    'hook up all my services',
  ];
  it.each(phrasings)('"%s" wires the diagram', (text) => {
    const r = parseCommand(doc, text);
    expect(r.kind, text).toBe('steps');
    if (r.kind === 'steps') {
      expect(r.steps.length).toBeGreaterThan(8); // more than a model plan may hold: this one is deterministic
      expect(r.steps.every((s) => s.type === 'CONNECT' && s.relationship), text).toBe(true);
      expect(r.note).toContain('usual layout');
    }
  });

  it('the plan really applies, and applying it connects every component', () => {
    const r = parseCommand(doc, 'connect the components logically');
    if (r.kind !== 'steps') throw new Error('expected steps');
    const planned = executePlan(doc, r.steps, buildAliases(doc), (() => { let n = 5000; return () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`; })());
    expect(planned.ok).toBe(true);
    if (planned.ok) {
      const touched = new Set(planned.doc.graph.edges.flatMap((e) => [e.sourceNodeId, e.targetNodeId]));
      expect(planned.doc.graph.nodes.every((n) => touched.has(n.id))).toBe(true);
      expect(planned.doc.graph.edges.every((e) => (e.relationship ?? '').length > 0)).toBe(true);
    }
    void applyCommand;
  });

  it('does not take over requests that name a pair, and asks when there is nothing to do', () => {
    expect(parseCommand(mkDoc([['Orders'], ['Billing']]), 'connect Orders to Billing')).toMatchObject({ kind: 'steps', steps: [{ type: 'CONNECT', source: 'n1', target: 'n2' }] });
    expect(parseCommand(mkDoc([['Orders']]), 'connect everything').kind).toBe('clarify');
    const done = mkDoc([['Web App', 'CLIENT'], ['API Gateway', 'GATEWAY']], [['Web App', 'API Gateway']]);
    const r = parseCommand(done, 'connect everything');
    expect(r).toMatchObject({ kind: 'clarify' });
  });
});

describe('through the API: components added by hand, no connections, then "connect them logically"', () => {
  let h: Harness;
  const provider = createFakeProvider([{ error: new ProviderError('unavailable', 'the model must not be needed') }]);
  beforeAll(async () => {
    h = await startHarness({ aiProvider: provider });
  });
  afterAll(() => h.close());

  it('wires the whole diagram in one undoable step, with no model call, and says how', async () => {
    const u = await h.newUser('wirer');
    const { diagram } = await createDiagramFor(h, u, 'Unwired');
    const id = diagram.diagramId;
    let version = 1;
    for (const [name, kind, technology] of [['Web App', 'CLIENT'], ['API Gateway', 'GATEWAY'], ['Orders Service', 'SERVICE'], ['Billing Service', 'SERVICE'], ['Main DB', 'DATABASE', 'PostgreSQL'], ['Redis', 'CACHE'], ['Job Queue', 'QUEUE'], ['Email Worker', 'SERVICE']] as const) {
      version = (await cmd(id, u, h, version, { type: 'ADD_NODE', node: { name, kind, ...(technology ? { technology } : {}) } })).body.version;
    }
    const res = await aiCmd(h, u, id, version, 'Connect the components logically');
    expect(res.status).toBe(200);
    expect(aiCommandResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({ status: 'APPLIED', source: 'PARSER' });
    expect(res.body.interpretation.commands.length).toBeGreaterThan(8);
    expect(provider.calls).toHaveLength(0);

    const { nodes, edges } = res.body.diagram.graph as { nodes: Array<{ id: string; name: string }>; edges: Array<{ sourceNodeId: string; targetNodeId: string; relationship?: string }> };
    const touched = new Set(edges.flatMap((e) => [e.sourceNodeId, e.targetNodeId]));
    expect(nodes.every((n) => touched.has(n.id))).toBe(true); // nothing left floating
    expect(edges.every((e) => !!e.relationship)).toBe(true); // each arrow says what it is
    expect(JSON.stringify(res.body.messages.at(-1))).toContain('usual layout');

    const again = await aiCmd(h, u, id, res.body.diagram.version, 'connect everything');
    expect(again.body).toMatchObject({ status: 'CLARIFICATION' }); // already done: it says so instead of doing it twice
  });
});
