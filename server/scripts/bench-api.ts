/**
 * Latency measurement against a RUNNING API with an explicit workload (release plan I9: "report misses rather than assuming goals").
 *   npm run bench:api -w @tinker/server        (API_URL=... to point at a hosted API running with AUTH_MODE=dev)
 *   BENCH_USERS=20 BENCH_ITER=5 are the defaults: 20 dev users, each does 5 rounds per phase of the operation mix.
 * Two phases over the SAME workload: sequential (one request at a time: best case) and concurrent (all users at once).
 * Targets come from the design (Phase 1): 300 ms for reads and writes, 500 ms for opening a diagram. The report states where each
 * number was measured (API address, machine) because a laptop talking to a local database says nothing about a hosted region.
 * It creates one throw-away diagram per dev user and deletes them at the end. Model calls are not part of this workload.
 */
import os from 'node:os';
import { percentile } from '../src/infrastructure/observability/log-report.ts';
import { client, devLogin } from './support/http.ts';

const base = process.env.API_URL ?? 'http://127.0.0.1:8787';
const users = Number(process.env.BENCH_USERS ?? 20);
// Each dev user may send 120 requests a minute (the API's own limit); stay well under it so no request is refused.
const iterations = Number(process.env.BENCH_ITER ?? 5);
const SEED_NODES = 20;

interface Op {
  name: string;
  /** Target in ms (design goal), and whether it counts as "open a diagram" (500 ms) or an ordinary request (300 ms). */
  target: number;
}
const OPS: Op[] = [
  { name: 'open diagram (GET /diagrams/:id)', target: 500 },
  { name: 'list diagrams', target: 300 },
  { name: 'version history (GET /revisions)', target: 300 },
  { name: 'manual edit: add node', target: 300 },
  { name: 'manual edit: remove node', target: 300 },
  { name: 'save positions (PATCH /presentation)', target: 300 },
  { name: 'typed command, parser (rename)', target: 300 },
  { name: 'restore a version', target: 300 },
];

interface Player {
  call: ReturnType<typeof client>;
  workspaceId: string;
  diagramId: string;
  version: number;
  nodeIds: string[];
  oldVersion: number;
}

async function setup(index: number): Promise<Player> {
  const token = await devLogin(base, `bench-${index}-${crypto.randomUUID().slice(0, 6)}@example.com`);
  const call = client(base, token);
  const me = await call('GET', '/v1/me');
  const workspaceId = me.json.workspaces[0].id as string;
  const created = await call('POST', `/v1/workspaces/${workspaceId}/diagrams`, { name: `Bench ${index}` });
  let version = created.json.version as number;
  const nodeIds: string[] = [];
  let oldVersion = version;
  for (let i = 0; i < SEED_NODES; i++) {
    const r = await call('POST', `/v1/diagrams/${created.json.diagramId}/commands`, { expectedVersion: version, command: { type: 'ADD_NODE', node: { name: `Service ${i}`, kind: 'SERVICE' } } });
    version = r.json.version;
    nodeIds.push(r.json.graph.nodes.at(-1).id);
  }
  oldVersion = version; // the fully seeded diagram: restoring it never removes the nodes the workload positions
  return { call, workspaceId, diagramId: created.json.diagramId, version, nodeIds, oldVersion };
}

type Samples = Map<string, number[]>;
let errors = 0;
const failed = new Map<string, number>();
/** Only SUCCESSFUL requests are timed: a fast refusal (for example a rate limit) must never flatter the percentiles. */
const record = (samples: Samples, op: string, ms: number, ok: boolean) => {
  if (!ok) {
    errors += 1;
    failed.set(op, (failed.get(op) ?? 0) + 1);
    return;
  }
  (samples.get(op) ?? samples.set(op, []).get(op)!).push(ms);
};

