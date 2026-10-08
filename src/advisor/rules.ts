/**
 * The architecture review: what a careful engineer would point out about THIS diagram, from its components and connections alone.
 * No model, no network. Every finding is computed from the actual graph, names the components involved, says why it matters and what to
 * do, and only appears when the evidence is there (a rule that does not apply stays silent). A connection A -> B means "A calls or sends to B".
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Category = 'Security' | 'Reliability' | 'Performance' | 'Scalability' | 'Maintainability' | 'Observability';

export interface ReviewNode {
  id: string;
  name: string;
  kind: string; // CLIENT, GATEWAY, SERVICE, DATABASE, CACHE, QUEUE, STORAGE, EXTERNAL, GENERIC
  technology?: string | undefined;
  group?: string | undefined;
}
export interface ReviewEdge {
  id: string;
  source: string;
  target: string;
  relationship?: string | undefined;
}

/** Something the person can apply with one click: it becomes ordinary diagram commands (so it is saved and undoable like any edit). */
export type FixAction =
  | { type: 'insertBetween'; label: string; source: string; target: string; component: ComponentSpec }
  | { type: 'addAfter'; label: string; from: string; component: ComponentSpec; relationship: string }
  | { type: 'add'; label: string; component: ComponentSpec };

export interface ComponentSpec {
  label: string;
  kind: 'gateway' | 'cache' | 'queue' | 'storage' | 'service' | 'database';
  icon: string;
  technology: string;
}

export interface Finding {
  /** Stable while the problem stays the same, so a dismissed finding stays dismissed. */
  id: string;
  rule: string;
  severity: Severity;
  category: Category;
  title: string;
  /** Why it matters, specific to this diagram. */
  why: string;
  /** What to do about it. */
  fix: string;
  /** The components the finding is about (for "Show on diagram"). */
  nodeIds: string[];
  action?: FixAction;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_COST: Record<Severity, number> = { critical: 30, high: 18, medium: 9, low: 4 };

const AUTH = /\b(auth|authn|authz|identity|idp|cognito|okta|auth0|keycloak|sso|oauth|oidc|login|iam)\b/i;
const REPLICA = /\b(replica|replicas|standby|secondary|failover|backup|multi.?az|mirror)\b/i;
const OBSERVABILITY = /\b(monitor|monitoring|logging|logs?|metrics|observability|cloudwatch|datadog|prometheus|grafana|sentry|new.?relic|otel|opentelemetry|tracing|jaeger|splunk|elk|kibana|loki)\b/i;
const EDGE_PROTECTION = /\b(cdn|cloudfront|waf|akamai|cloudflare|fastly|firewall|shield)\b/i;
const LOAD_BALANCER = /\b(load.?balancer|alb|elb|nlb|haproxy|nginx|traefik|envoy)\b/i;
const FILE_HANDLING = /\b(upload|uploads|media|image|images|photo|photos|video|videos|file|files|document|documents|attachment|attachments|asset|assets|report|reports|export|invoice|invoices|pdf)\b/i;

const text = (n: ReviewNode) => `${n.name} ${n.technology ?? ''}`;
const idsKey = (ids: readonly string[]) => [...ids].sort().join(',');

interface Index {
  nodes: ReviewNode[];
  byId: Map<string, ReviewNode>;
  out: Map<string, string[]>; // distinct targets
  inn: Map<string, string[]>; // distinct sources
}

function index(nodes: readonly ReviewNode[], edges: readonly ReviewEdge[]): Index {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const inn = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    if (!out.get(e.source)!.includes(e.target)) out.get(e.source)!.push(e.target);
    if (!inn.get(e.target)!.includes(e.source)) inn.get(e.target)!.push(e.source);
  }
  return { nodes: [...nodes], byId, out, inn };
}

const ofKind = (ix: Index, ...kinds: string[]) => ix.nodes.filter((n) => kinds.includes(n.kind));
const names = (ix: Index, ids: readonly string[]) => ids.map((id) => ix.byId.get(id)?.name ?? 'a component');
/** "sends" for one component, "send" for several. */
const verb = (count: number, one: string, many: string) => (count === 1 ? one : many);
const list = (items: readonly string[]) => (items.length <= 1 ? (items[0] ?? '') : items.length === 2 ? `${items[0]} and ${items[1]}` : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** Strongly connected groups of 2 or more components, ignoring asynchronous hops (a queue breaks a cycle: that is what queues are for). */
function synchronousCycles(ix: Index): string[][] {
  const live = ix.nodes.filter((n) => n.kind !== 'QUEUE').map((n) => n.id);
  const liveSet = new Set(live);
  const next = (id: string) => (ix.out.get(id) ?? []).filter((t) => liveSet.has(t));
  let counter = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const groups: string[][] = [];
  const visit = (v: string) => {
    idx.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of next(v)) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const group: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        group.push(w);
      } while (w !== v);
      if (group.length > 1) groups.push(group);
    }
  };
  for (const v of live) if (!idx.has(v)) visit(v);
  return groups;
}

