/**
 * Live check of bring-your-own-key with the REAL model (no secrets printed). It starts its own API on PORT in `user` mode with NO
 * operator key at all (so nothing can possibly run on the operator's key), then plays a person who adds their own key.
 *   npm run check:byok -w @tinker/server            (reads the key to try from GEMINI_API_KEY in server/.env, only to send it to the local API)
 * Proves: without a key the model features are off but plain commands work; a bogus key is refused by Google; a real key is accepted,
 * stored ENCRYPTED (the database holds no readable key), and the person's free-form request runs on it; removing it switches AI off; and
 * the key appears nowhere in the API's logs.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { client, devLogin } from './support/http.ts';

const realKey = process.env.GEMINI_API_KEY;
if (!realKey) {
  console.error('GEMINI_API_KEY is not set (server/.env): it is only used as the key the simulated person pastes.');
  process.exit(2);
}
const port = Number(process.env.CHECK_PORT ?? 8798);
const base = `http://127.0.0.1:${port}`;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://tinker:tinker@localhost:54329/tinker';
let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const server = resolve(import.meta.dirname, '..');
const env: Record<string, string> = {
  PATH: process.env.PATH ?? '',
  SystemRoot: process.env.SystemRoot ?? '',
  NODE_ENV: 'development',
  AUTH_MODE: 'dev',
  AI_KEY_MODE: 'user',
  KEY_ENCRYPTION_SECRET: randomBytes(32).toString('base64'),
  DATABASE_URL: databaseUrl,
  PORT: String(port),
  LOG_LEVEL: 'info',
  // deliberately NO GEMINI_API_KEY: the operator has no key in this run
};
const child = spawn('npx', ['tsx', 'src/main.ts'], { cwd: server, env, shell: true });
let logs = '';
child.stdout.on('data', (d) => (logs += d));
child.stderr.on('data', (d) => (logs += d));
const stop = () => spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true });

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await fetch(`${base}/health`).then((r) => r.ok, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  check(up, 'API started in user mode with no operator key');

  const token = await devLogin(base, `byok-${crypto.randomUUID().slice(0, 8)}@example.com`);
  const api = client(base, token);
  const me0 = await api('GET', '/v1/me');
  check(me0.json.features.aiKey.mode === 'user' && me0.json.features.aiKey.source === 'NONE' && !me0.json.features.aiModel && !me0.json.features.voice && !me0.json.features.speech, 'before adding a key: free-form AI, voice and spoken replies are off', JSON.stringify(me0.json.features));

  const workspaceId = me0.json.workspaces[0].id as string;
  const created = await api('POST', `/v1/workspaces/${workspaceId}/diagrams`, { name: 'BYOK check (temporary)' });
  const id = created.json.diagramId as string;
  let version = created.json.version as number;
  const typed = async (text: string) => {
    const r = await api('POST', `/v1/diagrams/${id}/ai/command`, { expectedVersion: version, input: { type: 'TEXT', text } });
    if (r.status === 200 && r.json.status === 'APPLIED') version = r.json.diagram.version;
    return r;
  };
  const plain = await typed('add Orders');
  check(plain.status === 200 && plain.json.source === 'PARSER', 'a plain command still works without a key');
  await typed('add PostgreSQL');
  const freeForm = 'sprinkle some caching between the orders component and the postgresql database';
  const noKey = await typed(freeForm);
  check(noKey.status === 503 && noKey.json.error.code === 'AI_UNAVAILABLE', 'a free-form request is refused without a key (nothing runs on the operator\'s key)', `HTTP ${noKey.status}`);

  const bogus = await api('PUT', '/v1/me/ai-key', { apiKey: 'AIzaSy-this-key-does-not-exist-0000000000' });
  check(bogus.status === 422 && bogus.json.error.details.reason === 'API_KEY_INVALID', 'a bogus key is refused by Google and not stored', `HTTP ${bogus.status}`);

  const saved = await api('PUT', '/v1/me/ai-key', { apiKey: realKey });
  check(saved.status === 200 && saved.json.configured === true && saved.json.source === 'USER' && saved.json.last4 === realKey.slice(-4), 'the real key is accepted, checked with Google, and stored', `last four: ${saved.json.last4}`);
  check(!JSON.stringify(saved.json).includes(realKey) && !JSON.stringify((await api('GET', '/v1/me/ai-key')).json).includes(realKey), 'no API answer contains the key');

  const db = new pg.Client(databaseUrl);
  await db.connect();
  const row = (await db.query(`SELECT k.ciphertext, k.key_version FROM user_api_keys k JOIN users u ON u.id = k.user_id WHERE u.external_auth_id LIKE 'dev:byok-%' ORDER BY k.created_at DESC LIMIT 1`)).rows[0];
  const dump = JSON.stringify(row);
  check(!!row && !Buffer.from(row.ciphertext).toString('latin1').includes(realKey.slice(0, 12)) && !dump.includes(realKey), 'the database holds ciphertext only, no readable key', `${Buffer.from(row.ciphertext).length} bytes, key version ${row.key_version}`);

  const me1 = await api('GET', '/v1/me');
  check(me1.json.features.aiKey.source === 'USER' && me1.json.features.aiModel && me1.json.features.voice && me1.json.features.speech, 'with a key: free-form AI, voice and spoken replies are on', JSON.stringify(me1.json.features.aiKey));

  const started = Date.now();
  const live = await typed(freeForm);
  check(live.status === 200 && live.json.source === 'AI' && live.json.status === 'APPLIED', 'a free-form request runs on the person\'s own key (real model)', `${Date.now() - started} ms; ${live.json?.interpretation?.commands?.map((c: { summary: string }) => c.summary).join('; ') ?? live.json?.error?.message}`);

  const removed = await api('DELETE', '/v1/me/ai-key');
  check(removed.status === 200 && removed.json.configured === false, 'removing the key deletes it');
  const gone = (await db.query(`SELECT count(*)::int AS n FROM user_api_keys k JOIN users u ON u.id = k.user_id WHERE u.external_auth_id LIKE 'dev:byok-%' AND k.created_at > now() - interval '5 minutes'`)).rows[0].n;
  check(gone === 0, 'the row is gone from the database');
  const after = await typed('make the architecture more resilient with a message queue somewhere sensible');
  check(after.status === 503, 'after removal the model features are off again', `HTTP ${after.status}`);
  await db.end();

  await api('DELETE', `/v1/diagrams/${id}?expectedVersion=${version}`);
  check(!logs.includes(realKey) && !logs.includes(env.KEY_ENCRYPTION_SECRET), 'neither the key nor the master secret appears anywhere in the API\'s logs', `${logs.split('\n').length} log lines`);
} finally {
  stop();
}
console.log(failures === 0 ? 'Bring-your-own-key check passed.' : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
