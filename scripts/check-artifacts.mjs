// Release artifact scan (acceptance A30): the BUILT frontend must carry no provider, server or database secrets.
//   node scripts/check-artifacts.mjs [dist-dir]
// Two layers:
//  1. Shape: well-known secret shapes (Gemini/Google keys, Supabase secret keys, service_role, database URLs with a password,
//     private keys) and the NAMES of server-only settings must not appear anywhere in the bundle.
//  2. Value: the actual secret values from this machine's server env files (read in memory, NEVER printed) must not appear.
//     Locally this proves your real key is not in the bundle; in CI there are no such files, so only layer 1 runs.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** [label, pattern]. Patterns are deliberately specific to keep false positives out. */
export const SECRET_SHAPES = [
  ['Google/Gemini API key (AIza...)', /AIza[0-9A-Za-z_-]{30,}/],
  ['Gemini key (AQ.Ab...)', /\bAQ\.[A-Za-z0-9_-]{20,}/],
  ['Supabase secret key (sb_secret_...)', /sb_secret_[A-Za-z0-9_-]{10,}/],
  ['Supabase service_role', /service_role/],
  ['database URL with a password', /postgres(?:ql)?:\/\/[^\s:@'"]+:[^\s@'"]+@/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT-shaped service token', /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/],
];

/** Server-only setting names. Their presence in browser code means someone wired a server concern into the client. */
export const SERVER_ONLY_NAMES = ['GEMINI_API_KEY', 'DATABASE_URL', 'SUPABASE_SERVICE_ROLE', 'x-goog-api-key', 'WORKER_LEASE_SECONDS'];

/** Public browser settings that are allowed to ship (they are public by design). */
export const ALLOWED_VITE = new Set(['VITE_API_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_ENABLE_DEV_LOGIN', 'VITE_TURNSTILE_SITE_KEY']);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(js|mjs|css|html|json|map|txt|svg)$/.test(name)) yield full;
  }
}

/** Values that must never reach the browser, read from env files that exist on this machine. Returns [label, value] pairs. */
export function localSecretValues(rootDir = root) {
  const out = [];
  const SERVER_KEYS = /^(GEMINI_API_KEY|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ACCESS_TOKEN|KEY_ENCRYPTION_SECRET|KEY_ENCRYPTION_SECRET_PREVIOUS)$/;
  // The single root .env (server settings live there too), plus the old per-folder files while any still exist.
  for (const file of ['.env', 'server/.env', 'server/.env.supabase.local', '.env.supabase.local']) {
    const path = join(rootDir, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || !SERVER_KEYS.test(m[1])) continue;
      const value = m[2].replace(/^['"]|['"]$/g, '');
      if (value.length >= 8 && !/^\.{0,2}[\\/]/.test(value)) out.push([`${m[1]} from ${file}`, value]);
    }
  }
  // Any VITE_ value in the root .env that is not a known public setting is suspect (it ships in the bundle).
  const rootEnv = join(rootDir, '.env');
  if (existsSync(rootEnv)) {
    for (const line of readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !ALLOWED_VITE.has(m[1]) && m[2].length >= 8) out.push([`${m[1]} from .env (not an allowed public setting)`, m[2].replace(/^['"]|['"]$/g, '')]);
    }
  }
  return out;
}

/** Scan text and return findings as [file-independent label, detail]. Detail never contains the secret itself. */
export function scanText(text, secretValues = []) {
  const findings = [];
  for (const [label, re] of SECRET_SHAPES) if (re.test(text)) findings.push(label);
  for (const name of SERVER_ONLY_NAMES) if (text.includes(name)) findings.push(`server-only setting name "${name}"`);
  for (const [label, value] of secretValues) if (text.includes(value)) findings.push(`the real value of ${label}`);
  const embedded = new Set([...text.matchAll(/VITE_[A-Z0-9_]{3,}/g)].map((m) => m[0]));
  for (const name of embedded) if (!ALLOWED_VITE.has(name)) findings.push(`unexpected browser setting name "${name}"`);
  return findings;
}

export function scanDirectory(dir, secretValues = localSecretValues()) {
  const report = [];
  let count = 0;
  for (const file of files(dir)) {
    count += 1;
    const findings = scanText(readFileSync(file, 'utf8'), secretValues);
    for (const f of findings) report.push({ file: file.slice(dir.length + 1).replace(/\\/g, '/'), finding: f });
  }
  return { scanned: count, report, valuesChecked: secretValues.length };
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const dir = resolve(process.argv[2] ?? join(root, 'dist'));
  if (!existsSync(dir)) {
    console.error(`No build to scan at ${dir}. Run: npm run build`);
    process.exit(2);
  }
  const { scanned, report, valuesChecked } = scanDirectory(dir);
  if (report.length > 0) {
    console.error(`Artifact scan FAILED (${report.length} finding${report.length === 1 ? '' : 's'}):`);
    for (const r of report) console.error(`  - ${r.file}: ${r.finding}`);
    process.exit(1);
  }
  console.log(`Artifact scan passed: ${scanned} files, ${SECRET_SHAPES.length} secret shapes, ${SERVER_ONLY_NAMES.length} server-only names, ${valuesChecked} real local secret value${valuesChecked === 1 ? '' : 's'} checked.`);
}