/** Components that do work on a request (the others, such as clients and data stores, end a path rather than add a step to it). */
const isStep = (n: ReviewNode) => n.kind === 'SERVICE' || n.kind === 'GATEWAY' || n.kind === 'EXTERNAL';

/** The longest chain of synchronous steps (queues end a chain). Cycles are skipped here: they have their own finding. */
function longestChain(ix: Index): string[] {
  const cyclic = new Set(synchronousCycles(ix).flat());
  const memo = new Map<string, string[]>();
  const steps = (path: string[]) => path.filter((id) => isStep(ix.byId.get(id)!)).length;
  const walk = (id: string): string[] => {
    if (memo.has(id)) return memo.get(id)!;
    let best: string[] = [];
    for (const t of ix.out.get(id) ?? []) {
      const target = ix.byId.get(t)!;
      if (target.kind === 'QUEUE' || cyclic.has(t)) continue;
      const tail = walk(t);
      if (steps(tail) > steps(best)) best = tail;
    }
    const chain = [id, ...best];
    memo.set(id, chain);
    return chain;
  };
  let longest: string[] = [];
  for (const n of ix.nodes) {
    if (n.kind === 'QUEUE' || cyclic.has(n.id)) continue;
    const c = walk(n.id);
    if (steps(c) > steps(longest)) longest = c;
  }
  return longest.filter((id) => isStep(ix.byId.get(id)!));
}