/** One round of the mix for one user. Each write uses the version the previous one produced (a real client's queue does the same). */
async function round(p: Player, samples: Samples, n: number): Promise<void> {
  const d = `/v1/diagrams/${p.diagramId}`;
  let r = await p.call('GET', d);
  record(samples, OPS[0]!.name, r.ms, r.status === 200);
  p.version = r.json.version ?? p.version;
  r = await p.call('GET', `/v1/workspaces/${p.workspaceId}/diagrams`);
  record(samples, OPS[1]!.name, r.ms, r.status === 200);
  r = await p.call('GET', `${d}/revisions?limit=50`);
  record(samples, OPS[2]!.name, r.ms, r.status === 200);
  r = await p.call('POST', `${d}/commands`, { expectedVersion: p.version, command: { type: 'ADD_NODE', node: { name: `Extra ${n}`, kind: 'CACHE' } } });
  record(samples, OPS[3]!.name, r.ms, r.status === 200);
  p.version = r.json.version ?? p.version;
  const extra = r.json.graph?.nodes?.at(-1)?.id as string;
  r = await p.call('POST', `${d}/commands`, { expectedVersion: p.version, command: { type: 'REMOVE_NODE', nodeId: extra } });
  record(samples, OPS[4]!.name, r.ms, r.status === 200);
  p.version = r.json.version ?? p.version;
  r = await p.call('PATCH', `${d}/presentation`, { expectedVersion: p.version, nodePositions: { [p.nodeIds[n % SEED_NODES]!]: { x: 100 + n, y: 50 + n } } });
  record(samples, OPS[5]!.name, r.ms, r.status === 200);
  p.version = r.json.version ?? p.version;
  r = await p.call('POST', `${d}/ai/command`, { expectedVersion: p.version, input: { type: 'TEXT', text: `rename Service 0 to Renamed ${n}` } });
  record(samples, OPS[6]!.name, r.ms, r.status === 200);
  p.version = r.json.diagram?.version ?? p.version;
  if (n % 3 === 0) {
    r = await p.call('POST', `${d}/restore`, { expectedVersion: p.version, version: p.oldVersion });
    record(samples, OPS[7]!.name, r.ms, r.status === 200 || r.status === 422); // 422 ALREADY_CURRENT after the first restore is fine
    if (r.status === 200) p.version = r.json.version;
    else {
      const head = await p.call('GET', d);
      p.version = head.json.version;
    }
  }
}

function table(title: string, samples: Samples): { misses: string[] } {
  console.log(`\n${title}`);
  console.log('  operation'.padEnd(44) + 'n'.padStart(5) + 'p50'.padStart(8) + 'p95'.padStart(8) + 'p99'.padStart(8) + 'max'.padStart(8) + '  target(p95)');
  const misses: string[] = [];
  for (const op of OPS) {
    const ms = samples.get(op.name) ?? [];
    if (ms.length === 0) continue;
    const p95 = Math.round(percentile(ms, 95));
    const verdict = p95 <= op.target ? 'ok' : 'MISS';
    if (verdict === 'MISS') misses.push(`${op.name}: p95 ${p95} ms > ${op.target} ms`);
    console.log(`  ${op.name.padEnd(42)}${String(ms.length).padStart(5)}${String(Math.round(percentile(ms, 50))).padStart(8)}${String(p95).padStart(8)}${String(Math.round(percentile(ms, 99))).padStart(8)}${String(Math.round(Math.max(...ms))).padStart(8)}  ${op.target} ms ${verdict}`);
  }
  return { misses };
}

console.log(`workload: ${users} users x ${iterations} rounds of ${OPS.length} operations, ${SEED_NODES}-node diagrams`);
console.log(`measured from: ${os.hostname()} (${os.cpus()[0]?.model.trim()}, ${os.cpus().length} cores, ${os.platform()}) to ${new URL(base).host}`);
const ping = await client(base)('GET', '/health');
const pings: number[] = [];
for (let i = 0; i < 15; i++) pings.push((await client(base)('GET', '/health')).ms);
console.log(`network baseline (GET /health, no database): p50 ${Math.round(percentile(pings, 50))} ms, p95 ${Math.round(percentile(pings, 95))} ms${ping.status === 200 ? '' : ' (health check failed!)'}`);
const readyMs: number[] = [];
for (let i = 0; i < 15; i++) readyMs.push((await client(base)('GET', '/health/ready')).ms);
console.log(`database baseline (GET /health/ready = SELECT 1): p50 ${Math.round(percentile(readyMs, 50))} ms, p95 ${Math.round(percentile(readyMs, 95))} ms`);

const players: Player[] = [];
for (let i = 0; i < users; i++) players.push(await setup(i));

const sequential: Samples = new Map();
for (let n = 0; n < iterations; n++) for (const p of players) await round(p, sequential, n);
const seq = table('PHASE 1: sequential (one request at a time)', sequential);

const concurrent: Samples = new Map();
await Promise.all(
  players.map(async (p) => {
    for (let n = 0; n < iterations; n++) await round(p, concurrent, n + iterations);
  }),
);
const conc = table(`PHASE 2: concurrent (${users} users at once)`, concurrent);

for (const p of players) await p.call('DELETE', `/v1/diagrams/${p.diagramId}?expectedVersion=${(await p.call('GET', `/v1/diagrams/${p.diagramId}`)).json.version}`);

const misses = [...seq.misses.map((m) => `sequential ${m}`), ...conc.misses.map((m) => `concurrent ${m}`)];
console.log(`
requests that failed and were NOT timed: ${errors}${errors ? ` (${[...failed].map(([k, v]) => `${k} x${v}`).join('; ')})` : ''}`);
console.log(misses.length === 0 ? 'All p95 targets met for this workload and location.' : `Targets missed (${misses.length}):\n${misses.map((m) => `  - ${m}`).join('\n')}`);
process.exit(errors === 0 ? 0 : 1);
