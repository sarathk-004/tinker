/**
 * Development-only preview of I3 (login, saved diagrams, safe retries, stale-write protection).
 * Served by Vite at /api-demo.html; not part of the production build. It talks to the real local API and database.
 * Types come from the contracts door only (src/contracts).
 */
import type { CommandResponse, DiagramDetail, DiagramListResponse, DiagramCommand, ErrorEnvelope, MeResponse } from '../contracts';
import { renderDiagram } from './diagram-svg';

const API = `http://${location.hostname}:8787`;
const TOKEN_KEY = 'tinker_dev_token';
const LAST_KEY = 'tinker_dev_last_diagram';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const safeGet = (k: string) => { try { return sessionStorage.getItem(k) ?? localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string, persistent = false) => { try { (persistent ? localStorage : sessionStorage).setItem(k, v); } catch { /* storage unavailable */ } };
const safeDel = (k: string) => { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch { /* ignore */ } };

interface Api<T> { status: number; json: T | ErrorEnvelope; replayed: boolean }
interface SentRequest { method: string; path: string; body?: unknown; key?: string; quiet?: boolean }

let token = safeGet(TOKEN_KEY);
let me: MeResponse | null = null;
let current: DiagramDetail | null = null;
let lastMutation: SentRequest | null = null;
let fresh = new Set<string>();

function setStatus(kind: 'ok' | 'bad' | 'idle', text: string) {
  const el = $('status');
  el.className = `status ${kind}`;
  el.textContent = text;
}

async function api<T>(req: SentRequest): Promise<Api<T>> {
  if (req.method !== 'GET') lastMutation = req;
  const headers: Record<string, string> = {};
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (req.body !== undefined) headers['content-type'] = 'application/json';
  if (req.key) headers['idempotency-key'] = req.key;
  const res = await fetch(`${API}${req.path}`, { method: req.method, headers, ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}) });
  const json = (await res.json()) as T | ErrorEnvelope;
  const replayed = res.headers.get('idempotent-replayed') === 'true' || (typeof json === 'object' && json !== null && (json as { replayed?: boolean }).replayed === true);
  if (!req.quiet) $('sent').textContent = `${req.method} ${req.path}${req.key ? `\nIdempotency-Key: ${req.key}` : ''}${req.body !== undefined ? `\n\n${JSON.stringify(req.body, null, 2)}` : ''}`;
  if (!req.quiet) $('answer').textContent = `HTTP ${res.status}${replayed ? '  (Idempotent-Replayed: true)' : ''}\n\n${JSON.stringify(json, null, 2)}`;
  if (res.status === 401) signOut('The API rejected this sign-in. Dev login tokens only work with npm run dev:api; Supabase tokens only with npm run dev:api:supabase. Sign in again.');
  return { status: res.status, json, replayed };
}

const isError = (j: unknown): j is ErrorEnvelope => typeof j === 'object' && j !== null && 'error' in j;
const describe = (e: ErrorEnvelope) => `${e.error.code}${(e.error.details as { reason?: string } | undefined)?.reason ? ' / ' + (e.error.details as { reason?: string }).reason : ''}: ${e.error.message}`;

function render() {
  const signedIn = Boolean(token && me);
  $('auth-in').style.display = signedIn ? 'none' : 'block';
  $('auth-out').style.display = signedIn ? 'block' : 'none';
  if (me) {
    $('who').textContent = me.user.email ?? me.user.id;
    $('ws').textContent = me.workspaces.map((w) => `${w.name} (${w.role})`).join(', ');
  }
  $('d-name').textContent = current?.name ?? '—';
  $('d-version').textContent = current ? String(current.version) : '—';
  $('d-id').textContent = current?.diagramId ?? '—';
  renderDiagram($('canvas') as unknown as SVGSVGElement, current, fresh);
  for (const id of ['add-orders', 'add-pg', 'connect', 'insert', 'drag', 'rename', 'retry', 'stale', 'reload', 'delete']) {
    ($(id) as HTMLButtonElement).disabled = !current;
  }
  ($('new') as HTMLButtonElement).disabled = !signedIn;
}

function signOut(message: string) {
  token = null;
  me = null;
  current = null;
  safeDel(TOKEN_KEY);
  setStatus('idle', message);
  $('list').innerHTML = '';
  render();
}

const nodeByName = (name: string) => current?.graph.nodes.find((n) => n.name === name);
const workspaceId = () => me?.workspaces.find((w) => w.personal)?.id ?? me?.workspaces[0]?.id;

