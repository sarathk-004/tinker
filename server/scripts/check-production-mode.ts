/**
 * Starts the API exactly as production would (NODE_ENV=production, real Supabase token verification, exact allowed origins, no
 * development routes) against a database you point it at, and checks what must be true of a deployed instance. No credentials are
 * needed beyond a reachable DATABASE_URL (default: the local dev database) and the public SUPABASE_URL.
 *   npm run check:production -w @tinker/server            (local database)
 *   npm run check:production:supabase -w @tinker/server   (your Supabase database, certificate VERIFIED with server/certs/supabase-ca.crt)
 * It starts its own server process on PORT (default 8799) and stops it afterwards. Nothing is written to the database.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const port = Number(process.env.CHECK_PORT ?? 8799);
const base = `http://127.0.0.1:${port}`;
const allowed = 'https://app.tinker.example';
// The local development database, unless CHECK_TARGET=env (check:production:supabase) asks for the database in the .env file.
const databaseUrl = process.env.CHECK_TARGET === 'env' && process.env.DATABASE_URL ? process.env.DATABASE_URL : 'postgres://tinker:tinker@localhost:54329/tinker';
const supabaseUrl = process.env.SUPABASE_URL ?? 'https://rnwbgjrzbliqvqradjcm.supabase.co';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const server = resolve(import.meta.dirname, '..');
const env = {
  PATH: process.env.PATH ?? '',
  SystemRoot: process.env.SystemRoot ?? '',
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: String(port),
  LOG_LEVEL: 'warn',
  DATABASE_URL: databaseUrl,
  DATABASE_SSL: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1') ? 'off' : 'verify',
  ...(process.env.DATABASE_SSL_CA_FILE ? { DATABASE_SSL_CA_FILE: process.env.DATABASE_SSL_CA_FILE } : {}),
  SUPABASE_URL: supabaseUrl,
  CORS_ORIGINS: allowed,
  // Production defaults to "people bring their own AI key", which needs the secret that seals stored keys.
  KEY_ENCRYPTION_SECRET: randomBytes(32).toString('base64'),
};
// 1. Misconfiguration must be refused loudly, never half-started.
const bad = spawn('npx', ['tsx', 'src/main.ts'], { cwd: server, env: { PATH: env.PATH, SystemRoot: env.SystemRoot, NODE_ENV: 'production' }, shell: true });
let badOutput = '';
bad.stderr.on('data', (d) => (badOutput += d));
const badCode = await new Promise<number | null>((r) => bad.on('exit', r));
check(badCode !== 0 && /CORS_ORIGINS/.test(badOutput) && /DATABASE_URL/.test(badOutput) && /SUPABASE_URL/.test(badOutput), 'production refuses to start without CORS_ORIGINS, DATABASE_URL and SUPABASE_URL', `exit ${badCode}`);
const wild = spawn('npx', ['tsx', 'src/main.ts'], { cwd: server, env: { ...env, CORS_ORIGINS: '*' }, shell: true });
let wildOutput = '';
wild.stderr.on('data', (d) => (wildOutput += d));
check((await new Promise<number | null>((r) => wild.on('exit', r))) !== 0 && /wildcards are not allowed/.test(wildOutput), 'a wildcard CORS origin is refused');
const dev = spawn('npx', ['tsx', 'src/main.ts'], { cwd: server, env: { ...env, AUTH_MODE: 'dev' }, shell: true });
let devOutput = '';
dev.stderr.on('data', (d) => (devOutput += d));
check((await new Promise<number | null>((r) => dev.on('exit', r))) !== 0 && /AUTH_MODE/.test(devOutput), 'development login cannot be switched on in production');

const noSecret = spawn('npx', ['tsx', 'src/main.ts'], { cwd: server, env: { ...env, KEY_ENCRYPTION_SECRET: '' }, shell: true });
let noSecretOutput = '';
noSecret.stderr.on('data', (d) => (noSecretOutput += d));
check((await new Promise<number | null>((r) => noSecret.on('exit', r))) !== 0 && /KEY_ENCRYPTION_SECRET/.test(noSecretOutput), 'production refuses to start without the secret that seals stored API keys');

// 2. A correctly configured instance.
const child = spawn('npx', ['tsx', 'src/main.ts'], { cwd: server, env, shell: true });
const stop = () => spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true });
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await fetch(`${base}/health`).then((r) => r.ok, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  check(up, 'starts with a production configuration');
  const ready = await fetch(`${base}/health/ready`);
  check(ready.status === 200, 'readiness reaches the database');

  const unauth = await fetch(`${base}/v1/me`);
  check(unauth.status === 401, 'a protected route refuses anonymous callers');
  const forged = await fetch(`${base}/v1/me`, { headers: { authorization: 'Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IngifQ.eyJzdWIiOiJ4IiwiYXVkIjoiYXV0aGVudGljYXRlZCIsImV4cCI6OTk5OTk5OTk5OX0.AAAA' } });
  check(forged.status === 401, 'a forged token is refused (signature checked against the project keys)');

  const devLogin = await fetch(`${base}/dev/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@example.com' }) });
  check(devLogin.status === 404, 'the development login does not exist in production', `HTTP ${devLogin.status}`);
  const engine = await fetch(`${base}/dev/engine/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check(engine.status === 404, 'the unauthenticated engine preview does not exist in production', `HTTP ${engine.status}`);

  const okOrigin = await fetch(`${base}/health`, { headers: { origin: allowed } });
  check(okOrigin.headers.get('access-control-allow-origin') === allowed, 'the configured web origin is allowed by CORS');
  const evil = await fetch(`${base}/health`, { headers: { origin: 'https://evil.example' } });
  check(evil.headers.get('access-control-allow-origin') === null, 'any other origin gets no CORS permission');
  const preflight = await fetch(`${base}/v1/me`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
  check(preflight.headers.get('access-control-allow-origin') === null, 'a preflight from another origin is not approved');

  const wsEvil = await new Promise<string>((resolveWs) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/voice`, { headers: { origin: 'https://evil.example' } });
    ws.on('unexpected-response', (_q, res) => resolveWs(`HTTP ${res.statusCode}`));
    ws.on('open', () => (ws.close(), resolveWs('connected')));
    ws.on('error', () => resolveWs('error'));
  });
  check(wsEvil === 'HTTP 403', 'the voice WebSocket refuses a foreign origin', wsEvil);
  const wsOk = await new Promise<string>((resolveWs) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/voice`, { headers: { origin: allowed } });
    const timer = setTimeout(() => (ws.close(), resolveWs('timeout')), 6000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: 'x'.repeat(40), diagramId: crypto.randomUUID(), version: 1 })));
    ws.on('close', (code: number) => (clearTimeout(timer), resolveWs(`closed ${code}`)));
  });
  check(wsOk === 'closed 4401', 'a voice hello with a bad token is closed as unauthenticated', wsOk);
} finally {
  stop();
}
console.log(failures === 0 ? 'Production-mode check passed.' : `${failures} production-mode check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
