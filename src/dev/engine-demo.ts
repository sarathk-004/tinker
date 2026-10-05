/**
 * Development-only preview of the I2 diagram engine (served by Vite at /engine-demo.html, not part of the
 * production build). Stateless: the document lives in this page; the local API applies one command at a time.
 * Types come from the contracts door only (src/contracts).
 */
import type { DiagramCommand, ErrorEnvelope, Graph, Presentation } from '../contracts';

interface Doc {
  graph: Graph;
  presentation: Presentation;
}

const API = `http://${location.hostname}:8787`;
const NODE_W = 220;
const NODE_H = 90;

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
  const svg = $('canvas') as unknown as SVGSVGElement;
  svg.innerHTML = '';
  if (!doc || doc.graph.nodes.length === 0) {
    svg.setAttribute('viewBox', '0 0 600 120');
    svg.innerHTML = '<text x="300" y="64" text-anchor="middle" fill="#6b6a60">Empty diagram</text>';
    return;
  }
  const pos = doc.presentation.nodePositions;
  const xs = doc.graph.nodes.map((n) => pos[n.id]?.x ?? 0);
  const ys = doc.graph.nodes.map((n) => pos[n.id]?.y ?? 0);
  const minX = Math.min(...xs) - 30;
  const minY = Math.min(...ys) - 30;
  const w = Math.max(...xs) + NODE_W + 30 - minX;
  const h = Math.max(...ys) + NODE_H + 30 - minY;
  svg.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`);

  const ns = 'http://www.w3.org/2000/svg';
  const make = (tag: string, attrs: Record<string, string>, text?: string) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  svg.innerHTML = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="#26251e"/></marker></defs>';

  for (const edge of doc.graph.edges) {
    const s = pos[edge.sourceNodeId];
    const t = pos[edge.targetNodeId];
    if (!s || !t) continue;
    const x1 = s.x + NODE_W, y1 = s.y + NODE_H / 2, x2 = t.x, y2 = t.y + NODE_H / 2;
    svg.appendChild(make('path', { class: 'edge', d: `M${x1} ${y1} C${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`, 'marker-end': 'url(#arrow)' }));
    if (edge.relationship) svg.appendChild(make('text', { class: 'edge-label', x: String((x1 + x2) / 2), y: String((y1 + y2) / 2 - 6), 'text-anchor': 'middle' }, edge.relationship));
  }
  for (const node of doc.graph.nodes) {
    const p = pos[node.id];
    if (!p) continue;
    const g = make('g', { class: `node${freshIds.has(node.id) ? ' new' : ''}`, transform: `translate(${p.x} ${p.y})` });
    g.appendChild(make('rect', { width: String(NODE_W), height: String(NODE_H) }));
    g.appendChild(make('text', { class: 'name', x: '14', y: '36' }, node.name));
    g.appendChild(make('text', { class: 'meta', x: '14', y: '58' }, `${node.kind}${node.technology ? ' · ' + node.technology : ''}`));
    svg.appendChild(g);
  }
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
