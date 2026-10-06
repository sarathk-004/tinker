import type { DiagramDoc } from '../../diagrams/domain/index.ts';
import { MODEL_RESPONSE_JSON_SCHEMA, dropOverlongOptionalFields, modelOutputSchema } from '../domain/model-output.ts';
import type { PlanStep } from '../domain/plan.ts';
import { ProviderError, type InterpretationProvider } from '../providers/types.ts';
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
}

/** Minimum time worth spending on a retry: below this a second attempt cannot realistically finish. */
const MIN_RETRY_BUDGET_MS = 1_500;
/** The first attempt may use at most this share of the total budget, so a hung call can still be retried inside the deadline. */
const FIRST_ATTEMPT_SHARE = 0.5;

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

  const now = input.now ?? Date.now;
  const minRetry = input.minRetryBudgetMs ?? MIN_RETRY_BUDGET_MS;
  const started = now();
  const total = new AbortController();
  const totalTimer = setTimeout(() => total.abort(), input.deadlineMs);

  try {
    for (let attempt = 0; ; attempt++) {
      // One controller per attempt: aborted by the total deadline, or by the first-attempt cap.
      const attemptController = new AbortController();
      const abortAttempt = () => attemptController.abort();
      total.signal.addEventListener('abort', abortAttempt, { once: true });
      const remainingNow = input.deadlineMs - (now() - started);
      const cap = attempt === 0 ? Math.min(remainingNow, Math.floor(input.deadlineMs * FIRST_ATTEMPT_SHARE)) : remainingNow;
      const attemptTimer = setTimeout(abortAttempt, Math.max(1, cap));
      const stopped = new Promise<never>((_, reject) => {
        attemptController.signal.addEventListener('abort', () => reject(new ProviderError('timeout', 'The AI took too long to answer.')), { once: true });
      });
      stopped.catch(() => undefined); // consumed by the race below when needed

      try {
        const call = input.provider.interpret(
          { systemInstruction: SYSTEM_INSTRUCTION, content: prompt.content, responseSchema: MODEL_RESPONSE_JSON_SCHEMA as unknown as Record<string, unknown> },
          { signal: attemptController.signal },
        );
        call.catch(() => undefined); // a result arriving after the deadline is ignored, never an unhandled rejection
        const result = await Promise.race([call, stopped]);
        const validated = modelOutputSchema.safeParse(dropOverlongOptionalFields(result.output));
        if (!validated.success) throw new ProviderError('bad_output', 'The AI output did not match the expected format.', validated.error.issues[0]?.message);
        return fromModelOutput(validated.data);
      } catch (error) {
        const totalExpired = total.signal.aborted;
        const failure = error instanceof ProviderError ? error : new ProviderError('unavailable', 'The AI provider failed.');
        const remaining = input.deadlineMs - (now() - started);
        // A first attempt that merely hit its own cap is worth retrying; the total deadline never is.
        const retryable = failure.transient || (failure.kind === 'timeout' && !totalExpired);
        // At most ONE upstream retry, and only inside the remaining deadline.
        if (attempt === 0 && retryable && !totalExpired && remaining > minRetry) continue;
        throw totalExpired ? new ProviderError('timeout', 'The AI took too long to answer.') : failure;
      } finally {
        clearTimeout(attemptTimer);
        total.signal.removeEventListener('abort', abortAttempt);
      }
    }
  } finally {
    clearTimeout(totalTimer);
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
  if (out.outcome === 'CLARIFY') {
    if (!out.question) throw new ProviderError('bad_output', 'The AI asked a question without text.');
    return { kind: 'clarify', source: 'AI', question: out.question, options: out.options ?? [] };
  }
  return { kind: 'clarify', source: 'AI', question: out.message ?? "I can't do that with the diagram tools I have.", options: [] };
}
