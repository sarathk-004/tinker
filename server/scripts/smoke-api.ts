/**
 * End-to-end critical path against a RUNNING API (release check, acceptance A31): no browser, no model, no key needed.
 *   npm run dev:db / dev:api (or the container preview), then:   npm run smoke:api -w @tinker/server
 * Walks the first working model demo and the safety properties that matter at release: sign-in, create, typed commands,
 * persistence after reload, idempotent replay, version conflict, restore, advice, access isolation, deletion, voice origin check.
 * It creates throw-away diagrams for two dev users and deletes them afterwards. Exit code 0 only if every check passed.
 */
import WebSocket from 'ws';
import { client, devLogin } from './support/http.ts';

const base = process.env.API_URL ?? 'http://127.0.0.1:8787';
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const anonymous = client(base);
const health = await anonymous('GET', '/health');
check(health.status === 200 && health.json?.status === 'ok', 'liveness', `HTTP ${health.status}`);
const ready = await anonymous('GET', '/health/ready');
check(ready.status === 200, 'readiness (database reachable)', `HTTP ${ready.status}`);
check((await anonymous('GET', '/v1/me')).status === 401, 'a protected route refuses anonymous callers');

const run = crypto.randomUUID().slice(0, 8);
const tokenA = await devLogin(base, `smoke-a-${run}@example.com`);
const tokenB = await devLogin(base, `smoke-b-${run}@example.com`);
const a = client(base, tokenA);
const b = client(base, tokenB);

const me = await a('GET', '/v1/me');
check(me.status === 200 && me.json.workspaces?.length >= 1, 'sign-in and personal workspace', JSON.stringify(me.json.features));
const workspaceId = me.json.workspaces[0].id as string;

const created = await a('POST', `/v1/workspaces/${workspaceId}/diagrams`, { name: `Smoke ${run}` });
check(created.status === 201, 'create a diagram', `HTTP ${created.status}`);
const id = created.json.diagramId as string;
let version = created.json.version as number;

const typed = async (text: string, expect = 200) => {
  const r = await a('POST', `/v1/diagrams/${id}/ai/command`, { expectedVersion: version, input: { type: 'TEXT', text } });
  if (r.status === 200 && r.json.status === 'APPLIED') version = r.json.diagram.version;
  check(r.status === expect, `typed command: "${text}"`, `${r.json?.status ?? r.json?.error?.code} via ${r.json?.source ?? '-'} in ${Math.round(r.ms)} ms`);
  return r;
};
await typed('add Orders');
await typed('add PostgreSQL');
await typed('connect Orders to PostgreSQL');
const insert = await typed('Put Redis between Orders and PostgreSQL');
const names = insert.json.diagram?.graph?.nodes?.map((n: { name: string }) => n.name) ?? [];
check(names.join(',') === 'Orders,PostgreSQL,Redis' && insert.json.diagram.graph.edges.length === 2, 'the gate command makes Orders -> Redis -> PostgreSQL', names.join(', '));

const redisId = insert.json.diagram.graph.nodes.find((n: { name: string }) => n.name === 'Redis').id as string;
const moved = await a('PATCH', `/v1/diagrams/${id}/presentation`, { expectedVersion: version, nodePositions: { [redisId]: { x: 420, y: 80 } } });
check(moved.status === 200, 'move a node and save', `version ${moved.json?.version}`);
version = moved.json.version;

const reload = await a('GET', `/v1/diagrams/${id}`);
check(reload.status === 200 && reload.json.version === version && reload.json.graph.nodes.length === 3 && reload.json.presentation.nodePositions[redisId].x === 420, 'reopen: same graph, positions and version (A05)');

const key = crypto.randomUUID();
const cmdBody = { expectedVersion: version, command: { type: 'ADD_NODE', node: { name: 'Kafka', kind: 'QUEUE' } } };
const first = await a('POST', `/v1/diagrams/${id}/commands`, cmdBody, { 'idempotency-key': key });
const again = await a('POST', `/v1/diagrams/${id}/commands`, cmdBody, { 'idempotency-key': key });
check(first.status === 200 && again.status === 200 && again.headers.get('idempotent-replayed') === 'true' && again.json.version === first.json.version, 'a retried request replays the stored answer (A08)');
version = first.json.version;
const reused = await a('POST', `/v1/diagrams/${id}/commands`, { ...cmdBody, expectedVersion: version }, { 'idempotency-key': key });
check(reused.status === 409 && reused.json.error.code === 'IDEMPOTENCY_KEY_REUSED', 'the same key with a different request is refused (A09)');

