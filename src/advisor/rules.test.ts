import { describe, expect, it } from 'vitest';
import { readinessScore, reviewArchitecture, type ReviewEdge, type ReviewNode } from './rules';

type Spec = Record<string, string | [kind: string, technology: string]>;

/** Components by name and kind, connections by name: "A -> B" means A calls B. */
function graph(components: Spec, connections: Array<[string, string]> = []) {
  const nodes: ReviewNode[] = Object.entries(components).map(([name, v], i) => ({ id: `n${i}`, name, kind: Array.isArray(v) ? v[0] : v, ...(Array.isArray(v) ? { technology: v[1] } : {}) }));
  const id = (name: string) => nodes.find((n) => n.name === name)!.id;
  const edges: ReviewEdge[] = connections.map(([a, b], i) => ({ id: `e${i}`, source: id(a), target: id(b) }));
  return { nodes, edges, id };
}
const rules = (g: ReturnType<typeof graph>) => reviewArchitecture(g.nodes, g.edges).map((f) => f.rule);

describe('an empty or tiny diagram is not nagged', () => {
  it('no components, no findings; a single component, no findings', () => {
    expect(reviewArchitecture([], [])).toEqual([]);
    expect(rules(graph({ Orders: 'SERVICE' }))).toEqual([]);
  });

  it('a well-formed small system is clean', () => {
    const g = graph(
      { Web: 'CLIENT', 'API Gateway': 'GATEWAY', Cloudfront: ['GATEWAY', 'CDN'], Auth: 'SERVICE', Orders: 'SERVICE', 'Orders DB': 'DATABASE', CloudWatch: 'SERVICE' },
      [['Web', 'Cloudfront'], ['Cloudfront', 'API Gateway'], ['API Gateway', 'Auth'], ['API Gateway', 'Orders'], ['Orders', 'Orders DB'], ['API Gateway', 'CloudWatch'], ['Orders', 'CloudWatch']],
    );
    expect(reviewArchitecture(g.nodes, g.edges).map((f) => `${f.rule}: ${f.title}`)).toEqual([]);
  });
});

describe('security', () => {
  it('a client wired straight to a database is critical and names both', () => {
    const g = graph({ 'Mobile app': 'CLIENT', Postgres: 'DATABASE' }, [['Mobile app', 'Postgres']]);
    const f = reviewArchitecture(g.nodes, g.edges).find((x) => x.rule === 'client-to-data-store')!;
    expect(f.severity).toBe('critical');
    expect(f.title).toContain('Mobile app');
    expect(f.title).toContain('Postgres');
    expect(f.nodeIds.sort()).toEqual([g.id('Mobile app'), g.id('Postgres')].sort());
  });

  it('a client calling services with no gateway at all: one finding, with a fix that inserts a gateway on that connection', () => {
    const g = graph({ Web: 'CLIENT', Orders: 'SERVICE' }, [['Web', 'Orders']]);
    const f = reviewArchitecture(g.nodes, g.edges).find((x) => x.rule === 'no-gateway')!;
    expect(f).toBeDefined();
    expect(f.action).toMatchObject({ type: 'insertBetween', source: g.id('Web'), target: g.id('Orders') });
    expect(rules(g)).not.toContain('bypasses-gateway');
  });

  it('with a gateway present, a client that still reaches a service directly is flagged as going around it', () => {
    const g = graph({ Web: 'CLIENT', GW: 'GATEWAY', Orders: 'SERVICE', Billing: 'SERVICE' }, [['Web', 'GW'], ['GW', 'Orders'], ['Web', 'Billing']]);
    const found = reviewArchitecture(g.nodes, g.edges).filter((f) => f.rule === 'bypasses-gateway');
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toContain('Billing');
    expect(rules(g)).not.toContain('no-gateway');
  });

  it('missing authentication is flagged only when there is a public client, and any identity-looking component silences it', () => {
    expect(rules(graph({ Web: 'CLIENT', GW: 'GATEWAY', Orders: 'SERVICE' }, [['Web', 'GW'], ['GW', 'Orders']]))).toContain('no-authentication');
    expect(rules(graph({ GW: 'GATEWAY', Orders: 'SERVICE' }, [['GW', 'Orders']]))).not.toContain('no-authentication'); // nobody outside calls it
    for (const name of ['Cognito Auth', 'Keycloak', 'Okta SSO', 'Identity Provider']) {
      expect(rules(graph({ Web: 'CLIENT', GW: 'GATEWAY', [name]: 'SERVICE' }, [['Web', 'GW'], ['GW', name]])), name).not.toContain('no-authentication');
    }
  });

  it('a public gateway without any firewall or CDN gets one low-priority note; a WAF or CDN silences it', () => {
    const base = { Web: 'CLIENT', GW: 'GATEWAY', Auth: 'SERVICE' };
    expect(rules(graph(base, [['Web', 'GW'], ['GW', 'Auth']]))).toContain('no-edge-protection');
    expect(rules(graph({ ...base, 'AWS WAF': 'GATEWAY' }, [['Web', 'AWS WAF'], ['AWS WAF', 'GW'], ['GW', 'Auth']]))).not.toContain('no-edge-protection');
  });
});

