import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCommand, type ParseResult } from '../../src/modules/ai/application/parser.ts';
import { classifyReply, readProposal } from '../../src/modules/ai/application/confirm.ts';
import { createFakeProvider } from '../../src/modules/ai/providers/fake.ts';
import { aiCmd, call, cmd, createDiagramFor, startHarness, type Harness, type TestUser } from '../support/harness.ts';
import { mkDoc, ordersToPostgres } from './helpers.ts';

const kindOf = (r: ParseResult) => r.kind;
const steps = (r: ParseResult) => {
  if (r.kind !== 'steps') throw new Error(`expected steps, got ${JSON.stringify(r)}`);
  return r.steps;
};
const propose = (r: ParseResult) => {
  if (r.kind !== 'propose') throw new Error(`expected a proposal, got ${JSON.stringify(r)}`);
  return r;
};

describe('parser: a word for a KIND of component means the component of that kind', () => {
  const doc = mkDoc([['Web Client', 'CLIENT'], ['Orders', 'SERVICE'], ['PostgreSQL', 'DATABASE', 'PostgreSQL']], [['Web Client', 'Orders'], ['Orders', 'PostgreSQL']]);

  it('"the database" / "the db" / "database" resolve to the one database, whatever it is named', () => {
    for (const text of ['put a cache between Orders and the database', 'put a cache between Orders and the db', 'put a cache between orders and database']) {
      expect(steps(parseCommand(doc, text))).toEqual([{ type: 'INSERT_BETWEEN', name: 'Cache', source: 'n2', target: 'n3', edge: 'e2' }]);
    }
    expect(steps(parseCommand(doc, 'connect Web Client to the database'))).toEqual([{ type: 'CONNECT', source: 'n1', target: 'n3' }]);
    expect(steps(parseCommand(doc, 'remove the database'))).toEqual([{ type: 'REMOVE_NODE', ref: 'n3' }]);
    expect(steps(parseCommand(doc, 'rename the database to Primary'))).toEqual([{ type: 'RENAME_NODE', ref: 'n3', name: 'Primary' }]);
    expect(steps(parseCommand(doc, 'disconnect orders from the database'))).toEqual([{ type: 'DISCONNECT', edge: 'e2' }]);
  });

  it('a qualified name ("the postgres database") finds PostgreSQL', () => {
    expect(steps(parseCommand(doc, 'delete the postgres database'))).toEqual([{ type: 'REMOVE_NODE', ref: 'n3' }]);
  });

  it('an exact name always wins over a kind word', () => {
    const named = mkDoc([['Orders', 'SERVICE'], ['Cache', 'SERVICE'], ['Redis', 'CACHE']]);
    expect(steps(parseCommand(named, 'remove the cache'))).toEqual([{ type: 'REMOVE_NODE', ref: 'n2' }]);
  });

  it('two databases: the user is asked which one, never guessed', () => {
    const two = mkDoc([['Orders', 'SERVICE'], ['PostgreSQL', 'DATABASE'], ['Reports DB', 'DATABASE']]);
    const r = parseCommand(two, 'connect orders to the database');
    expect(r).toMatchObject({ kind: 'clarify', options: ['PostgreSQL', 'Reports DB'] });
  });

  it('words that make the request more than a name are left to the model, not turned into one oddly named component', () => {
    for (const text of ['add a cache in front of the database', 'add redis after orders', 'add a queue before billing', 'add a cache for orders', 'add a cache next to the database']) {
      expect(kindOf(parseCommand(doc, text)), text).toBe('none');
    }
    expect(steps(parseCommand(doc, 'add a database'))).toEqual([{ type: 'ADD_NODE', name: 'Database' }]);
  });

  it('a typo gets "did you mean", not a refusal and not a new component', () => {
    const r = parseCommand(doc, 'connect Ordrs to PostgreSQL');
    expect(r).toMatchObject({ kind: 'clarify', options: ['Orders'] });
    expect((r as { question: string }).question).toMatch(/Did you mean Orders/);
  });
});

