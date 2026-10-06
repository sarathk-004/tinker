/**
 * End-to-end live check of voice THROUGH THE RUNNING API (no microphone): a Gemini text-to-speech model speaks, the audio goes
 * over a real WebSocket to POST-auth /v1/voice, the server relays it to Gemini Live, and the resulting edit is committed to the
 * real database. Needs the API running with a Gemini key and local dev login:
 *   npm run dev:db  /  npm run dev:api  /  then:  npm run check:voice:api
 * It creates a throw-away diagram for dev user voice-check@example.com and deletes it afterwards. The key is never printed.
 */
import WebSocket from 'ws';
import { loadConfig } from '../src/infrastructure/config/config.ts';
import { synthesizeSpeech, withTrailingSilence } from './support/speech.ts';

const base = process.env.API_URL ?? 'http://127.0.0.1:8787';
const origin = 'http://localhost:5173';
const config = loadConfig({ ...process.env, NODE_ENV: 'development' });
if (!config.ai.apiKey) {
  console.error('GEMINI_API_KEY is not set (server/.env).');
  process.exit(2);
}
const key = config.ai.apiKey;

const api = async (token: string | null, method: string, path: string, body?: unknown, idem = true) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(idem && method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json().catch(() => undefined)) as any };
};

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const login = await api(null, 'POST', '/dev/auth/login', { email: 'voice-check@example.com' }, false);
if (login.status !== 200) {
  console.error(`dev login failed (HTTP ${login.status}). Is the API running in dev mode (npm run dev:api)?`);
  process.exit(2);
}
const token: string = login.json.token;
const me = await api(token, 'GET', '/v1/me');
check(me.json?.features?.voice === true, 'the API advertises voice', JSON.stringify(me.json?.features));
const workspaceId = me.json.workspaces[0].id as string;

const created = await api(token, 'POST', `/v1/workspaces/${workspaceId}/diagrams`, { name: 'Voice check (temporary)' });
const diagramId = created.json.diagramId as string;
let version = created.json.version as number;
for (const text of ['add Orders', 'add PostgreSQL', 'connect Orders to PostgreSQL']) {
  const r = await api(token, 'POST', `/v1/diagrams/${diagramId}/ai/command`, { expectedVersion: version, input: { type: 'TEXT', text } });
  version = r.json.diagram.version;
}

const messages: any[] = [];
const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/v1/voice`, { headers: { origin } });
ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString('utf8'))));
const closed = new Promise<number>((resolve) => ws.on('close', (code: number) => resolve(code)));
const waitFor = async (predicate: (m: any) => boolean, ms: number, what: string) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const found = messages.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}; got [${messages.map((m) => m.type).join(', ')}]`);
};
await new Promise<void>((resolve, reject) => (ws.on('open', resolve), ws.on('error', reject)));

try {
  ws.send(JSON.stringify({ type: 'hello', token, diagramId, version }));
  await waitFor((m) => m.type === 'ready', 5000, 'ready');
  ws.send(JSON.stringify({ type: 'start' }));
  await waitFor((m) => m.type === 'listening', 15000, 'listening');
  check(true, 'connected, authenticated and the model is listening');

  async function say(text: string, expectKind: 'EDIT' | 'ASK') {
    const { pcm, model } = await synthesizeSpeech(key, text);
    const before = messages.length;
    const bytes = withTrailingSilence(pcm);
    for (let i = 0; i < bytes.length; i += 3200) {
      ws.send(bytes.subarray(i, Math.min(bytes.length, i + 3200)));
      await new Promise((r) => setTimeout(r, 60));
    }
    const result = await waitFor((m) => m.type === 'result' && messages.indexOf(m) >= before, 30_000, `a result for "${text}"`);
    const heard = messages.slice(before).filter((m) => m.type === 'transcript' && m.final).map((m) => m.text).join(' ');
    console.log(`  spoke (${model}): "${text}"  heard: "${heard}"`);
    check(result.result.status === 'OK' && result.result.kind === expectKind, `"${text}" -> ${expectKind} result`, result.result.status === 'OK' ? result.result.response.status ?? 'answered' : result.result.error?.message);
    return result.result;
  }

  const edit = await say('Put Redis between Orders and PostgreSQL.', 'EDIT');
  if (edit.status === 'OK') {
    version = edit.response.diagram.version;
    ws.send(JSON.stringify({ type: 'context', version }));
    const stored = await api(token, 'GET', `/v1/diagrams/${diagramId}`);
    const names = stored.json.graph.nodes.map((n: { name: string }) => n.name);
    check(names.includes('Redis') && names.length === 3 && stored.json.version === version, 'the edit is in the database as ONE new version', `${names.join(', ')}; version ${stored.json.version}`);
  }
  const ask = await say('What happens if Orders goes down?', 'ASK');
  if (ask.status === 'OK') {
    const stored = await api(token, 'GET', `/v1/diagrams/${diagramId}`);
    check(stored.json.version === version, 'the question changed nothing', `version ${stored.json.version}`);
    // The answer can be read aloud with the Gemini voice (the server accepts only the id of a stored assistant message).
    const reply = [...ask.response.messages].reverse().find((m: { role: string }) => m.role === 'ASSISTANT');
    const started = Date.now();
    const spoken = await api(token, 'POST', `/v1/diagrams/${diagramId}/ai/speak`, { messageId: reply.id }, false);
    const seconds = spoken.json?.audio ? (Buffer.from(spoken.json.audio, 'base64').length / 2 / spoken.json.sampleRate).toFixed(1) : '0';
    check(spoken.status === 200 && Number(seconds) > 0.5, 'the answer is read aloud by the Gemini voice', `${seconds} s of audio at ${spoken.json?.sampleRate} Hz in ${Date.now() - started} ms`);
    const stranger = await api(token, 'POST', `/v1/diagrams/${diagramId}/ai/speak`, { messageId: '00000000-0000-4000-8000-000000000999' }, false);
    check(stranger.status === 404, 'an unknown message id is refused', `HTTP ${stranger.status}`);
  }
} catch (error) {
  failures++;
  console.log(`FAIL  ${(error as Error).message.split(key).join('[key]')}`);
} finally {
  ws.close();
  await Promise.race([closed, new Promise((r) => setTimeout(r, 1000))]);
  await api(token, 'DELETE', `/v1/diagrams/${diagramId}?expectedVersion=${version}`);
}
console.log(failures === 0 ? 'Voice end-to-end check passed.' : `${failures} check(s) failed. Share the lines above (they contain no key).`);
process.exit(failures === 0 ? 0 : 1);
