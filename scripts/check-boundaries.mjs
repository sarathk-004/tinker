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
// Supabase publishable keys are public by design (sb_publishable_...), so VITE_*PUBLISHABLE* names are allowed.
const secretish = /VITE_(?![A-Z0-9_]*PUBLISHABLE)[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD)/;
const exempt = new Set([
  // Legacy prototype path; removed in I4/I7 ("no browser secret remains in the new production path").
  'src/vite-env.d.ts',
  '.env.example',
  'src/ai/orchestrator.ts',
  'src/ai/geminiVoice.ts',
  'src/ai/geminiLive.ts',
  'src/components/SettingsModal.tsx',
  'src/components/VoiceControl.tsx',
]);
const strict = process.argv.includes('--strict');
const legacy = [];
for (const file of [...walk(join(root, 'src')), join(root, '.env.example'), join(root, 'server', '.env.example')]) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (secretish.test(text)) {
    const rel = relative(root, file).split(sep).join('/');
    (exempt.has(rel) && !strict ? legacy : violations).push(`${rel}: VITE_* secret variable`);
  }
}

if (legacy.length > 0) {
  console.warn(`Known legacy browser-secret references (to be removed in I4/I7; run with --strict to fail):\n  ${legacy.join('\n  ')}`);
}
if (violations.length > 0) {
  console.error(`Boundary violations:\n  ${violations.join('\n  ')}`);
  process.exit(1);
}
console.log('Boundary check passed.');
