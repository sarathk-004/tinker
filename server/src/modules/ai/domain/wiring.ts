import type { GraphNode } from '@tinker/shared';
import type { DiagramDoc } from '../../diagrams/domain/index.ts';

/**
 * Wiring knowledge: how the components of a typical system are connected, written as rules. Given components with no (or few) connections it
 * proposes the missing ones: clients reach the edge, the edge reaches the gateway, the gateway reaches the services, services use caches, databases,
 * storage and queues, queues feed workers, and services report to monitoring. Pure and deterministic: the same diagram always gives the same answer,
 * every connection comes with the reason for it, and nothing here needs a model, a key or any training data.
 */
export type Role = 'client' | 'edge' | 'entry' | 'auth' | 'service' | 'worker' | 'cache' | 'database' | 'storage' | 'queue' | 'external' | 'monitor' | 'secrets' | 'other';

export interface ProposedEdge {
  source: string;
  target: string;
  relationship: string;
}

export interface WiringResult {
  edges: ProposedEdge[];
  /** Components that still have no connection at all (the rules could not tell where they belong). */
  unplaced: string[];
  /** Where the rules had to guess between equally good options (names did not say), so the person can check. */
  guessed: string[];
}

const MAX_NEW_EDGES = 40;

const text = (n: GraphNode) => `${n.name} ${n.technology ?? ''} ${typeof n.metadata['icon'] === 'string' ? n.metadata['icon'] : ''}`.toLowerCase();
const has = (s: string, re: RegExp) => re.test(s);

/** What part a component plays, from its kind and what it is called (names beat nothing; kinds beat names where they are clear). */
export function roleOf(n: GraphNode): Role {
  const t = text(n);
  if (n.kind === 'CLIENT') return 'client';
  if (has(t, /cloudfront|\bcdn\b|route ?53|\bdns\b|\bwaf\b|shield|\bedge\b/)) return 'edge';
  if (n.kind === 'GATEWAY' || has(t, /gateway|load ?balancer|\balb\b|\belb\b|nginx|ingress|reverse proxy/)) return 'entry';
  if (n.kind === 'CACHE') return 'cache';
  if (n.kind === 'DATABASE') return 'database';
  if (n.kind === 'STORAGE') return 'storage';
  if (n.kind === 'QUEUE') return 'queue';
  if (n.kind === 'EXTERNAL') return 'external';
  if (has(t, /cloudwatch|x-?ray|grafana|prometheus|monitor|observab|datadog|sentry|logging|tracing/)) return 'monitor';
  if (has(t, /secrets? manager|\bkms\b|\bvault\b|parameter store|\biam\b/)) return 'secrets';
  if (has(t, /cognito|\bauth|identity|oauth|\bsso\b|keycloak|login/)) return 'auth';
  if (has(t, /worker|consumer|processor|\bjobs?\b|cron|scheduler|batch|\betl\b|pipeline/)) return 'worker';
  if (n.kind === 'SERVICE') return 'service';
  return 'other';
}

const GENERIC = new Set(['service', 'services', 'db', 'database', 'cache', 'store', 'the', 'api', 'main', 'primary', 'queue', 'worker', 'amazon', 'aws', 'app', 'server']);
const words = (n: GraphNode) => new Set(n.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC.has(w)));
const shares = (a: GraphNode, b: GraphNode) => {
  const wb = words(b);
  return [...words(a)].some((w) => wb.has(w));
};

/** Things that go together by what they are for, even when the names share no word: a payment provider and the billing service, an email provider and notifications. */
const PURPOSE: ReadonlyArray<readonly [RegExp, readonly RegExp[]]> = [
  [/stripe|paypal|braintree|adyen|razorpay|payment|pay/, [/bill|invoice|subscription/, /pay|checkout/, /order/]],
  [/twilio|sendgrid|mailgun|ses|email|sms|push|notification/, [/notif|alert|message/, /email|mail/, /worker/]],
  [/search|algolia|opensearch|elastic/, [/search/, /catalog|product|discover/]],
  [/upload|media|image|asset|s3|bucket/, [/media|upload|image|asset/, /file|content|product/]],
  [/user|account|profile|identity/, [/user|account|profile|member|customer/]],
];

function dataLabel(n: GraphNode): string {
  const t = text(n);
  if (has(t, /dynamo|mongo|document|keyspaces|nosql/)) return 'reads and writes';
  if (has(t, /opensearch|elastic|search/)) return 'search';
  if (has(t, /postgres|mysql|rds|aurora|sql|maria|redshift/)) return 'SQL';
  return 'reads and writes';
}

