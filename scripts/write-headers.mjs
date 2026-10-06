// Post-build step: add a Content-Security-Policy to dist/_headers that names exactly the origins this build talks to.
//   node scripts/write-headers.mjs        (run by `npm run build`)
// The browser may only load scripts from this site, and may only connect to this site, the API, Supabase (and the optional bot check).
// That is the main defence against injected script stealing the sign-in session. Origins come from the same VITE_* settings the
// build used (the environment, then the root .env), so the policy cannot drift from the code.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function readPublicSettings(env = process.env, rootDir = root) {
  const settings = {};
  const file = join(rootDir, '.env');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(VITE_(?:API_URL|SUPABASE_URL|TURNSTILE_SITE_KEY))\s*=\s*(.*?)\s*$/.exec(line);
      if (m) settings[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  for (const key of ['VITE_API_URL', 'VITE_SUPABASE_URL', 'VITE_TURNSTILE_SITE_KEY']) if (env[key]) settings[key] = env[key];
  return settings;
}

const origin = (value) => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

export function buildPolicy(settings) {
  const connect = new Set(["'self'"]);
  const api = origin(settings.VITE_API_URL || 'http://localhost:8787');
  if (api) {
    connect.add(api);
    connect.add(api.replace(/^http/, 'ws')); // the voice WebSocket
  }
  const supabase = origin(settings.VITE_SUPABASE_URL ?? '');
  if (supabase) connect.add(supabase);
  const turnstile = settings.VITE_TURNSTILE_SITE_KEY ? 'https://challenges.cloudflare.com' : null;
  if (turnstile) connect.add(turnstile);
  return [
    "default-src 'self'",
    `script-src 'self'${turnstile ? ` ${turnstile}` : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // React Flow positions nodes with inline styles
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    `connect-src ${[...connect].join(' ')}`,
    `frame-src ${turnstile ?? "'none'"}`,
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** Insert the policy as the first header of the catch-all block (creating the block when the file has none). */
export function withPolicy(headersFile, policy) {
  const line = `  Content-Security-Policy: ${policy}`;
  if (/^\/\*\s*$/m.test(headersFile)) return headersFile.replace(/^\/\*\s*$/m, (m) => `${m}\n${line}`);
  return `/*\n${line}\n\n${headersFile}`;
}

/**
 * The same policy as a <meta> tag inside index.html, so it applies on hosts that cannot read a _headers file (Vercel reads
 * vercel.json at deploy time, before this build knows its origins). A meta policy cannot carry `frame-ancestors` (browsers ignore it
 * there); framing is refused by the X-Frame-Options header instead (vercel.json / _headers).
 */
export function withMetaPolicy(html, policy) {
  const withoutFraming = policy.split('; ').filter((d) => !d.startsWith('frame-ancestors')).join('; ');
  const tag = `<meta http-equiv="Content-Security-Policy" content="${withoutFraming.replace(/"/g, '&quot;')}" />`;
  const cleaned = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/g, '');
  return cleaned.replace(/<head>/i, (m) => `${m}
    ${tag}`);
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const file = join(root, 'dist', '_headers');
  if (!existsSync(file)) {
    console.error('dist/_headers is missing: run vite build first.');
    process.exit(2);
  }
  const policy = buildPolicy(readPublicSettings());
  writeFileSync(file, withPolicy(readFileSync(file, 'utf8').replace(/^ {2}Content-Security-Policy:.*\r?\n/m, ''), policy));
  const index = join(root, 'dist', 'index.html');
  writeFileSync(index, withMetaPolicy(readFileSync(index, 'utf8'), policy));
  console.log('Content-Security-Policy written to dist/_headers and as a <meta> tag in dist/index.html');
  console.log(`  ${policy.split('; ').join('\n  ')}`);
}