export function reviewArchitecture(nodes: readonly ReviewNode[], edges: readonly ReviewEdge[]): Finding[] {
  const ix = index(nodes, edges);
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, 'id'> & { key?: string }) => {
    const { key, ...rest } = f;
    findings.push({ ...rest, id: `${f.rule}:${key ?? idsKey(f.nodeIds)}` });
  };
  if (ix.nodes.length === 0) return [];

  const clients = ofKind(ix, 'CLIENT');
  const services = ofKind(ix, 'SERVICE');
  const gateways = ofKind(ix, 'GATEWAY');
  const databases = ofKind(ix, 'DATABASE');
  const caches = ofKind(ix, 'CACHE');
  const queues = ofKind(ix, 'QUEUE');
  const kindOf = (id: string) => ix.byId.get(id)?.kind;

  // ---- Security ----
  // 1. A client talking straight to a data store.
  for (const c of clients) {
    for (const t of ix.out.get(c.id) ?? []) {
      if (kindOf(t) === 'DATABASE' || kindOf(t) === 'STORAGE') {
        const target = ix.byId.get(t)!;
        add({
          rule: 'client-to-data-store',
          severity: 'critical',
          category: 'Security',
          title: `${c.name} talks directly to ${target.name}`,
          why: `Anything that can reach ${target.name} from a browser or app can be copied, scraped or abused. The data store has no service in front of it to check who is asking and what they may see.`,
          fix: `Put a service (and usually a gateway) between ${c.name} and ${target.name}. Only that service should hold the credentials.`,
          nodeIds: [c.id, t],
        });
      }
    }
  }

  // 2. No single entrance for clients.
  const direct = clients.flatMap((c) => (ix.out.get(c.id) ?? []).filter((t) => kindOf(t) === 'SERVICE').map((t) => [c.id, t] as const));
  if (direct.length > 0 && gateways.length === 0) {
    const [c, t] = direct[0]!;
    add({
      rule: 'no-gateway',
      severity: 'high',
      category: 'Security',
      title: `${list(names(ix, [...new Set(direct.map(([a]) => a))]))} ${verb(new Set(direct.map(([a]) => a)).size, 'reaches', 'reach')} services without a gateway`,
      why: `Each service is exposed on its own, so sign-in checks, rate limiting and request logging have to be repeated in every one of them (and forgotten in one of them sooner or later).`,
      fix: `Add one gateway as the only way in, and let it forward requests to ${list(names(ix, [...new Set(direct.map(([, b]) => b))]))}.`,
      nodeIds: [...new Set(direct.flat())],
      action: { type: 'insertBetween', label: `Insert API Gateway between ${ix.byId.get(c)!.name} and ${ix.byId.get(t)!.name}`, source: c, target: t, component: { label: 'API Gateway', kind: 'gateway', icon: 'api-gateway', technology: 'Amazon API Gateway' } },
      key: idsKey(direct.flat()),
    });
  } else if (gateways.length > 0) {
    // 3. A gateway exists, but a client still reaches a service around it.
    for (const [c, t] of direct) {
      add({
        rule: 'bypasses-gateway',
        severity: 'medium',
        category: 'Security',
        title: `${ix.byId.get(c)!.name} reaches ${ix.byId.get(t)!.name} around the gateway`,
        why: `The gateway is where sign-in and rate limits are enforced. A second, direct path to ${ix.byId.get(t)!.name} skips all of that.`,
        fix: `Remove the direct connection and send ${ix.byId.get(c)!.name}'s requests through ${gateways[0]!.name}.`,
        nodeIds: [c, t],
      });
    }
  }

  // 4. Nothing checks who the caller is.
  if (clients.length > 0 && (services.length > 0 || gateways.length > 0) && !ix.nodes.some((n) => AUTH.test(text(n)))) {
    const entrance = gateways[0] ?? services[0]!;
    add({
      rule: 'no-authentication',
      severity: 'high',
      category: 'Security',
      title: 'Nothing in the diagram checks who is calling',
      why: `${list(names(ix, clients.map((c) => c.id)))} can reach ${entrance.name}, but there is no sign-in or identity component, so every caller would be treated the same.`,
      fix: `Add an identity provider (sign-in and tokens) and have ${entrance.name} verify the token on every request.`,
      nodeIds: [entrance.id],
      action: { type: 'addAfter', label: `Add Cognito and connect ${entrance.name} to it`, from: entrance.id, component: { label: 'Cognito Auth', kind: 'service', icon: 'cognito', technology: 'AWS Cognito' }, relationship: 'validates tokens' },
      key: 'diagram',
    });
  }

  // 5. A public entrance with nothing in front of it.
  if (clients.length > 0 && gateways.length > 0 && !ix.nodes.some((n) => EDGE_PROTECTION.test(text(n)))) {
    add({
      rule: 'no-edge-protection',
      severity: 'low',
      category: 'Security',
      title: 'No firewall or CDN in front of the public entrance',
      why: `${gateways[0]!.name} is reachable by anyone on the internet and nothing filters abusive traffic before it arrives.`,
      fix: 'Put a web application firewall and/or a CDN in front of the gateway. It also takes load off your servers.',
      nodeIds: [gateways[0]!.id],
      key: 'diagram',
    });
  }

  // ---- Reliability ----
  // 6. Synchronous cycles.
  for (const group of synchronousCycles(ix)) {
    add({
      rule: 'circular-dependency',
      severity: 'high',
      category: 'Reliability',
      title: `${list(names(ix, group))} call each other in a loop`,
      why: `A slow or failing call anywhere in the loop can come back around and make every component in it slower, which is how small incidents turn into outages.`,
      fix: 'Break the loop: let one direction go through a queue or event, or move the shared logic into one component both can use.',
      nodeIds: group,
    });
  }

  // 7. Queues that nobody reads from, or nobody writes to.
  for (const q of queues) {
    const producers = ix.inn.get(q.id) ?? [];
    const consumers = ix.out.get(q.id) ?? [];
    if (producers.length > 0 && consumers.length === 0) {
      add({
        rule: 'queue-without-consumer',
        severity: 'high',
        category: 'Reliability',
        title: `Nothing reads from ${q.name}`,
        why: `${list(names(ix, producers))} ${verb(producers.length, 'sends', 'send')} messages to ${q.name}, but no component takes them out. They pile up until the queue fills or the messages expire, and the work never happens.`,
        fix: `Connect ${q.name} to the component that should process its messages (a worker or service).`,
        nodeIds: [q.id, ...producers],
      });
    } else if (consumers.length > 0 && producers.length === 0) {
      add({
        rule: 'queue-without-producer',
        severity: 'medium',
        category: 'Reliability',
        title: `Nothing sends to ${q.name}`,
        why: `${list(names(ix, consumers))} ${verb(consumers.length, 'waits', 'wait')} for messages from ${q.name}, but nothing in this diagram puts any there.`,
        fix: `Connect the component that creates the work to ${q.name}.`,
        nodeIds: [q.id, ...consumers],
      });
    }
  }

  // 8. One data store that many things depend on, with no standby.
  for (const db of databases) {
    const dependents = (ix.inn.get(db.id) ?? []).filter((id) => kindOf(id) !== 'DATABASE');
    const hasStandby = ix.nodes.some((n) => n.id !== db.id && REPLICA.test(text(n)) && (n.kind === 'DATABASE' || n.kind === 'STORAGE')) || REPLICA.test(text(db));
    if (dependents.length >= 2 && !hasStandby) {
      add({
        rule: 'database-single-point-of-failure',
        severity: dependents.length >= 3 ? 'high' : 'medium',
        category: 'Reliability',
        title: `${db.name} is a single point of failure for ${dependents.length} components`,
        why: `${list(names(ix, dependents))} all depend on ${db.name}. If it goes down, or a disk fails, all of them stop at once, and there is no second copy to switch to.`,
        fix: `Run ${db.name} with a standby or read replica in another zone (multi-AZ), and make sure backups are restored in a test now and then.`,
        nodeIds: [db.id, ...dependents],
      });
    }
  }

  // 9. Many components lean on one service, with no load balancing in sight.
  if (!ix.nodes.some((n) => LOAD_BALANCER.test(text(n)))) {
    for (const s of services) {
      const dependents = ix.inn.get(s.id) ?? [];
      if (dependents.length >= 3) {
        add({
          rule: 'service-fan-in',
          severity: 'medium',
          category: 'Reliability',
          title: `${dependents.length} components depend on ${s.name}`,
          why: `${list(names(ix, dependents))} all call ${s.name}. If it is slow or down, every one of them is affected, and a single instance cannot absorb all their traffic.`,
          fix: `Run several instances of ${s.name} behind a load balancer, and consider caching what the callers ask for most.`,
          nodeIds: [s.id, ...dependents],
        });
      }
    }
  }

  // 10. Third parties called directly.
  for (const ext of ofKind(ix, 'EXTERNAL')) {
    const callers = (ix.inn.get(ext.id) ?? []).filter((id) => kindOf(id) === 'SERVICE' || kindOf(id) === 'GATEWAY');
    if (callers.length > 0) {
      add({
        rule: 'external-dependency',
        severity: 'low',
        category: 'Reliability',
        title: `${list(names(ix, callers))} call${callers.length === 1 ? 's' : ''} ${ext.name} directly`,
        why: `You do not control ${ext.name}. When it is slow, whoever waits for it is slow too, and a long outage there becomes your outage.`,
        fix: `Set short timeouts and retries with back-off, and for work that can wait, hand it to a queue and let a worker call ${ext.name}.`,
        nodeIds: [ext.id, ...callers],
      });
    }
  }

  // ---- Performance and scalability ----
  // 11. Reads hitting the database from several places, no cache at all.
  for (const db of databases) {
    const readers = (ix.inn.get(db.id) ?? []).filter((id) => kindOf(id) === 'SERVICE');
    if (readers.length >= 2 && caches.length === 0) {
      add({
        rule: 'database-without-cache',
        severity: 'medium',
        category: 'Performance',
        title: `${list(names(ix, readers))} all read from ${db.name} with no cache`,
        why: `Every read goes all the way to ${db.name}. The same popular data is fetched again and again, which costs latency and limits how far ${db.name} can scale.`,
        fix: `Put a cache such as Redis in front of ${db.name} for data that is read often and changes rarely.`,
        nodeIds: [db.id, ...readers],
        action: { type: 'addAfter', label: `Add a Redis cache for ${readers[0] ? names(ix, [readers[0]])[0] : 'the service'}`, from: readers[0]!, component: { label: 'Redis Cache', kind: 'cache', icon: 'redis', technology: 'Amazon ElastiCache' }, relationship: 'reads (cache aside)' },
      });
    }
  }

  // 12. A database shared by many services.
  for (const db of databases) {
    const sharing = (ix.inn.get(db.id) ?? []).filter((id) => kindOf(id) === 'SERVICE');
    if (sharing.length >= 3) {
      add({
        rule: 'shared-database',
        severity: 'medium',
        category: 'Maintainability',
        title: `${sharing.length} services share ${db.name}`,
        why: `${list(names(ix, sharing))} read and write the same tables, so a schema change or a heavy query in one of them can break or slow down the others, and they cannot be released independently.`,
        fix: `Give each service ownership of its own data (its own database or schema) and let others ask it through its interface.`,
        nodeIds: [db.id, ...sharing],
      });
    }
  }

  // 13. A long chain of synchronous calls.
  const chain = longestChain(ix);
  if (chain.length >= 5) {
    add({
      rule: 'long-synchronous-chain',
      severity: 'medium',
      category: 'Performance',
      title: `A request passes through ${chain.length} services and gateways in a row`,
      why: `${list(names(ix, chain))}: each one waits for the next, so their delays add up and the whole request is only as reliable as all of them together.`,
      fix: 'Shorten the path: let steps that do not change the answer happen afterwards through a queue, and merge components that always change together.',
      nodeIds: chain,
      key: idsKey(chain),
    });
  }

  // 14. A service that calls several others itself, with no queue anywhere.
  if (queues.length === 0) {
    for (const s of services) {
      const targets = (ix.out.get(s.id) ?? []).filter((id) => kindOf(id) === 'SERVICE');
      if (targets.length >= 3) {
        add({
          rule: 'synchronous-fan-out',
          severity: 'medium',
          category: 'Scalability',
          title: `${s.name} calls ${targets.length} services itself`,
          why: `${s.name} waits for ${list(names(ix, targets))} to answer, so it is slow when any of them is, and fails when any of them fails. Adding another one makes it worse.`,
          fix: `Publish an event to a queue or event bus and let ${list(names(ix, targets))} react on their own, or call them in parallel with timeouts.`,
          nodeIds: [s.id, ...targets],
          action: { type: 'insertBetween', label: `Insert a queue between ${s.name} and ${names(ix, [targets[0]!])[0]}`, source: s.id, target: targets[0]!, component: { label: 'Task Queue', kind: 'queue', icon: 'sqs', technology: 'Amazon SQS' } },
        });
      }
    }
  }

  // 15. Files without a place to keep them.
  if (!ix.nodes.some((n) => n.kind === 'STORAGE')) {
    const handlers = ix.nodes.filter((n) => (n.kind === 'SERVICE' || n.kind === 'GATEWAY') && FILE_HANDLING.test(n.name));
    if (handlers.length > 0) {
      add({
        rule: 'files-without-object-storage',
        severity: 'medium',
        category: 'Scalability',
        title: `${list(names(ix, handlers.map((h) => h.id)))} seem${handlers.length === 1 ? 's' : ''} to handle files, but there is no object storage`,
        why: `Files kept on a server's own disk disappear when it is replaced and cannot be shared between instances, and large files slow the database down if they are stored there.`,
        fix: 'Keep uploads and generated files in object storage (such as S3), and store only their location in the database.',
        nodeIds: handlers.map((h) => h.id),
        action: { type: 'addAfter', label: `Add S3 storage for ${handlers[0]!.name}`, from: handlers[0]!.id, component: { label: 'S3 Storage', kind: 'storage', icon: 's3', technology: 'Amazon S3' }, relationship: 'stores files' },
      });
    }
  }

  // ---- Maintainability and observability ----
  // 16. Components connected to nothing.
  if (ix.nodes.length >= 3) {
    for (const n of ix.nodes) {
      if ((ix.out.get(n.id) ?? []).length === 0 && (ix.inn.get(n.id) ?? []).length === 0) {
        add({
          rule: 'unconnected-component',
          severity: 'low',
          category: 'Maintainability',
          title: `${n.name} is not connected to anything`,
          why: `A component with no connections either does nothing in this design or the connections are missing, and readers cannot tell which.`,
          fix: `Connect ${n.name} to what uses it or what it uses, or remove it.`,
          nodeIds: [n.id],
        });
      }
    }
  }

  // 17. No way to see what is happening in production.
  const operational = ix.nodes.filter((n) => n.kind === 'SERVICE' || n.kind === 'GATEWAY').length;
  if (operational >= 3 && !ix.nodes.some((n) => OBSERVABILITY.test(text(n)))) {
    add({
      rule: 'no-observability',
      severity: 'low',
      category: 'Observability',
      title: 'No monitoring or logging in the diagram',
      why: `With ${operational} services running, a failure will be noticed by users first unless something collects logs and metrics and raises alerts.`,
      fix: 'Add central logging, metrics and alerting (for example CloudWatch, Datadog or Prometheus with Grafana) and show where they collect from.',
      nodeIds: ix.nodes.filter((n) => n.kind === 'SERVICE' || n.kind === 'GATEWAY').map((n) => n.id),
      key: 'diagram',
    });
  }

  return findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.title.localeCompare(b.title));
}

/** One number to watch: 100 when nothing is flagged, lower with each finding according to how serious it is (never below 5). */
export function readinessScore(findings: readonly Finding[], componentCount: number): number {
  if (componentCount === 0) return 0;
  return Math.max(5, 100 - findings.reduce((sum, f) => sum + SEVERITY_COST[f.severity], 0));
}

export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
