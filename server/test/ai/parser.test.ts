import { describe, expect, it } from 'vitest';
import { parseCommand, type ParseResult } from '../../src/modules/ai/application/parser.ts';
import { mkDoc, ordersToPostgres } from './helpers.ts';

const steps = (r: ParseResult) => {
  if (r.kind !== 'steps') throw new Error(`expected steps, got ${JSON.stringify(r)}`);
  return r.steps;
};
const clarify = (r: ParseResult) => {
  if (r.kind !== 'clarify') throw new Error(`expected clarification, got ${JSON.stringify(r)}`);
  return r;
};

describe('parser: insert between (the gate command)', () => {
  const doc = ordersToPostgres();

  it('"Put Redis between Orders and PostgreSQL" splits the existing connection: one INSERT_BETWEEN naming that edge', () => {
    expect(steps(parseCommand(doc, 'Put Redis between Orders and PostgreSQL'))).toEqual([
      { type: 'INSERT_BETWEEN', name: 'Redis', source: 'n1', target: 'n2', edge: 'e1' },
    ]);
  });

  it('accepts natural variants: politeness, articles, "in between", trailing punctuation, case', () => {
    for (const text of [
      'please put a Redis cache in between orders and postgresql.',
      'Could you insert Redis between the Orders and the PostgreSQL?',
      'add redis between orders and postgres',
      "Let's place a redis node between ORDERS and POSTGRESQL!",
    ]) {
      const s = steps(parseCommand(doc, text));
      expect(s[0], text).toMatchObject({ type: 'INSERT_BETWEEN', source: 'n1', target: 'n2', edge: 'e1' });
    }
    expect(steps(parseCommand(doc, 'put a Redis cache in between orders and postgresql.'))[0]).toMatchObject({ name: 'Redis cache' });
  });

  it('partial names resolve when exactly one component matches', () => {
    const d = mkDoc([['Orders Service'], ['PostgreSQL DB', 'DATABASE']], [['Orders Service', 'PostgreSQL DB']]);
    expect(steps(parseCommand(d, 'put redis between orders and postgres'))[0]).toMatchObject({ source: 'n1', target: 'n2', edge: 'e1' });
  });

  it('an explicit UUID is a reference too', () => {
    const [orders, pg] = [doc.graph.nodes[0]!.id, doc.graph.nodes[1]!.id];
    expect(steps(parseCommand(doc, `put Redis between ${orders} and ${pg}`))[0]).toMatchObject({ source: 'n1', target: 'n2' });
  });

  it('when the two are not connected it adds the node and wires both sides (adds only, removes nothing)', () => {
    const d = mkDoc(['Orders', 'Billing']);
    expect(steps(parseCommand(d, 'put Redis between Orders and Billing'))).toEqual([
      { type: 'ADD_NODE', name: 'Redis', as: 'new1' },
      { type: 'CONNECT', source: 'n1', target: 'new1' },
      { type: 'CONNECT', source: 'new1', target: 'n2' },
    ]);
  });

  it('when the connection runs the other way it asks, offering the corrected command', () => {
    const r = clarify(parseCommand(doc, 'put Redis between PostgreSQL and Orders'));
    expect(r.question).toContain('other way');
    expect(r.options).toEqual(['Put Redis between Orders and PostgreSQL']);
  });

  it('several connections between the pair: asks which one', () => {
    const d = mkDoc(['A', 'B'], [['A', 'B', 'HTTP'], ['A', 'B', 'events']]);
    const r = clarify(parseCommand(d, 'put Kafka between A and B'));
    expect(r.question).toContain('2 connections');
    expect(r.options).toEqual(['HTTP', 'events']);
  });
});