describe('parser: wordings that used to be mis-read', () => {
  const doc = mkDoc([['Web Client', 'CLIENT'], ['Orders', 'SERVICE'], ['PostgreSQL', 'DATABASE', 'PostgreSQL'], ['Redis', 'CACHE']], [['Web Client', 'Orders'], ['Orders', 'PostgreSQL']]);

  it('"add a database called Reports" adds ONE component named Reports (not one named "database called Reports")', () => {
    expect(steps(parseCommand(doc, 'add a database called Reports'))).toEqual([{ type: 'ADD_NODE', name: 'Reports', kind: 'DATABASE' }]);
    expect(steps(parseCommand(doc, 'create a cache named "Hot Cache"'))).toEqual([{ type: 'ADD_NODE', name: 'Hot Cache', kind: 'CACHE' }]);
    expect(steps(parseCommand(doc, 'add a thing called Billing'))).toEqual([{ type: 'ADD_NODE', name: 'Billing' }]);
  });

  it('counts, placeholders and compound requests are not turned into odd names', () => {
    for (const text of ['add two caches', 'add 3 queues', 'add Billing and connect it to Orders', 'connect orders to the cache and the database', 'remove redis and postgresql']) {
      expect(kindOf(parseCommand(doc, text)), text).toBe('none');
    }
    for (const text of ['add new', 'add a component', 'add something', 'add a service']) {
      expect(parseCommand(doc, text), text).toMatchObject({ kind: 'clarify', question: 'What should the new component be called?' });
    }
  });

  it('wiping the diagram is never done from text, however it is worded', () => {
    for (const text of ['clear the diagram', 'remove the whole diagram', 'delete everything', 'wipe the entire canvas', 'remove all components', 'erase my diagram']) {
      const r = parseCommand(doc, text);
      expect(r.kind, text).toBe('clarify');
      expect((r as { question: string }).question).toMatch(/Reset button/);
    }
    expect(steps(parseCommand(doc, 'remove the cache'))).toEqual([{ type: 'REMOVE_NODE', ref: 'n4' }]);
  });

  it('ordinary phrasings still work', () => {
    expect(steps(parseCommand(doc, 'add a new payments service'))).toEqual([{ type: 'ADD_NODE', name: 'Payments' }]);
    expect(steps(parseCommand(doc, 'create a Kafka queue'))).toEqual([{ type: 'ADD_NODE', name: 'Kafka queue' }]);
    expect(steps(parseCommand(doc, 'connect the cache to the database'))).toEqual([{ type: 'CONNECT', source: 'n4', target: 'n3' }]);
  });
});

