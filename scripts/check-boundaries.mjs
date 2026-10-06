#!/usr/bin/env node
// Contract boundary check (architecture invariant: frontend never imports backend logic).
//   src/     (browser)  may import @tinker/shared only; never server/ or node:* built-ins
//   shared/             may import zod only; never server/, src/, react, node:* built-ins
//   server/             may import @tinker/shared; never src/ (frontend code)
// Also fails if a frontend env var could carry a provider secret into the browser bundle.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = /\.(ts|tsx|mts|js|jsx|mjs)$/;
const SKIP = new Set(['node_modules', 'dist', 'graphify-out', '.git']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXT.test(name)) yield full;
  }
}

function specifiers(source) {
  const found = [];
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of source.matchAll(re)) found.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return found;
}

const rules = [
  {
    dir: 'src',
    forbid: (spec, fileDir) =>
      spec.startsWith('node:') ||
      /^@tinker\/server(\/|$)/.test(spec) ||
      (spec.startsWith('.') && isInside(resolve(fileDir, spec), join(root, 'server'))) ||
      (spec.startsWith('.') && isInside(resolve(fileDir, spec), join(root, 'shared')) && 'import @tinker/shared, not relative paths'),
  },
  {
    dir: 'shared',
    forbid: (spec, fileDir) =>
      spec.startsWith('node:') ||
      /^(react|react-dom|fastify|pg|@xyflow\/react|zustand)(\/|$)/.test(spec) ||
      /^@tinker\/server(\/|$)/.test(spec) ||
      (spec.startsWith('.') && !isInside(resolve(fileDir, spec), join(root, 'shared'))),
  },
  {
    dir: 'server',
    forbid: (spec, fileDir) =>
      /^(react|react-dom|@xyflow\/react|zustand)(\/|$)/.test(spec) ||
      (spec.startsWith('.') && !isInside(resolve(fileDir, spec), join(root, 'server'))),
  },
];

function isInside(path, dir) {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel));
}

const violations = [];
for (const { dir, forbid } of rules) {
  const base = join(root, dir);
  for (const file of walk(base)) {
    const fileDir = dirname(file);
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      const verdict = forbid(spec, fileDir);
      if (verdict) {
        violations.push(`${relative(root, file)}: forbidden import "${spec}"${typeof verdict === 'string' ? ` (${verdict})` : ''}`);
      }
    }
  }
}

// Secrets must not be exposed through VITE_* variables (committed examples and typings).
// Supabase publishable keys are public by design (sb_publishable_...), so VITE_*PUBLISHABLE* names are allowed, and so is the
// Cloudflare Turnstile SITE key (VITE_TURNSTILE_SITE_KEY: it is rendered in the page; the SECRET key lives only in Supabase).
// Everything else that looks like a secret must never be exposed to the browser bundle.
const secretish = /VITE_(?![A-Z0-9_]*(PUBLISHABLE|TURNSTILE_SITE_KEY))[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD)/;
for (const file of [...walk(join(root, 'src')), join(root, '.env.example'), join(root, 'server', '.env.example')]) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const rel = relative(root, file).split(sep).join('/');
  if (secretish.test(text)) violations.push(`${rel}: VITE_* secret variable`);
}

// No direct AI-provider calls or SDKs in the browser (Gemini credentials and SDK usage stay server-side).
const providerInBrowser = /generativelanguage\.googleapis\.com|@google\/genai|@google\/generative-ai/;
for (const file of walk(join(root, 'src'))) {
  if (providerInBrowser.test(readFileSync(file, 'utf8'))) {
    violations.push(relative(root, file).split(sep).join('/') + ': direct AI provider access from the browser');
  }
}

// Never alias or spread the whole `import.meta.env` object: Vite would embed every VITE_* variable (including stale secrets).
const wholeEnv = /import\.meta\.env(?![.\w])/;
for (const file of walk(join(root, 'src'))) {
  if (wholeEnv.test(readFileSync(file, 'utf8'))) violations.push(relative(root, file).split(sep).join('/') + ': uses the whole import.meta.env object (reference each VITE_ variable by name)');
}

if (violations.length > 0) {
  console.error(['Boundary violations:', ...violations.map((v) => `  ${v}`)].join('\n'));
  process.exit(1);
}
console.log('Boundary check passed.');
