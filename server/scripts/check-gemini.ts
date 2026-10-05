/**
 * Live smoke test of the Gemini integration. Needs a real key; changes nothing (no database, no diagrams).
 *   npm run check:gemini -w @tinker/server      (reads GEMINI_API_KEY from server/.env or the environment)
 * It checks what fake-provider tests cannot: that the real endpoint accepts our request, that the response is found and
 * parses, and that the output passes the same validation the server applies. The key is never printed.
 */
import { interpretRequest } from '../src/modules/ai/application/interpret.ts';
import { loadConfig } from '../src/infrastructure/config/config.ts';
import { createGeminiProvider } from '../src/modules/ai/providers/gemini.ts';
import { ProviderError } from '../src/modules/ai/providers/types.ts';
import { buildAliases, executePlan } from '../src/modules/ai/domain/plan.ts';
import type { DiagramDoc } from '../src/modules/diagrams/domain/index.ts';

const config = loadConfig({ ...process.env, NODE_ENV: 'development' });
if (!config.ai.apiKey) {
  console.error('GEMINI_API_KEY is not set (put it in server/.env, never in a VITE_* variable).');
  process.exit(2);
}
const provider = createGeminiProvider({ apiKey: config.ai.apiKey, model: config.ai.model });

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
  presentation: { nodePositions: { [id(1)]: { x: 0, y: 0 }, [id(2)]: { x: 300, y: 0 }, [id(3)]: { x: 600, y: 0 } }, viewport: { x: 0, y: 0, zoom: 1 } },
};

const cases: Array<{ text: string; expect: 'plan' | 'clarify' }> = [
  // The parser does not understand these, so they exercise the real model.
  { text: 'sprinkle some caching between the order service and the database', expect: 'plan' },
  { text: 'wire an event queue from orders to a new billing service', expect: 'plan' },
  { text: 'make it better', expect: 'clarify' },
  { text: 'what is the capital of France?', expect: 'clarify' },
];

let failures = 0;
console.log(`model: ${config.ai.model}  deadline: ${config.ai.deadlineMs} ms`);
for (const c of cases) {
  const started = Date.now();
  try {
    const result = await interpretRequest({ doc, text: c.text, history: [], provider, deadlineMs: config.ai.deadlineMs });
    const ms = Date.now() - started;
    if (result.kind === 'plan') {
      const run = executePlan(doc, result.steps, buildAliases(doc), () => crypto.randomUUID());
      const detail = run.ok ? run.summaries.map((s) => s.summary).join(' | ') : `plan does not apply: ${run.kind}`;
      const good = c.expect === 'plan' && run.ok;
      if (!good) failures++;
      console.log(`${good ? 'PASS' : 'FAIL'}  ${ms} ms  plan (${result.steps.length} step${result.steps.length === 1 ? '' : 's'}): ${detail}   <- "${c.text}"`);
    } else {
      const good = c.expect === 'clarify';
      if (!good) failures++;
      console.log(`${good ? 'PASS' : 'FAIL'}  ${ms} ms  clarification: ${result.question}   <- "${c.text}"`);
    }
  } catch (error) {
    failures++;
    const e = error as ProviderError;
    console.log(`FAIL  ${Date.now() - started} ms  ${e.name}${e.kind ? ` kind=${e.kind}` : ''}${e.detail ? ` (${e.detail})` : ''}: ${e.message}   <- "${c.text}"`);
  }
}
console.log(failures === 0 ? '\nAll live checks passed.' : `\n${failures} live check(s) failed. Share the lines above (they contain no key or user data).`);
process.exit(failures === 0 ? 0 : 1);
