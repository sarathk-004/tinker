/**
 * Development-only preview of the I2 diagram engine (served by Vite at /engine-demo.html, not part of the
 * production build). Stateless: the document lives in this page; the local API applies one command at a time.
 * Types come from the contracts door only (src/contracts).
 */
import type { DiagramCommand, ErrorEnvelope, Graph, Presentation } from '../contracts';
import { renderDiagram } from './diagram-svg';

interface Doc {
  graph: Graph;
  presentation: Presentation;
}

const API = `http://${location.hostname}:8787`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let doc: Doc | null = null;
let freshIds = new Set<string>();

async function call<T>(path: string, init?: { body: unknown }): Promise<{ status: number; json: T | ErrorEnvelope }> {
  const res = await fetch(`${API}${path}`, init
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }
    : undefined);
  return { status: res.status, json: (await res.json()) as T | ErrorEnvelope };
}

function setStatus(kind: 'ok' | 'bad' | 'idle', text: string) {
  const el = $('status');
  el.className = `status ${kind}`;
  el.textContent = text;
}

function show(sent: unknown, answer: unknown) {
  $('sent').textContent = JSON.stringify(sent, null, 2);
  $('answer').textContent = JSON.stringify(answer, null, 2);
}

const nodeByName = (name: string) => doc?.graph.nodes.find((n) => n.name === name);

function render() {
  renderDiagram($('canvas') as unknown as SVGSVGElement, doc, freshIds);
}

async function apply(command: DiagramCommand, label: string) {
  if (!doc) return setStatus('bad', 'Load the sample first.');
  const body = { graph: doc.graph, presentation: doc.presentation, command };
  const { status, json } = await call<Doc & { appliedCommand: { type: string } }>('/dev/engine/apply', { body: { ...body } });
  show(command, json);
  if ('error' in json) {
    const reason = (json.error.details as { reason?: string } | undefined)?.reason;
    setStatus('bad', `Refused (${status}${reason ? ', ' + reason : ''}): ${json.error.message} The diagram was not changed.`);
    return;
  }
  const before = new Set(doc.graph.nodes.map((n) => n.id));
  doc = { graph: json.graph, presentation: json.presentation };
  freshIds = new Set(doc.graph.nodes.filter((n) => !before.has(n.id)).map((n) => n.id));
  setStatus('ok', `Applied: ${label}. Now ${doc.graph.nodes.length} nodes, ${doc.graph.edges.length} connections.`);
  render();
}

$('load').onclick = async () => {
  try {
    const { json } = await call<Doc>('/dev/engine/sample');
    doc = json as Doc;
    freshIds = new Set();
    show('GET /dev/engine/sample', json);
    setStatus('ok', 'Loaded Orders → PostgreSQL.');
    render();
  } catch {
    setStatus('bad', `Cannot reach the API at ${API}. Start it with: npm run dev:api (NODE_ENV=development).`);
  }
};

$('insert').onclick = () => {
  const o = nodeByName('Orders'), p = nodeByName('PostgreSQL');
  if (!o || !p) return setStatus('bad', 'Orders and PostgreSQL are not both present (load the sample first).');
  return apply({ type: 'INSERT_BETWEEN', sourceNodeId: o.id, targetNodeId: p.id, node: { name: 'Redis', kind: 'CACHE', technology: 'Redis' } }, 'Redis inserted between Orders and PostgreSQL');
};

$('insert-again').onclick = () => {
  const o = nodeByName('Orders'), p = nodeByName('PostgreSQL');
  if (!o || !p) return setStatus('bad', 'Load the sample first.');
  // PostgreSQL -> Orders has no connection in this direction, so inserting there must be refused.
  return apply({ type: 'INSERT_BETWEEN', sourceNodeId: p.id, targetNodeId: o.id, node: { name: 'Kafka', kind: 'QUEUE' } }, 'insert');
};

$('remove-redis').onclick = () => {
  const r = nodeByName('Redis');
  if (!r) return setStatus('bad', 'There is no Redis node yet. Run step 2 first.');
  return apply({ type: 'REMOVE_NODE', nodeId: r.id }, 'Redis removed (no automatic reconnection)');
};

$('add').onclick = () => apply({ type: 'ADD_NODE', node: { name: 'Queue', kind: 'QUEUE', technology: 'SQS' } }, 'Queue added');

$('connect-dupe').onclick = () => {
  const o = nodeByName('Orders'), p = nodeByName('PostgreSQL');
  if (!o || !p) return setStatus('bad', 'Orders and PostgreSQL are not both present.');
  return apply({ type: 'CONNECT', sourceNodeId: o.id, targetNodeId: p.id, relationship: 'SQL' }, 'connect');
};

$('downstream').onclick = async () => {
  const o = nodeByName('Orders');
  if (!doc || !o) return setStatus('bad', 'Load the sample first.');
  const { json } = await call<{ downstream: string[] }>('/dev/engine/downstream', { body: { graph: doc.graph, nodeId: o.id } });
  show({ nodeId: o.id, name: 'Orders' }, json);
  if ('error' in json) return setStatus('bad', json.error.message);
  const names = json.downstream.map((id) => doc?.graph.nodes.find((n) => n.id === id)?.name ?? id);
  freshIds = new Set(json.downstream);
  setStatus('ok', names.length ? `Downstream of Orders: ${names.join(' → ')}` : 'Nothing is downstream of Orders.');
  render();
};

$('remove-ghost').onclick = () =>
  apply({ type: 'REMOVE_NODE', nodeId: '00000000-0000-4000-8000-00000000dead' }, 'remove');

render();