describe('reliability', () => {
  it('a synchronous loop between services is reported once, naming all of them', () => {
    const g = graph({ A: 'SERVICE', B: 'SERVICE', C: 'SERVICE', D: 'SERVICE' }, [['A', 'B'], ['B', 'C'], ['C', 'A'], ['C', 'D']]);
    const loops = reviewArchitecture(g.nodes, g.edges).filter((f) => f.rule === 'circular-dependency');
    expect(loops).toHaveLength(1);
    expect([...loops[0]!.nodeIds].sort()).toEqual([g.id('A'), g.id('B'), g.id('C')].sort());
  });

  it('a queue in the loop breaks it: that is what queues are for', () => {
    const g = graph({ A: 'SERVICE', Q: 'QUEUE', B: 'SERVICE' }, [['A', 'Q'], ['Q', 'B'], ['B', 'A']]);
    expect(rules(g)).not.toContain('circular-dependency');
  });

  it('a queue nobody reads from is high severity; a queue nobody writes to is medium; a healthy queue is silent', () => {
    const noReader = graph({ Orders: 'SERVICE', Jobs: 'QUEUE' }, [['Orders', 'Jobs']]);
    expect(reviewArchitecture(noReader.nodes, noReader.edges).find((f) => f.rule === 'queue-without-consumer')?.severity).toBe('high');
    const noWriter = graph({ Jobs: 'QUEUE', Worker: 'SERVICE' }, [['Jobs', 'Worker']]);
    expect(reviewArchitecture(noWriter.nodes, noWriter.edges).find((f) => f.rule === 'queue-without-producer')?.severity).toBe('medium');
    const healthy = graph({ Orders: 'SERVICE', Jobs: 'QUEUE', Worker: 'SERVICE' }, [['Orders', 'Jobs'], ['Jobs', 'Worker']]);
    expect(rules(healthy)).not.toContain('queue-without-consumer');
    expect(rules(healthy)).not.toContain('queue-without-producer');
  });

  it('a database that two or more components depend on is a single point of failure unless a replica is shown', () => {
    const two = graph({ A: 'SERVICE', B: 'SERVICE', DB: 'DATABASE' }, [['A', 'DB'], ['B', 'DB']]);
    expect(reviewArchitecture(two.nodes, two.edges).find((f) => f.rule === 'database-single-point-of-failure')?.severity).toBe('medium');
    const three = graph({ A: 'SERVICE', B: 'SERVICE', C: 'SERVICE', DB: 'DATABASE' }, [['A', 'DB'], ['B', 'DB'], ['C', 'DB']]);
    expect(reviewArchitecture(three.nodes, three.edges).find((f) => f.rule === 'database-single-point-of-failure')?.severity).toBe('high');
    const one = graph({ A: 'SERVICE', DB: 'DATABASE' }, [['A', 'DB']]);
    expect(rules(one)).not.toContain('database-single-point-of-failure');
    const replicated = graph({ A: 'SERVICE', B: 'SERVICE', DB: 'DATABASE', 'DB read replica': 'DATABASE' }, [['A', 'DB'], ['B', 'DB'], ['DB', 'DB read replica']]);
    expect(rules(replicated)).not.toContain('database-single-point-of-failure');
  });

  it('three components depending on one service is flagged, unless a load balancer is shown', () => {
    const c = { A: 'SERVICE', B: 'SERVICE', C: 'SERVICE', Core: 'SERVICE' };
    const links: Array<[string, string]> = [['A', 'Core'], ['B', 'Core'], ['C', 'Core']];
    expect(rules(graph(c, links))).toContain('service-fan-in');
    expect(rules(graph({ ...c, 'Application Load Balancer': 'GATEWAY' }, [...links, ['Application Load Balancer', 'Core']]))).not.toContain('service-fan-in');
  });

  it('a third party called by a service gets a gentle note about timeouts and queues', () => {
    const g = graph({ Billing: 'SERVICE', Stripe: 'EXTERNAL' }, [['Billing', 'Stripe']]);
    const f = reviewArchitecture(g.nodes, g.edges).find((x) => x.rule === 'external-dependency')!;
    expect(f.severity).toBe('low');
    expect(f.title).toContain('Stripe');
  });
});