describe('parser: unknown and ambiguous references are questions, never guesses', () => {
  it('an unknown component lists what exists and suggests close names', () => {
    const d = mkDoc(['Orders', 'Order History', 'PostgreSQL']);
    const r = clarify(parseCommand(d, 'connect Payments to PostgreSQL'));
    expect(r.question).toContain('"Payments"');
    expect(r.question).toContain('Orders');
    const close = clarify(parseCommand(d, 'remove Order'));
    expect(close.options).toEqual(expect.arrayContaining(['Orders', 'Order History']));
  });

  it('an ambiguous partial name lists the candidates', () => {
    const d = mkDoc(['Orders Service', 'Orders DB', 'Billing']);
    const r = clarify(parseCommand(d, 'remove orders'));
    expect(r.question).toContain('Orders Service');
    expect(r.options).toEqual(['Orders Service', 'Orders DB']);
  });

  it('two components with the same name are ambiguous even for an exact match', () => {
    const d = mkDoc(['Cache', 'Cache', 'Orders']);
    expect(clarify(parseCommand(d, 'connect orders to cache')).options).toEqual(['Cache', 'Cache']);
  });

  it('a short unknown NAME is still a question (only descriptions are left to the model)', () => {
    const d = mkDoc(['Orders', 'PostgreSQL']);
    expect(clarify(parseCommand(d, 'connect Payments to Orders')).question).toContain('"Payments"');
    expect(clarify(parseCommand(d, 'connect the Payments service to Orders')).question).toContain('Payments');
  });

  it('an empty diagram says so', () => {
    expect(clarify(parseCommand(mkDoc([]), 'remove Orders')).question).toContain('empty');
  });

  it('the same component twice is rejected', () => {
    expect(clarify(parseCommand(ordersToPostgres(), 'connect Orders to Orders')).question).toContain('same component');
  });
});

describe('parser: the other commands', () => {
  const doc = mkDoc([['Orders'], ['PostgreSQL', 'DATABASE'], ['Billing']], [['Orders', 'PostgreSQL', 'SQL']]);

  it('add', () => {
    expect(steps(parseCommand(doc, 'add a Redis cache'))).toEqual([{ type: 'ADD_NODE', name: 'Redis cache' }]);
    expect(steps(parseCommand(doc, 'Create an API Gateway node.'))).toEqual([{ type: 'ADD_NODE', name: 'API Gateway' }]);
    expect(steps(parseCommand(doc, 'add Kafka to the diagram'))).toEqual([{ type: 'ADD_NODE', name: 'Kafka' }]);
  });

  it('connect, with arrows and "draw a connection"', () => {
    for (const t of ['connect Billing to Orders', 'link billing with orders', 'Billing -> Orders', 'draw a connection from Billing to Orders']) {
      expect(steps(parseCommand(doc, t)), t).toEqual([{ type: 'CONNECT', source: 'n3', target: 'n1' }]);
    }
  });

  it('disconnect uses the existing connection whichever way it runs, and asks when it is not unique', () => {
    expect(steps(parseCommand(doc, 'disconnect Orders from PostgreSQL'))).toEqual([{ type: 'DISCONNECT', edge: 'e1' }]);
    expect(steps(parseCommand(doc, 'remove the connection between PostgreSQL and Orders'))).toEqual([{ type: 'DISCONNECT', edge: 'e1' }]);
    expect(clarify(parseCommand(doc, 'disconnect Orders from Billing')).question).toContain('not connected');
    const both = mkDoc(['A', 'B'], [['A', 'B'], ['B', 'A']]);
    expect(clarify(parseCommand(both, 'disconnect A from B')).options).toHaveLength(2);
  });

  it('remove and rename', () => {
    expect(steps(parseCommand(doc, 'delete the Billing service'))).toEqual([{ type: 'REMOVE_NODE', ref: 'n3' }]);
    expect(steps(parseCommand(doc, 'rename Billing to Payments'))).toEqual([{ type: 'RENAME_NODE', ref: 'n3', name: 'Payments' }]);
    expect(steps(parseCommand(doc, 'call orders as "Order Service"'))).toEqual([{ type: 'RENAME_NODE', ref: 'n1', name: 'Order Service' }]);
  });

  it('a typed reset is never executed: it points at the confirmed Reset button', () => {
    for (const t of ['reset', 'clear the diagram', 'start over', 'delete everything']) {
      const r = clarify(parseCommand(doc, t));
      expect(r.question).toContain('Reset button');
    }
  });
});

describe('parser: leaves anything else to the model', () => {
  const doc = ordersToPostgres();
  it.each([
    'wire an event queue from orders to a new billing service',
    'connect the orders service to the new billing database',
    'link a cache that sits in front of orders to the database',
    'What happens if Orders goes down?',
    'Build me a typical three tier web app',
    'add a cache and connect it to Orders',
    'Add Redis and Kafka',
    'make the database faster',
    '',
    'x'.repeat(400),
  ])('%s', (text) => {
    expect(parseCommand(doc, text)).toEqual({ kind: 'none' });
  });
});