async function refreshList() {
  const ws = workspaceId();
  if (!ws) return;
  const res = await api<DiagramListResponse>({ method: 'GET', path: `/v1/workspaces/${ws}/diagrams`, quiet: true });
  const list = $('list');
  list.innerHTML = '';
  if (isError(res.json)) return setStatus('bad', describe(res.json));
  for (const d of res.json.diagrams) {
    const li = document.createElement('li');
    if (d.id === current?.diagramId) li.className = 'active';
    const b = document.createElement('button');
    b.innerHTML = `${d.name}<small>version ${d.version} · updated ${new Date(d.updatedAt).toLocaleTimeString()}</small>`;
    b.onclick = () => void openDiagram(d.id);
    li.appendChild(b);
    list.appendChild(li);
  }
  if (res.json.diagrams.length === 0) list.innerHTML = '<li style="color:var(--muted)">No diagrams yet.</li>';
}

async function openDiagram(id: string, note?: string) {
  const res = await api<DiagramDetail>({ method: 'GET', path: `/v1/diagrams/${id}` });
  if (isError(res.json)) {
    current = null;
    safeDel(LAST_KEY);
    render();
    return setStatus('bad', describe(res.json));
  }
  current = res.json;
  fresh = new Set();
  safeSet(LAST_KEY, id, true);
  setStatus('ok', note ?? `Loaded “${current.name}” from the database at version ${current.version}.`);
  render();
  await refreshList();
}

async function afterSession() {
  const res = await api<MeResponse>({ method: 'GET', path: '/v1/me' });
  if (isError(res.json)) return;
  me = res.json;
  render();
  await refreshList();
  const lastId = safeGet(LAST_KEY);
  if (lastId) await openDiagram(lastId, undefined);
  else setStatus('ok', `Signed in as ${me.user.email}. Create a diagram to begin.`);
}

/** Send a structural command with a fresh idempotency key against the version we currently hold. */
async function sendCommand(command: DiagramCommand, label: string, opts: { version?: number; key?: string } = {}) {
  if (!current) return;
  const before = new Set(current.graph.nodes.map((n) => n.id));
  const res = await api<CommandResponse>({
    method: 'POST',
    path: `/v1/diagrams/${current.diagramId}/commands`,
    body: { expectedVersion: opts.version ?? current.version, command },
    key: opts.key ?? crypto.randomUUID(),
  });
  if (isError(res.json)) return setStatus('bad', `Refused: ${describe(res.json)}. Nothing was changed.`);
  const r = res.json;
  current = { ...current, version: r.version, graph: r.graph, presentation: r.presentation };
  fresh = new Set(r.graph.nodes.filter((n) => !before.has(n.id)).map((n) => n.id));
  setStatus('ok', `${label}. Saved as version ${r.version}.`);
  render();
  await refreshList();
}