describe('performance and scalability', () => {
  it('several services reading one database with no cache anywhere: suggest a cache and offer to add it; any cache silences it', () => {
    const g = graph({ A: 'SERVICE', B: 'SERVICE', DB: 'DATABASE' }, [['A', 'DB'], ['B', 'DB']]);
    const f = reviewArchitecture(g.nodes, g.edges).find((x) => x.rule === 'database-without-cache')!;
    expect(f.action).toMatchObject({ type: 'addAfter', component: { kind: 'cache' } });
    const cached = graph({ A: 'SERVICE', B: 'SERVICE', DB: 'DATABASE', Redis: 'CACHE' }, [['A', 'Redis'], ['B', 'Redis'], ['A', 'DB'], ['B', 'DB']]);
    expect(rules(cached)).not.toContain('database-without-cache');
    expect(rules(graph({ A: 'SERVICE', DB: 'DATABASE' }, [['A', 'DB']]))).not.toContain('database-without-cache'); // one reader: not worth a cache yet
  });

  it('three or more services on one database are called out as a shared-database coupling', () => {
    const g = graph({ A: 'SERVICE', B: 'SERVICE', C: 'SERVICE', DB: 'DATABASE' }, [['A', 'DB'], ['B', 'DB'], ['C', 'DB']]);
    expect(rules(g)).toContain('shared-database');
    expect(rules(graph({ A: 'SERVICE', B: 'SERVICE', DB: 'DATABASE' }, [['A', 'DB'], ['B', 'DB']]))).not.toContain('shared-database');
  });

  it('a normal client, gateway, service, database path is not a long chain: only services, gateways and third parties count', () => {
    const g = graph({ Web: 'CLIENT', GW: 'GATEWAY', A: 'SERVICE', B: 'SERVICE', DB: 'DATABASE', Cache: 'CACHE' }, [['Web', 'GW'], ['GW', 'A'], ['A', 'B'], ['B', 'Cache'], ['Cache', 'DB']]);
    expect(rules(g)).not.toContain('long-synchronous-chain');
  });

  it('a request that must pass through five or more services in a row is flagged with the whole chain; queues end a chain', () => {
    const names5 = { S1: 'SERVICE', S2: 'SERVICE', S3: 'SERVICE', S4: 'SERVICE', S5: 'SERVICE' };
    const chain: Array<[string, string]> = [['S1', 'S2'], ['S2', 'S3'], ['S3', 'S4'], ['S4', 'S5']];
    const g = graph(names5, chain);
    const f = reviewArchitecture(g.nodes, g.edges).find((x) => x.rule === 'long-synchronous-chain')!;
    expect(f.nodeIds).toHaveLength(5);
    expect(rules(graph({ S1: 'SERVICE', S2: 'SERVICE', S3: 'SERVICE', S4: 'SERVICE' }, [['S1', 'S2'], ['S2', 'S3'], ['S3', 'S4']]))).not.toContain('long-synchronous-chain');
    const cut = graph({ ...names5, Q: 'QUEUE' }, [['S1', 'S2'], ['S2', 'S3'], ['S3', 'Q'], ['Q', 'S4'], ['S4', 'S5']]);
    expect(rules(cut)).not.toContain('long-synchronous-chain');
  });

  it('a service calling three others directly, with no queue in the diagram, is flagged; a queue anywhere silences it', () => {
    const base = { Hub: 'SERVICE', A: 'SERVICE', B: 'SERVICE', C: 'SERVICE' };
    const links: Array<[string, string]> = [['Hub', 'A'], ['Hub', 'B'], ['Hub', 'C']];
    expect(rules(graph(base, links))).toContain('synchronous-fan-out');
    expect(rules(graph({ ...base, Events: 'QUEUE' }, [...links, ['Hub', 'Events']]))).not.toContain('synchronous-fan-out');
  });

  it('file-handling components without object storage get a storage suggestion; storage silences it; ordinary names do not trigger it', () => {
    expect(rules(graph({ 'Upload Service': 'SERVICE', DB: 'DATABASE' }, [['Upload Service', 'DB']]))).toContain('files-without-object-storage');
    expect(rules(graph({ 'Upload Service': 'SERVICE', Bucket: ['STORAGE', 'S3'] }, [['Upload Service', 'Bucket']]))).not.toContain('files-without-object-storage');
    expect(rules(graph({ Orders: 'SERVICE', Billing: 'SERVICE', DB: 'DATABASE' }, [['Orders', 'DB'], ['Billing', 'DB']]))).not.toContain('files-without-object-storage');
  });
});

