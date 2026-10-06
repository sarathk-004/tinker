/**
 * Step-by-step Gemini connectivity and latency diagnosis. Prints status, timing and a short sanitized view of each probe.
 *   npm run diagnose:gemini -w @tinker/server
 * The key is read from the environment, sent only in a header, and scrubbed from anything printed. No database, no diagrams.
 */
import { buildPrompt, SYSTEM_INSTRUCTION } from '../src/modules/ai/application/prompt.ts';
import { MODEL_RESPONSE_JSON_SCHEMA, modelOutputSchema } from '../src/modules/ai/domain/model-output.ts';
import { extractText } from '../src/modules/ai/providers/gemini.ts';
import { loadConfig } from '../src/infrastructure/config/config.ts';
import type { DiagramDoc } from '../src/modules/diagrams/domain/index.ts';

const config = loadConfig({ ...process.env, NODE_ENV: 'development' });
const key = config.ai.apiKey;
if (!key) {
  console.error('GEMINI_API_KEY is not set in server/.env');
  process.exit(2);
}
const base = 'https://generativelanguage.googleapis.com';
const TIMEOUT_MS = 30_000;
// Optional: DIAG_MODELS=a,b to test only those models, DIAG_RUNS=n to repeat each.
const requested = process.env.DIAG_MODELS?.split(',').map((m) => m.trim()).filter(Boolean);
const runs = Number(process.env.DIAG_RUNS ?? 1);
const scrub = (text: string) => text.split(key).join('<key>').replace(/AIza[0-9A-Za-z_-]{20,}/g, '<key>');
console.log(`key: ${key.length} chars (hidden)   configured model: ${config.ai.model}   node ${process.version}`);

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const started = Date.now();
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'x-goog-api-key': key as string, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    return { status: res.status, ms: Date.now() - started, text, error: undefined as string | undefined };
  } catch (error) {
    const e = error as Error & { cause?: { code?: string } };
    return { status: 0, ms: Date.now() - started, text: '', error: `${e.name}: ${e.message}${e.cause?.code ? ` (${e.cause.code})` : ''}` };
  }
}

/** Structure of a JSON value without its content (keys and types; long strings shortened). */
function shape(value: unknown, depth = 0): string {
  if (Array.isArray(value)) return `[${value.length > 0 ? shape(value[0], depth + 1) : ''}${value.length > 1 ? ` ×${value.length}` : ''}]`;
  if (value && typeof value === 'object') {
    if (depth > 3) return '{…}';
    return `{${Object.entries(value).map(([k, v]) => `${k}: ${shape(v, depth + 1)}`).join(', ')}}`;
  }
  if (typeof value === 'string') return JSON.stringify(value.length > 50 ? `${value.slice(0, 50)}…` : value);
  return String(value);
}

// 1. Which models can this key use?
const listed = await call('GET', '/v1beta/models?pageSize=200');
console.log(`\n[models] HTTP ${listed.status} in ${listed.ms} ms${listed.error ? ` ${listed.error}` : ''}`);
let names: string[] = [];
try {
  names = (JSON.parse(listed.text).models as Array<{ name: string }>).map((m) => m.name.replace(/^models\//, ''));
  console.log(`  flash-class models: ${names.filter((n) => /flash/.test(n)).join(', ') || '(none listed)'}`);
} catch {
  console.log(`  ${scrub(listed.text.slice(0, 300))}`);
}

// 2. What does a successful Interactions response look like?
const plain = requested ? { status: 0, ms: 0, text: '{}', error: 'skipped' } : await call('POST', '/v1beta/interactions', { model: config.ai.model, input: 'Reply with the single word: ok', store: false, generation_config: { thinking_level: 'low' } });
console.log(`\n[response shape] HTTP ${plain.status} in ${plain.ms} ms${plain.error ? ` ${plain.error}` : ''}`);
try {
  const json = JSON.parse(plain.text);
  console.log(`  shape: ${scrub(shape(json))}`);
  console.log(`  extractText(): ${JSON.stringify(extractText(json))}`);
} catch {
  console.log(`  ${scrub(plain.text.slice(0, 400))}`);
}

// 3. Realistic request (our real prompt, schema and system instruction) against candidate models.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const doc: DiagramDoc = {
  graph: {
    schemaVersion: 1,
    nodes: [
      { id: id(1), name: 'Web Client', kind: 'CLIENT', metadata: {} },
      { id: id(2), name: 'Orders', kind: 'SERVICE', technology: 'Node.js', metadata: {} },
      { id: id(3), name: 'PostgreSQL', kind: 'DATABASE', technology: 'PostgreSQL', metadata: {} },
    ],
    edges: [
      { id: id(101), sourceNodeId: id(1), targetNodeId: id(2), relationship: 'HTTP', metadata: {} },
      { id: id(102), sourceNodeId: id(2), targetNodeId: id(3), relationship: 'SQL', metadata: {} },
    ],
  },
  presentation: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
};
const prompt = buildPrompt(doc, [], 'sprinkle some caching between the order service and the database');
if (!prompt.ok) throw new Error('prompt too large');

const preferred = requested ?? ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
const candidates = (requested ? preferred : [...new Set([config.ai.model, ...preferred])]).filter((m) => names.length === 0 || names.includes(m));
let shapeShown = false;
console.log(`\n[realistic request] same prompt, schema and instruction the app sends; thinking_level=low; ${candidates.length} model(s)`);
for (const model of candidates.flatMap((m) => Array.from({ length: runs }, () => m))) {
  const r = await call('POST', '/v1beta/interactions', {
    model,
    input: prompt.content,
    system_instruction: SYSTEM_INSTRUCTION,
    generation_config: { max_output_tokens: 2048, thinking_level: 'low' },
    response_format: { type: 'text', mime_type: 'application/json', schema: MODEL_RESPONSE_JSON_SCHEMA },
    store: false,
  });
  let verdict = '';
  if (r.status === 200) {
    try {
      const text = extractText(JSON.parse(r.text));
      const parsed = modelOutputSchema.safeParse(text ? JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) : undefined);
      verdict = parsed.success
        ? `valid output: ${parsed.data.outcome}${parsed.data.commands ? ` (${parsed.data.commands.map((c) => c.type).join(', ')})` : ''}`
        : `OUTPUT INVALID: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ')}`;
      if (!shapeShown && text) {
        shapeShown = true;
        console.log(`  (response shape: ${scrub(shape(JSON.parse(r.text)))})`);
      }
      if (!parsed.success && text) {
        const raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as { commands?: Array<Record<string, unknown>> };
        const long = (raw.commands ?? []).flatMap((c, i) => Object.entries(c).filter(([, v]) => typeof v === 'string' && v.length > 100).map(([k, v]) => `commands[${i}].${k} (${(v as string).length} chars)`));
        if (long.length) console.log(`  over-long fields: ${long.join(', ')}`);
      }
    } catch {
      verdict = 'could not read the response text';
    }
  } else {
    verdict = scrub(r.text.replace(/\s+/g, ' ').slice(0, 160)) || (r.error ?? '');
  }
  console.log(`  ${model.padEnd(24)} HTTP ${String(r.status).padEnd(3)} ${String(r.ms).padStart(6)} ms   ${verdict}`);
}
process.exit(0);