$('login').onclick = async () => {
  const email = ($('email') as HTMLInputElement).value.trim();
  try {
    const res = await fetch(`${API}/dev/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    const json = await res.json();
    if (!res.ok) return setStatus('bad', json?.error?.message ?? 'Login failed.');
    token = json.token as string;
    safeSet(TOKEN_KEY, token);
    await afterSession();
  } catch {
    setStatus('bad', `Cannot reach the API at ${API}. Start it with: npm run dev:api (and the database: npm run dev:db -w @tinker/server).`);
  }
};
$('logout').onclick = () => signOut('Signed out.');

// Real Supabase sign-in (password grant). The publishable key is designed to be public; the password is typed by the user
// and sent only to Supabase. The API then verifies the returned JWT against Supabase's published signing keys.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://rnwbgjrzbliqvqradjcm.supabase.co';
const envKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (envKey) ($('sb-key') as HTMLInputElement).value = envKey;
$('sb-login').onclick = async () => {
  const apikey = ($('sb-key') as HTMLInputElement).value.trim();
  const email = ($('sb-email') as HTMLInputElement).value.trim();
  const password = ($('sb-password') as HTMLInputElement).value;
  if (!apikey || !email || !password) return setStatus('bad', 'Enter the publishable key, email and password.');
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    ($('sb-password') as HTMLInputElement).value = '';
    if (!res.ok || !json.access_token) return setStatus('bad', `Supabase refused the sign-in: ${json.error_description ?? json.msg ?? res.status}`);
    token = json.access_token as string;
    safeSet(TOKEN_KEY, token);
    await afterSession();
  } catch {
    setStatus('bad', 'Could not reach Supabase.');
  }
};

$('new').onclick = async () => {
  const ws = workspaceId();
  if (!ws) return;
  const res = await api<DiagramDetail>({ method: 'POST', path: `/v1/workspaces/${ws}/diagrams`, body: { name: `Diagram ${new Date().toLocaleTimeString()}` }, key: crypto.randomUUID() });
  if (isError(res.json)) return setStatus('bad', describe(res.json));
  current = res.json;
  fresh = new Set();
  safeSet(LAST_KEY, current.diagramId, true);
  setStatus('ok', `Created “${current.name}” (version 1) and saved it in the database.`);
  render();
  await refreshList();
};

$('add-orders').onclick = () => sendCommand({ type: 'ADD_NODE', node: { name: 'Orders', kind: 'SERVICE', technology: 'Node.js' } }, 'Added Orders');
$('add-pg').onclick = () => sendCommand({ type: 'ADD_NODE', node: { name: 'PostgreSQL', kind: 'DATABASE', technology: 'PostgreSQL' } }, 'Added PostgreSQL');
$('connect').onclick = () => {
  const o = nodeByName('Orders'), p = nodeByName('PostgreSQL');
  if (!o || !p) return setStatus('bad', 'Add both Orders and PostgreSQL first.');
  return sendCommand({ type: 'CONNECT', sourceNodeId: o.id, targetNodeId: p.id, relationship: 'SQL' }, 'Connected Orders → PostgreSQL');
};
$('insert').onclick = () => {
  const o = nodeByName('Orders'), p = nodeByName('PostgreSQL');
  if (!o || !p) return setStatus('bad', 'Add and connect Orders and PostgreSQL first.');
  return sendCommand({ type: 'INSERT_BETWEEN', sourceNodeId: o.id, targetNodeId: p.id, node: { name: 'Redis', kind: 'CACHE', technology: 'Redis' } }, 'Inserted Redis between Orders and PostgreSQL');
};

$('drag').onclick = async () => {
  const o = nodeByName('Orders');
  if (!current || !o) return setStatus('bad', 'Add an “Orders” node first.');
  const at = current.presentation.nodePositions[o.id] ?? { x: 0, y: 0 };
  const res = await api<DiagramDetail>({ method: 'PATCH', path: `/v1/diagrams/${current.diagramId}/presentation`, body: { expectedVersion: current.version, nodePositions: { [o.id]: { x: at.x, y: at.y + 40 } } }, key: crypto.randomUUID() });
  if (isError(res.json)) return setStatus('bad', `Refused: ${describe(res.json)}`);
  current = res.json;
  fresh = new Set();
  setStatus('ok', `Position saved as version ${current.version} (no history entry for a drag).`);
  render();
};

$('rename').onclick = async () => {
  if (!current) return;
  const res = await api<DiagramDetail>({ method: 'PATCH', path: `/v1/diagrams/${current.diagramId}`, body: { expectedVersion: current.version, name: `Renamed ${new Date().toLocaleTimeString()}` }, key: crypto.randomUUID() });
  if (isError(res.json)) return setStatus('bad', `Refused: ${describe(res.json)}`);
  current = res.json;
  setStatus('ok', `Renamed. Saved as version ${current.version}.`);
  render();
  await refreshList();
};

$('retry').onclick = async () => {
  if (!lastMutation || !lastMutation.key || !current) return setStatus('bad', 'Make an edit first, then retry it.');
  const heldVersion = current.version;
  const res = await api<CommandResponse>({ ...lastMutation });
  if (isError(res.json)) return setStatus('bad', `Retry answer: ${describe(res.json)}`);
  setStatus('ok', res.replayed
    ? `The server recognised the same Idempotency-Key and returned the ORIGINAL result (version ${res.json.version}); nothing was applied a second time. The server is still at version ${heldVersion}.`
    : 'The retry was applied as a new request.');
};

$('stale').onclick = async () => {
  if (!current) return;
  if (current.version < 2) return setStatus('bad', 'Make one edit first so there is an older version to send.');
  await sendCommand({ type: 'ADD_NODE', node: { name: 'Stale edit', kind: 'GENERIC' } }, 'Stale edit', { version: current.version - 1 });
};

$('reload').onclick = () => current && openDiagram(current.diagramId);

$('delete').onclick = async () => {
  if (!current) return;
  const res = await api<unknown>({ method: 'DELETE', path: `/v1/diagrams/${current.diagramId}?expectedVersion=${current.version}`, key: crypto.randomUUID() });
  if (isError(res.json)) return setStatus('bad', `Refused: ${describe(res.json)}`);
  setStatus('ok', `Deleted “${current.name}” (kept in the database as a soft delete).`);
  current = null;
  safeDel(LAST_KEY);
  render();
  await refreshList();
};

render();
if (token) void afterSession().catch(() => signOut('Cannot reach the API. Is it running?'));