describe('parser: a missing component is OFFERED, never silently invented', () => {
  const doc = mkDoc([['Orders', 'SERVICE']]);

  it('"put a cache between Orders and the database" with no database proposes adding one, wired in', () => {
    const p = propose(parseCommand(doc, 'put a cache between Orders and the database'));
    expect(p.question).toMatch(/no database in the diagram yet/i);
    expect(p.question).toMatch(/Should I add one/);
    expect(p.steps).toEqual([
      { type: 'ADD_NODE', name: 'Database', kind: 'DATABASE', as: 'new1' },
      { type: 'ADD_NODE', name: 'Cache', as: 'new2' },
      { type: 'CONNECT', source: 'n1', target: 'new2' },
      { type: 'CONNECT', source: 'new2', target: 'new1' },
    ]);
  });

  it('the missing end can be on either side', () => {
    const p = propose(parseCommand(doc, 'put a queue between the gateway and orders'));
    expect(p.steps.slice(2)).toEqual([
      { type: 'CONNECT', source: 'new1', target: 'new2' },
      { type: 'CONNECT', source: 'new2', target: 'n1' },
    ]);
  });

  it('connecting to a missing component or a missing NAME is offered too', () => {
    expect(propose(parseCommand(doc, 'connect orders to the database')).steps).toEqual([
      { type: 'ADD_NODE', name: 'Database', kind: 'DATABASE', as: 'new1' },
      { type: 'CONNECT', source: 'n1', target: 'new1' },
    ]);
    const named = propose(parseCommand(doc, 'connect Orders to Billing'));
    expect(named.question).toMatch(/couldn't find "Billing"/);
    expect(named.steps[0]).toEqual({ type: 'ADD_NODE', name: 'Billing', as: 'new1' });
  });

  it('removing, renaming or disconnecting something that is not there only says so (nothing to add)', () => {
    for (const text of ['remove the cache', 'rename the database to Main', 'disconnect orders from the database']) {
      expect(kindOf(parseCommand(doc, text)), text).toBe('clarify');
    }
  });

  it('both ends missing is not guessed at: the user is told, not asked to build a chain from nothing', () => {
    expect(kindOf(parseCommand(doc, 'connect the api to the database'))).toBe('clarify');
  });

  it('a name that is close to an existing one is a typo question, never a proposal to add a lookalike', () => {
    const near = ordersToPostgres();
    expect(kindOf(parseCommand(near, 'connect Orders to Postgress'))).not.toBe('propose');
  });
});

describe('yes / no replies', () => {
  it('only the short replies count; a longer sentence is a new request', () => {
    for (const t of ['yes', 'Yes!', 'Yes, add it', 'yep', "Sure, go ahead", 'ok', 'Do it.']) expect(classifyReply(t), t).toBe('YES');
    for (const t of ['no', 'No, leave it as it is', 'nope', 'cancel', 'never mind', "don't"]) expect(classifyReply(t), t).toBe('NO');
    for (const t of ['no, add Redis instead', 'yes and also add a queue', 'yes but call it Main', 'add it between orders and billing', 'yes please add Kafka']) expect(classifyReply(t), t).toBeNull();
  });

  it('stored proposals are read strictly', () => {
    expect(readProposal({ status: 'PROPOSAL', proposal: { source: 'PARSER', diagramVersion: 2, steps: [{ type: 'ADD_NODE', name: 'X' }] } })).not.toBeNull();
    expect(readProposal({ status: 'APPLIED' })).toBeNull();
    expect(readProposal({ status: 'PROPOSAL', proposal: { source: 'PARSER', diagramVersion: 2, steps: [{ type: 'DROP_TABLE' }] } })).toBeNull();
    expect(readProposal({ status: 'PROPOSAL', proposal: { source: 'PARSER', diagramVersion: 2, steps: [] } })).toBeNull();
    expect(readProposal(undefined)).toBeNull();
  });
});

describe('ask first, then apply exactly that (through the real API)', () => {
  let h: Harness;
  let u: TestUser;
  const provider = createFakeProvider((_request, call) => ({ output: { outcome: 'UNSUPPORTED', message: `unexpected model call ${call}` } }));
  beforeAll(async () => {
    h = await startHarness({ aiProvider: provider, env: { AI_RATE_LIMIT_PER_MINUTE: '1000', AI_MAX_CONCURRENT: '10' } });
    u = await h.newUser('proposer');
  });
  afterAll(() => h.close());

  async function diagramWithOrders() {
    const { diagram } = await createDiagramFor(h, u, 'Propose test');
    const added = await aiCmd(h, u, diagram.diagramId, diagram.version, 'add Orders');
    return { id: diagram.diagramId as string, version: added.body.diagram.version as number };
  }
  const state = async (id: string) => (await call(h, u, 'GET', `/v1/diagrams/${id}`)).body;

  it('the question changes nothing; "Yes, add it" applies exactly the plan as ONE version; neither calls the model', async () => {
    const d = await diagramWithOrders();
    const calls = provider.calls.length;

    const asked = await aiCmd(h, u, d.id, d.version, 'put a cache between Orders and the database');
    expect(asked.status).toBe(200);
    expect(asked.body).toMatchObject({ status: 'CLARIFICATION', source: 'PARSER', options: ['Yes, add it', 'No, leave it as it is'] });
    expect(asked.body.question).toMatch(/no database/i);
    expect((await state(d.id)).version).toBe(d.version); // asking changed nothing

    const stored = asked.body.messages.at(-1).metadata;
    expect(readProposal(stored)).toMatchObject({ source: 'PARSER', diagramVersion: d.version });

    const yes = await aiCmd(h, u, d.id, d.version, 'Yes, add it', { conversationId: asked.body.conversationId });
    expect(yes.status).toBe(200);
    expect(yes.body.status).toBe('APPLIED');
    const after = await state(d.id);
    expect(after.version).toBe(d.version + 1); // one version for the whole plan
    const byId = new Map<string, { name: string; kind: string }>(after.graph.nodes.map((n: { id: string; name: string; kind: string }) => [n.id, n]));
    expect([...byId.values()].map((n) => `${n.name}:${n.kind}`).sort()).toEqual(['Cache:CACHE', 'Database:DATABASE', 'Orders:SERVICE']);
    const wires = after.graph.edges.map((e: { sourceNodeId: string; targetNodeId: string }) => `${byId.get(e.sourceNodeId)!.name}->${byId.get(e.targetNodeId)!.name}`).sort();
    expect(wires).toEqual(['Cache->Database', 'Orders->Cache']);
    expect(provider.calls.length).toBe(calls); // the model was never involved
  });

  it('a second "yes" does nothing (the plan was used up)', async () => {
    const d = await diagramWithOrders();
    const asked = await aiCmd(h, u, d.id, d.version, 'connect orders to the database');
    const first = await aiCmd(h, u, d.id, d.version, 'yes', { conversationId: asked.body.conversationId });
    expect(first.body.status).toBe('APPLIED');
    const again = await aiCmd(h, u, d.id, first.body.diagram.version, 'yes', { conversationId: asked.body.conversationId });
    expect(again.body).toMatchObject({ status: 'CLARIFICATION' });
    expect(again.body.question).toMatch(/Yes to what/);
    expect((await state(d.id)).version).toBe(first.body.diagram.version);
  });

  it('"No" leaves the diagram alone and drops the plan', async () => {
    const d = await diagramWithOrders();
    const asked = await aiCmd(h, u, d.id, d.version, 'connect orders to Billing');
    const no = await aiCmd(h, u, d.id, d.version, 'No, leave it as it is', { conversationId: asked.body.conversationId });
    expect(no.body).toMatchObject({ status: 'CLARIFICATION' });
    expect(no.body.question).toMatch(/left the diagram as it is/);
    const yes = await aiCmd(h, u, d.id, d.version, 'yes', { conversationId: asked.body.conversationId });
    expect(yes.body.question).toMatch(/Yes to what/);
    expect((await state(d.id)).version).toBe(d.version);
  });

  it('if the diagram changed after the question, "yes" is refused instead of applying a stale plan', async () => {
    const d = await diagramWithOrders();
    const asked = await aiCmd(h, u, d.id, d.version, 'connect orders to the database');
    const moved = await cmd(d.id, u, h, d.version, { type: 'ADD_NODE', node: { name: 'Billing', kind: 'SERVICE' } });
    expect(moved.status).toBe(200);
    const yes = await aiCmd(h, u, d.id, moved.body.version, 'yes', { conversationId: asked.body.conversationId });
    expect(yes.body.question).toMatch(/diagram changed/);
    expect((await state(d.id)).version).toBe(moved.body.version);
  });

  it('"yes" with no question pending costs nothing and changes nothing', async () => {
    const d = await diagramWithOrders();
    const calls = provider.calls.length;
    const r = await aiCmd(h, u, d.id, d.version, 'yes');
    expect(r.body.question).toMatch(/Yes to what/);
    expect(provider.calls.length).toBe(calls);
    expect((await state(d.id)).version).toBe(d.version);
  });

  it("somebody else's conversation cannot be used to confirm a plan", async () => {
    const d = await diagramWithOrders();
    const asked = await aiCmd(h, u, d.id, d.version, 'connect orders to the database');
    const other = await h.newUser('intruder');
    const r = await aiCmd(h, other, d.id, d.version, 'yes', { conversationId: asked.body.conversationId });
    expect([403, 404]).toContain(r.status);
    expect((await state(d.id)).version).toBe(d.version);
  });
});

describe('the model can propose too (and is held to the same rules)', () => {
  let h: Harness;
  let u: TestUser;
  const plan = {
    outcome: 'PROPOSE',
    question: 'There is no queue yet. Should I add one and put it between Orders and the database?',
    commands: [
      { type: 'ADD_NODE', as: 'new1', name: 'Event Queue', kind: 'QUEUE' },
      { type: 'CONNECT', source: 'n1', target: 'new1' },
    ],
  };
  const provider = createFakeProvider((_request, call) => (call === 0 ? { output: plan } : call === 1 ? { output: { ...plan, commands: [{ type: 'CONNECT', source: 'n1', target: 'n9' }] } } : { output: { outcome: 'UNSUPPORTED', message: 'no' } }));
  beforeAll(async () => {
    h = await startHarness({ aiProvider: provider, env: { AI_RATE_LIMIT_PER_MINUTE: '1000', AI_MAX_CONCURRENT: '10' } });
    u = await h.newUser('model-proposer');
  });
  afterAll(() => h.close());

  it('a model proposal is stored and applied by "yes" with no second model call; one that would not work is never offered', async () => {
    const { diagram } = await createDiagramFor(h, u, 'Model propose');
    const added = await aiCmd(h, u, diagram.diagramId, diagram.version, 'add Orders');
    const version = added.body.diagram.version;

    const asked = await aiCmd(h, u, diagram.diagramId, version, 'make the orders flow asynchronous somehow');
    expect(asked.body).toMatchObject({ status: 'CLARIFICATION', source: 'AI', options: ['Yes, add it', 'No, leave it as it is'] });
    expect(provider.calls.length).toBe(1);

    const yes = await aiCmd(h, u, diagram.diagramId, version, 'yes', { conversationId: asked.body.conversationId });
    expect(yes.body).toMatchObject({ status: 'APPLIED', source: 'AI' });
    expect(provider.calls.length).toBe(1); // confirming did not call the model again
    const after = (await call(h, u, 'GET', `/v1/diagrams/${diagram.diagramId}`)).body;
    expect(after.graph.nodes.map((n: { name: string }) => n.name).sort()).toEqual(['Event Queue', 'Orders']);

    // The second scripted answer proposes something that cannot work (an alias that does not exist): the user is not asked about it.
    const bad = await aiCmd(h, u, diagram.diagramId, yes.body.diagram.version, 'rearrange the thing around the queue somehow');
    expect(bad.body.status).toBe('CLARIFICATION');
    expect(bad.body.options).not.toContain('Yes, add it');
  });
});

describe('the model asked an open question: "yes" answers it', () => {
  let h: Harness;
  let u: TestUser;
  const provider = createFakeProvider((_request, call) =>
    call === 0
      ? { output: { outcome: 'CLARIFY', question: 'Should I add a database and put a cache in front of it?', options: [] } }
      : { output: { outcome: 'COMMANDS', commands: [{ type: 'ADD_NODE', as: 'new1', name: 'Database', kind: 'DATABASE' }, { type: 'CONNECT', source: 'n1', target: 'new1' }] } },
  );
  beforeAll(async () => {
    h = await startHarness({ aiProvider: provider, env: { AI_RATE_LIMIT_PER_MINUTE: '1000', AI_MAX_CONCURRENT: '10' } });
    u = await h.newUser('open-question');
  });
  afterAll(() => h.close());

  it('"yes" goes back to the model with the conversation, so the user never meets "Yes to what?" after a model question', async () => {
    const { diagram } = await createDiagramFor(h, u, 'Open question');
    const added = await aiCmd(h, u, diagram.diagramId, diagram.version, 'add Orders');
    const version = added.body.diagram.version;
    const asked = await aiCmd(h, u, diagram.diagramId, version, 'make the orders data durable somehow please');
    expect(asked.body).toMatchObject({ status: 'CLARIFICATION', source: 'AI' });
    expect(provider.calls.length).toBe(1);

    const yes = await aiCmd(h, u, diagram.diagramId, version, 'yes', { conversationId: asked.body.conversationId });
    expect(yes.body.status).toBe('APPLIED');
    expect(provider.calls.length).toBe(2);
    expect(provider.calls[1]!.content).toContain('Should I add a database and put a cache in front of it?');
    expect(provider.calls[1]!.content).toContain('yes');
  });
});
