import type { DiagramDoc } from '../../diagrams/domain/index.ts';
import { MODEL_RESPONSE_JSON_SCHEMA, dropOverlongOptionalFields, modelOutputSchema } from '../domain/model-output.ts';
import type { PlanStep } from '../domain/plan.ts';
import { ProviderError, type InterpretationProvider } from '../providers/types.ts';
import { runProvider } from './provider-call.ts';
import { parseCommand } from './parser.ts';
import { SYSTEM_INSTRUCTION, buildPrompt, type HistoryTurn } from './prompt.ts';

export type AiSource = 'PARSER' | 'AI';

export type Interpretation =
  | { kind: 'plan'; source: AiSource; steps: PlanStep[]; note?: string }
  /** Nothing to do yet: the request is ambiguous, refers to something unknown, or is not an edit. Ask, do not guess. */
  | { kind: 'clarify'; source: AiSource; question: string; options: string[] }
  /** The request needs something that does not exist yet. Nothing is applied: the user is asked, and "yes" applies exactly this plan. */
  | { kind: 'propose'; source: AiSource; question: string; steps: PlanStep[] };

export interface InterpretInput {
  doc: DiagramDoc;
  text: string;
  history: readonly HistoryTurn[];
  /** Fixed provider (tests), or resolve one per person when the model is needed (`resolveProvider`). */
  provider?: InterpretationProvider;
  /** Looks up the provider for THIS person (their own key, or the server's). Only called when the parser had no answer. */
  resolveProvider?: () => Promise<InterpretationProvider>;
  /** Total wall-clock budget for this interpretation INCLUDING every provider retry (decision D07). */
  deadlineMs: number;
  now?: () => number;
  /** Tests only: shrink the minimum time worth spending on a retry. */
  minRetryBudgetMs?: number;
  /**
   * Called only when the MODEL is actually needed (after the parser had no answer): enforce per-user AI limits here, so plain
   * commands the parser handles cost nothing. Returns a function that releases what it acquired.
   */
  beforeProvider?: () => (() => void) | Promise<() => void>;
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
  if (parsed.kind === 'steps') return { kind: 'plan', source: 'PARSER', steps: parsed.steps, ...(parsed.note ? { note: parsed.note } : {}) };
  if (parsed.kind === 'clarify') return { kind: 'clarify', source: 'PARSER', question: parsed.question, options: parsed.options };
  if (parsed.kind === 'propose') return { kind: 'propose', source: 'PARSER', question: parsed.question, steps: parsed.steps };

  const provider = input.resolveProvider ? await input.resolveProvider() : input.provider;
  if (!provider || !provider.available) throw new ProviderError('disabled', 'AI commands are not available for this account right now.');

  const prompt = buildPrompt(input.doc, input.history, input.text);
  if (!prompt.ok) {
    return { kind: 'clarify', source: 'AI', question: 'This diagram is too large for AI commands. Try a precise command such as "connect Orders to Billing" instead.', options: [] };
  }

  const release = await input.beforeProvider?.();
  try {
    return await runProvider({
    provider,
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
  } finally {
    release?.();
  }
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
  if (out.outcome === 'PROPOSE') {
    if (!out.question) throw new ProviderError('bad_output', 'The AI proposed something without a question.');
    // A question with nothing concrete to apply is simply a question: ask it, do not pretend there is a plan to confirm.
    if (!out.commands || out.commands.length === 0) return { kind: 'clarify', source: 'AI', question: out.question, options: out.options ?? [] };
    return { kind: 'propose', source: 'AI', question: out.question, steps: dedupeSteps(out.commands) };
  }
  if (out.outcome === 'CLARIFY') {
    if (!out.question) throw new ProviderError('bad_output', 'The AI asked a question without text.');
    return { kind: 'clarify', source: 'AI', question: out.question, options: out.options ?? [] };
  }
  return { kind: 'clarify', source: 'AI', question: out.message ?? "I can't do that with the diagram tools I have.", options: [] };
}
