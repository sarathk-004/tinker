/**
 * Live smoke test of the Gemini integration. Needs a real key; changes nothing (no database, no diagrams).
 *   npm run check:gemini -w @tinker/server      (reads GEMINI_API_KEY from server/.env or the environment)
 *   CHECK_RUNS=3 npm run check:gemini           (repeat each request to see how consistent the model is)
 * It checks what fake-provider tests cannot: that the real endpoint accepts our request, that the response is found and
 * parses, that the output passes the same validation the server applies, AND that the resulting diagram is what was asked for.
 * The key is never printed.
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
const provider = createGeminiProvider({ apiKey: config.ai.apiKey, model: config.ai.model, thinkingLevel: config.ai.thinkingLevel });
const runs = Math.max(1, Number(process.env.CHECK_RUNS ?? 1));

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

type Graph = DiagramDoc['graph'];
const reachable = (g: Graph, from: string): Set<string> => {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const n = queue.shift()!;
    for (const e of g.edges) if (e.sourceNodeId === n && !seen.has(e.targetNodeId)) (seen.add(e.targetNodeId), queue.push(e.targetNodeId));
  }
  return seen;
};

interface Case {
  text: string;
  expect: 'plan' | 'clarify';
  /** Is the RESULTING diagram what the user asked for? */
  verify?: (after: Graph) => string | null;
}
const cases: Case[] = [
  {
    // The parser does not understand this phrasing, so it exercises the real model.
    text: 'sprinkle some caching between the order service and the database',
    expect: 'plan',
    verify: (g) => {
      const added = g.nodes.filter((n) => !doc.graph.nodes.some((o) => o.id === n.id));
      const middle = added.find((n) => g.edges.some((e) => e.sourceNodeId === id(2) && e.targetNodeId === n.id) && g.edges.some((e) => e.sourceNodeId === n.id && e.targetNodeId === id(3)));
      if (!middle) return 'no new component sits between Orders and PostgreSQL';
      if (g.edges.some((e) => e.sourceNodeId === id(2) && e.targetNodeId === id(3))) return 'the direct Orders -> PostgreSQL connection is still there';
      return null;
    },
  },
  {
    text: 'wire an event queue from orders to a new billing service',
    expect: 'plan',
    verify: (g) => {
      const added = g.nodes.filter((n) => !doc.graph.nodes.some((o) => o.id === n.id));
      const billing = added.find((n) => /billing/i.test(n.name));
      if (added.length < 2 || !billing) return `expected a queue and a billing service, got: ${added.map((n) => n.name).join(', ') || 'nothing'}`;
      return reachable(g, id(2)).has(billing.id) ? null : 'Billing is not connected downstream of Orders';
    },
  },
  { text: 'make it better', expect: 'clarify' },
  { text: 'what is the capital of France?', expect: 'clarify' },
];

let failures = 0;
console.log(`model: ${config.ai.model}  thinking: ${config.ai.thinkingLevel}  deadline: ${config.ai.deadlineMs} ms  runs per request: ${runs}`);
const timings: number[] = [];
for (const c of cases) {
  for (let run = 1; run <= runs; run++) {
    const started = Date.now();
    const tag = runs > 1 ? ` (run ${run})` : '';
    try {
      const result = await interpretRequest({ doc, text: c.text, history: [], provider, deadlineMs: config.ai.deadlineMs });
      const ms = Date.now() - started;
      timings.push(ms);
      if (result.kind === 'plan') {
        const outcome = executePlan(doc, result.steps, buildAliases(doc), () => crypto.randomUUID());
        let problem: string | null = null;
        if (c.expect !== 'plan') problem = 'expected a question, got a plan';
        else if (!outcome.ok) problem = `plan does not apply (${outcome.kind})`;
        else if (c.verify) problem = c.verify(outcome.doc.graph);
        if (problem) failures++;
        const summary = outcome.ok ? outcome.summaries.map((s) => s.summary).join(' | ') : '';
        console.log(`${problem ? 'FAIL' : 'PASS'}  ${ms} ms${tag}  plan (${result.steps.length}): ${summary || '-'}${problem ? `   !! ${problem}` : ''}   <- "${c.text}"`);
        if (problem) console.log(`        steps: ${JSON.stringify(result.steps).slice(0, 500)}`);
      } else {
        const good = c.expect === 'clarify';
        if (!good) failures++;
        console.log(`${good ? 'PASS' : 'FAIL'}  ${ms} ms${tag}  question: ${result.question}   <- "${c.text}"`);
      }
    } catch (error) {
      failures++;
      const e = error as ProviderError;
      console.log(`FAIL  ${Date.now() - started} ms${tag}  ${e.name}${e.kind ? ` kind=${e.kind}` : ''}${e.detail ? ` (${e.detail})` : ''}: ${e.message}   <- "${c.text}"`);
    }
  }
}
if (timings.length) {
  const sorted = [...timings].sort((a, b) => a - b);
  console.log(`\nlatency: median ${sorted[Math.floor(sorted.length / 2)]} ms, slowest ${sorted[sorted.length - 1]} ms (${timings.length} answered)`);
}
console.log(failures === 0 ? 'All live checks passed.' : `${failures} live check(s) failed. Share the lines above (they contain no key or user data).`);
process.exit(failures === 0 ? 0 : 1);