describe('maintainability and observability', () => {
  it('components with no connections are listed (only once the diagram has a few components)', () => {
    const g = graph({ A: 'SERVICE', B: 'SERVICE', Lonely: 'SERVICE' }, [['A', 'B']]);
    const f = reviewArchitecture(g.nodes, g.edges).filter((x) => x.rule === 'unconnected-component');
    expect(f.map((x) => x.nodeIds[0])).toEqual([g.id('Lonely')]);
    expect(rules(graph({ A: 'SERVICE', B: 'SERVICE' }))).not.toContain('unconnected-component'); // still sketching
  });

  it('three or more running services with no monitoring or logging: one low note; any observability tool silences it', () => {
    const base = { A: 'SERVICE', B: 'SERVICE', C: 'SERVICE' };
    const links: Array<[string, string]> = [['A', 'B'], ['B', 'C']];
    expect(rules(graph(base, links))).toContain('no-observability');
    expect(rules(graph({ ...base, Grafana: 'SERVICE' }, links))).not.toContain('no-observability');
    expect(rules(graph({ ...base, 'Datadog agent': 'SERVICE' }, links))).not.toContain('no-observability');
  });
});

describe('wording', () => {
  it('verbs agree with how many components are named', () => {
    const one = graph({ Orders: 'SERVICE', Jobs: 'QUEUE' }, [['Orders', 'Jobs']]);
    expect(reviewArchitecture(one.nodes, one.edges).find((f) => f.rule === 'queue-without-consumer')!.why).toContain('Orders sends messages');
    const two = graph({ A: 'SERVICE', B: 'SERVICE', Jobs: 'QUEUE' }, [['A', 'Jobs'], ['B', 'Jobs']]);
    expect(reviewArchitecture(two.nodes, two.edges).find((f) => f.rule === 'queue-without-consumer')!.why).toContain('A and B send messages');
    const waiting = graph({ Jobs: 'QUEUE', Worker: 'SERVICE' }, [['Jobs', 'Worker']]);
    expect(reviewArchitecture(waiting.nodes, waiting.edges).find((f) => f.rule === 'queue-without-producer')!.why).toContain('Worker waits for messages');
  });
});

describe('ordering, ids and the score', () => {
  it('most serious first; ids are stable between runs and unique within one', () => {
    const g = graph(
      { Web: 'CLIENT', DB: 'DATABASE', A: 'SERVICE', B: 'SERVICE', Lonely: 'SERVICE' },
      [['Web', 'DB'], ['A', 'DB'], ['B', 'DB']],
    );
    const first = reviewArchitecture(g.nodes, g.edges);
    const second = reviewArchitecture([...g.nodes].reverse(), g.edges);
    expect(first[0]!.severity).toBe('critical');
    const order = ['critical', 'high', 'medium', 'low'];
    expect(first.map((f) => order.indexOf(f.severity))).toEqual([...first.map((f) => order.indexOf(f.severity))].sort((a, b) => a - b));
    expect(new Set(first.map((f) => f.id)).size).toBe(first.length);
    expect(new Set(second.map((f) => f.id))).toEqual(new Set(first.map((f) => f.id)));
  });

  it('a finding goes away when its cause does, and a dismissed id would come back only if the problem changes', () => {
    const before = graph({ A: 'SERVICE', Jobs: 'QUEUE' }, [['A', 'Jobs']]);
    const id = reviewArchitecture(before.nodes, before.edges).find((f) => f.rule === 'queue-without-consumer')!.id;
    const fixed = graph({ A: 'SERVICE', Jobs: 'QUEUE', W: 'SERVICE' }, [['A', 'Jobs'], ['Jobs', 'W']]);
    expect(reviewArchitecture(fixed.nodes, fixed.edges).map((f) => f.id)).not.toContain(id);
  });

  it('the score is 100 with nothing flagged, drops by severity, never below 5, and is 0 for an empty diagram', () => {
    expect(readinessScore([], 3)).toBe(100);
    expect(readinessScore([], 0)).toBe(0);
    const g = graph({ Web: 'CLIENT', DB: 'DATABASE' }, [['Web', 'DB']]);
    const findings = reviewArchitecture(g.nodes, g.edges);
    expect(readinessScore(findings, 2)).toBeLessThan(80);
    expect(readinessScore(Array.from({ length: 30 }, () => findings[0]!), 2)).toBe(5);
  });
});