export function suggestWiring(doc: DiagramDoc): WiringResult {
  const nodes = doc.graph.nodes;
  const byRole = (r: Role) => nodes.filter((n) => roleOf(n) === r);
  const clients = byRole('client');
  const edges = byRole('edge');
  const entries = byRole('entry');
  const auths = byRole('auth');
  const services = byRole('service');
  const workers = byRole('worker');
  const caches = byRole('cache');
  const databases = byRole('database');
  const storages = byRole('storage');
  const queues = byRole('queue');
  const externals = byRole('external');
  const monitors = byRole('monitor');
  const secrets = byRole('secrets');

  const linked = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const e of doc.graph.edges) linked.add(key(e.sourceNodeId, e.targetNodeId));
  const touched = new Set<string>();
  for (const e of doc.graph.edges) {
    touched.add(e.sourceNodeId);
    touched.add(e.targetNodeId);
  }

  const out: ProposedEdge[] = [];
  const guessed: string[] = [];
  const link = (a: GraphNode, b: GraphNode, relationship: string) => {
    if (a.id === b.id || out.length >= MAX_NEW_EDGES || linked.has(key(a.id, b.id))) return;
    linked.add(key(a.id, b.id));
    touched.add(a.id);
    touched.add(b.id);
    out.push({ source: a.id, target: b.id, relationship });
  };

  /** The services a component belongs with: those sharing a word in the name, else (with a note) the one its position in the list suggests. */
  const owners = (target: GraphNode, pool: GraphNode[], index: number): GraphNode[] => {
    if (pool.length <= 1) return pool;
    const named = pool.filter((s) => shares(s, target));
    if (named.length > 0) return named;
    const t = text(target);
    for (const [what, wants] of PURPOSE) {
      if (!has(t, what)) continue;
      for (const want of wants) {
        const fits = pool.filter((s) => has(text(s), want));
        if (fits.length > 0) return fits;
      }
    }
    guessed.push(`${target.name} with ${pool[index % pool.length]!.name}`);
    return [pool[index % pool.length]!];
  };

  const apps = services.length > 0 ? services : workers; // what the front door leads to

  // 1. People reach the system through its first hop.
  const firstHop = edges[0] ?? entries[0] ?? (auths.length > 0 && apps.length === 0 ? auths[0] : undefined) ?? apps[0];
  if (firstHop) for (const c of clients) link(c, firstHop, 'HTTPS');

  // 2. The edge (CDN, DNS, firewall) passes traffic to the gateway or load balancer, else straight to the services.
  for (const [i, e] of edges.entries()) {
    if (entries.length > 0) link(e, entries[i % entries.length]!, 'forwards requests');
    else for (const s of apps) link(e, s, 'forwards requests');
  }

  // 3. The gateway reaches the services; with several gateways the services are shared out between them.
  if (entries.length === 1) for (const s of apps) link(entries[0]!, s, 'routes requests');
  else entries.forEach((en, i) => apps.filter((_, j) => j % entries.length === i).forEach((s) => link(en, s, 'routes requests')));
  if (entries.length === 0 && edges.length === 0 && clients.length > 0) for (const c of clients) for (const s of apps.slice(0, 1)) link(c, s, 'HTTPS');

  // 4. Sign-in sits beside the front door.
  const door = entries[0] ?? edges[0] ?? clients[0];
  if (door) for (const a of auths) link(door, a, 'authenticates users');
  if (!door && apps[0]) for (const a of auths) link(apps[0], a, 'authenticates users');

  // 5. Services use the databases: one database serves them all; several are matched by name, else shared out (and said so).
  databases.forEach((db, i) => {
    const users = databases.length === 1 ? apps : owners(db, apps, i);
    for (const s of users) link(s, db, dataLabel(db));
  });

  // 6. A cache sits beside the services that use a database (cache-aside).
  const dbUsers = apps.filter((s) => databases.some((db) => linked.has(key(s.id, db.id))));
  caches.forEach((c, i) => {
    const users = caches.length === 1 ? (dbUsers.length > 0 ? dbUsers : apps) : owners(c, dbUsers.length > 0 ? dbUsers : apps, i);
    for (const s of users) link(s, c, 'caches reads');
  });

  // 7. Object storage: used by one service, or by those named alike; every service when there are only a few.
  storages.forEach((st, i) => {
    const users = apps.length <= 3 ? apps : owners(st, apps, i);
    for (const s of users) link(s, st, 'stores files');
  });

  // 8. Queues: services publish, workers consume (without workers, the last service consumes what the others publish).
  queues.forEach((q, i) => {
    const consumers = workers.length > 0 ? workers : apps.length >= 2 ? [apps[apps.length - 1]!] : [];
    const producers = apps.filter((s) => !consumers.includes(s));
    const mine = queues.length === 1 ? producers : owners(q, producers.length > 0 ? producers : apps, i);
    for (const p of mine) link(p, q, 'publishes events');
    for (const c of consumers) link(q, c, 'delivers events');
  });

  // 9. Workers write their results to the data store when nothing else gives them a place.
  for (const w of workers) {
    if (apps !== workers && !touched.has(w.id) && databases[0]) link(w, databases[0], dataLabel(databases[0]));
  }

  // 10. Third-party services are called by the service that talks to them.
  externals.forEach((x, i) => {
    const users = apps.length <= 1 ? apps : owners(x, apps, i).slice(0, 1);
    for (const s of users) link(s, x, 'calls the API');
  });

  // 11. Monitoring watches the front door and the services (at most six, to keep the picture readable); secrets are read by the services.
  const watched = [...entries.slice(0, 1), ...apps].slice(0, 6);
  for (const m of monitors) for (const s of watched) link(s, m, 'sends metrics and logs');
  for (const sec of secrets) for (const s of apps.slice(0, 6)) link(s, sec, 'reads secrets');

  const unplaced = nodes.filter((n) => !touched.has(n.id)).map((n) => n.name);
  return { edges: out, unplaced, guessed: [...new Set(guessed)] };
}

/** One sentence about the pattern that was used, for the reply. */
export const WIRING_EXPLANATION = 'I followed the usual layout: clients reach the edge or gateway, the gateway reaches the services, services use the cache, database, storage and queues, queues feed workers, and services report to monitoring.';
