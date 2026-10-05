import type { DiagramDoc } from '../../diagrams/domain/index.ts';
import { MODEL_RESPONSE_JSON_SCHEMA, modelOutputSchema } from '../domain/model-output.ts';
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
}

/** Minimum time worth spending on a retry: below this a second attempt cannot realistically finish. */
const MIN_RETRY_BUDGET_MS = 1_500;

/**
 * Interpret one typed request. The deterministic parser answers plain commands without any model call; everything else goes
 * through the provider gateway under one deadline. Provider output is UNTRUSTED: it must pass `modelOutputSchema` or it is
 * treated as a provider failure. Throws ProviderError for failures (the caller maps them to HTTP errors).
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
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.deadlineMs);
  const deadline = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new ProviderError('timeout', 'The AI took too long to answer.')), { once: true });
  });
  deadline.catch(() => undefined); // the race below consumes it; avoid an unhandled rejection when it is not needed

  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const call = input.provider.interpret(
          { systemInstruction: SYSTEM_INSTRUCTION, content: prompt.content, responseSchema: MODEL_RESPONSE_JSON_SCHEMA as unknown as Record<string, unknown> },
          { signal: controller.signal },
        );
        call.catch(() => undefined); // a result arriving after the deadline is ignored, never an unhandled rejection
        const result = await Promise.race([call, deadline]);
        const validated = modelOutputSchema.safeParse(result.output);
        if (!validated.success) throw new ProviderError('bad_output', 'The AI output did not match the expected format.', validated.error.issues[0]?.message);
        return fromModelOutput(validated.data);
      } catch (error) {
        const failure = controller.signal.aborted ? new ProviderError('timeout', 'The AI took too long to answer.') : error instanceof ProviderError ? error : new ProviderError('unavailable', 'The AI provider failed.');
        const remaining = input.deadlineMs - (now() - started);
        // At most ONE upstream retry, and only inside the remaining deadline.
        if (attempt === 0 && failure.transient && remaining > MIN_RETRY_BUDGET_MS) continue;
        throw failure;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

function fromModelOutput(out: ReturnType<typeof modelOutputSchema.parse>): Interpretation {
  if (out.outcome === 'COMMANDS') {
    if (!out.commands || out.commands.length === 0) throw new ProviderError('bad_output', 'The AI returned no steps.');
    return { kind: 'plan', source: 'AI', steps: out.commands };
  }
  if (out.outcome === 'CLARIFY') {
    if (!out.question) throw new ProviderError('bad_output', 'The AI asked a question without text.');
    return { kind: 'clarify', source: 'AI', question: out.question, options: out.options ?? [] };
  }
  return { kind: 'clarify', source: 'AI', question: out.message ?? "I can't do that with the diagram tools I have.", options: [] };
}