const stale = await a('POST', `/v1/diagrams/${id}/commands`, { expectedVersion: version - 1, command: { type: 'ADD_NODE', node: { name: 'Stale', kind: 'SERVICE' } } });
check(stale.status === 409 && stale.json.error.code === 'DIAGRAM_VERSION_CONFLICT', 'a stale write conflicts and overwrites nothing (A06)');

const ask = await a('POST', `/v1/diagrams/${id}/ai/ask`, { question: 'What happens if Orders goes down?' });
check(ask.status === 200 && ask.json.analysis.downstreamNodeIds.length >= 1, 'advice names the dependents and changes nothing', `source ${ask.json?.source}`);
check((await a('GET', `/v1/diagrams/${id}`)).json.version === version, 'advice did not change the version (A23)');

const revisions = await a('GET', `/v1/diagrams/${id}/revisions`);
check(revisions.status === 200 && revisions.json.revisions.length >= 5, 'version history lists the structural changes', `${revisions.json?.revisions?.length} versions`);
const beforeRedis = revisions.json.revisions.find((r: { nodeCount: number; edgeCount: number }) => r.nodeCount === 2 && r.edgeCount === 1);
const restored = await a('POST', `/v1/diagrams/${id}/restore`, { expectedVersion: version, version: beforeRedis.version });
check(restored.status === 200 && restored.json.version === version + 1 && restored.json.graph.nodes.length === 2, 'restore creates a NEW version with the old content (A26)', `v${version} -> v${restored.json?.version}`);
version = restored.json.version;

check((await b('GET', `/v1/diagrams/${id}`)).status === 404, "another user cannot see this diagram (A13)");
check((await b('GET', `/v1/diagrams/${id}/revisions`)).status === 404, "another user cannot see its history");
check((await b('POST', `/v1/diagrams/${id}/restore`, { expectedVersion: version, version: 1 })).status === 404, 'another user cannot restore it');

// Voice: the WebSocket must refuse a foreign origin and accept a hello from the owner.
const wsBase = base.replace(/^http/, 'ws');
const refused = await new Promise<string>((resolve) => {
  const ws = new WebSocket(`${wsBase}/v1/voice`, { headers: { origin: 'https://evil.example' } });
  ws.on('unexpected-response', (_req, res) => resolve(`HTTP ${res.statusCode}`));
  ws.on('open', () => (ws.close(), resolve('connected')));
  ws.on('error', () => resolve('error'));
});
check(refused === 'HTTP 403', 'voice refuses a foreign origin', refused);
const ready2 = await new Promise<string>((resolve) => {
  const ws = new WebSocket(`${wsBase}/v1/voice`, { headers: { origin } });
  const timer = setTimeout(() => (ws.close(), resolve('timeout')), 5000);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: tokenA, diagramId: id, version })));
  ws.on('message', (data: Buffer) => {
    const m = JSON.parse(data.toString('utf8'));
    if (m.type === 'ready') (clearTimeout(timer), ws.close(), resolve('ready'));
  });
  ws.on('close', (code: number) => (clearTimeout(timer), resolve(`closed ${code}`)));
  ws.on('error', () => resolve('error'));
});
check(ready2 === 'ready', 'voice session authenticates with a hello message (token never in the URL)', ready2);

const del = await a('DELETE', `/v1/diagrams/${id}?expectedVersion=${version}`);
check(del.status === 200, 'delete the diagram');
check((await a('GET', `/v1/diagrams/${id}`)).status === 404 && (await a('GET', `/v1/diagrams/${id}/revisions`)).status === 404, 'a deleted diagram is gone for its owner too');

console.log(failures === 0 ? 'Smoke check passed.' : `${failures} smoke check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
