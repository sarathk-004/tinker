// Serve ./dist like Cloudflare Pages does: single-page fallback and the rules from dist/_headers (including the CSP).
//   npm run build && node scripts/preview-with-headers.mjs [port]        (default 4173)
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.argv[2] ?? 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json' };

/** Minimal parser for the _headers format: a path pattern line, then indented `Name: value` lines. */
function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) rules.push((current = { pattern: raw.trim(), headers: {} }));
    else if (current) {
      const i = raw.indexOf(':');
      current.headers[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
    }
  }
  return rules;
}
const matches = (pattern, path) => (pattern.endsWith('/*') ? path.startsWith(pattern.slice(0, -1)) || pattern === '/*' : pattern === path);
const rules = parseHeaders(readFileSync(join(root, '_headers'), 'utf8'));

createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html'); // SPA fallback
  const served = '/' + file.slice(root.length + 1).replace(/\\/g, '/');
  const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' };
  for (const rule of rules) if (matches(rule.pattern, served)) Object.assign(headers, rule.headers);
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`dist served at http://localhost:${port}/ with the rules from dist/_headers`));
