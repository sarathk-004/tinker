import type { DiagramDoc } from '../../diagrams/domain/index.ts';
import { MODEL_RESPONSE_JSON_SCHEMA, dropOverlongOptionalFields, modelOutputSchema } from '../domain/model-output.ts';
import type { PlanStep } from '../domain/plan.ts';
import { ProviderError, type InterpretationProvider } from '../providers/types.ts';
import { runProvider } from './provider-call.ts';
import { parseCommand } from './parser.ts';
import { SYSTEM_INSTRUCTION, buildPrompt, type HistoryTurn } from './prompt.ts';

export type AiSource = 'PARSER' | 'AI';

export type Interpretation =
  | { kind: 'plan'; source: AiSource; steps: PlanStep[] }
  /** Nothing to do yet: the request is ambiguous, refers to something unknown, or is not an edit. Ask, do not guess. */
  | { kind: 'clarify'; source: AiSource; question: string; options: string[] };

export interface InterpretInput {
  doc: DiagramDoc;
  text: string;
  history: readonly HistoryTurn[];
  provider: InterpretationProvider;
  /** Total wall-clock budget for this interpretation INCLUDING every provider retry (decision D07). */
  deadlineMs: number;
  now?: () => number;
  /** Tests only: shrink the minimum time worth spending on a retry. */
  minRetryBudgetMs?: number;
  /** Latency metric: one call per provider attempt (never user text, never the key). */
  onAttempt?: (attempt: { attempt: number; ms: number; outcome: 'ok' | ProviderError['kind'] }) => void;
}

/**
 * Interpret one typed request. The deterministic parser answers plain commands without any model call; everything else goes
 * through the provider gateway under one deadline. Provider output is UNTRUSTED: it must pass `modelOutputSchema` or it is
 * treated as a provider failure. Throws ProviderError for failures (the caller maps them to HTTP errors).
 *
 * Time: the TOTAL deadline is hard (it also holds when a provider ignores cancellation). Inside it, the first attempt is capped at
 * half the budget; a hung or failed first attempt is retried once with whatever budget remains (live measurements: answers take
 * ~2 s, with an occasional call that hangs).
 */
export async function interpretRequest(input: InterpretInput): Promise<Interpretation> {
  const parsed = parseCommand(input.doc, input.text);
  if (parsed.kind === 'steps') return { kind: 'plan', source: 'PARSER', steps: parsed.steps };
  if (parsed.kind === 'clarify') return { kind: 'clarify', source: 'PARSER', question: parsed.question, options: parsed.options };

  if (!input.provider.available) throw new ProviderError('disabled', 'AI commands are not configured on this server.');

  const prompt = buildPrompt(input.doc, input.history, input.text);
  if (!prompt.ok) {
    return { kind: 'clarify', source: 'AI', question: 'This diagram is too large for AI commands. Try a precise command such as "connect Orders to Billing" instead.', options: [] };
  }

  return runProvider({
    provider: input.provider,
    request: { systemInstruction: SYSTEM_INSTRUCTION, content: prompt.content, responseSchema: MODEL_RESPONSE_JSON_SCHEMA as unknown as Record<string, unknown> },
    deadlineMs: input.deadlineMs,
    ...(input.now ? { now: input.now } : {}),
    ...(input.minRetryBudgetMs !== undefined ? { minRetryBudgetMs: input.minRetryBudgetMs } : {}),
    ...(input.onAttempt ? { onAttempt: input.onAttempt } : {}),
    parse: (output) => {
      const validated = modelOutputSchema.safeParse(dropOverlongOptionalFields(output));
      if (!validated.success) throw new ProviderError('bad_output', 'The AI output did not match the expected format.', validated.error.issues[0]?.message);
      return fromModelOutput(validated.data);
    },
  });
}

/**
 * Models occasionally repeat a step. Repeating an insert, connect, disconnect, remove, rename or update can never be intended
 * (the second copy would be refused and sink the whole plan), so exact repeats are dropped. Repeated ADD_NODE steps are kept:
 * "add two caches" legitimately repeats.
 */
export function dedupeSteps(steps: readonly PlanStep[]): PlanStep[] {
  const seen = new Set<string>();
  return steps.filter((step) => {
    if (step.type === 'ADD_NODE') return true;
    const signature = JSON.stringify(Object.fromEntries(Object.entries(step).sort(([a], [b]) => (a < b ? -1 : 1))));
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function fromModelOutput(out: ReturnType<typeof modelOutputSchema.parse>): Interpretation {
  if (out.outcome === 'COMMANDS') {
    if (!out.commands || out.commands.length === 0) throw new ProviderError('bad_output', 'The AI returned no steps.');
    return { kind: 'plan', source: 'AI', steps: dedupeSteps(out.commands) };
  }
  if (out.outcome === 'CLARIFY') {
    if (!out.question) throw new ProviderError('bad_output', 'The AI asked a question without text.');
    return { kind: 'clarify', source: 'AI', question: out.question, options: out.options ?? [] };
  }
  return { kind: 'clarify', source: 'AI', question: out.message ?? "I can't do that with the diagram tools I have.", options: [] };
}
