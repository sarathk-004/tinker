import { ProviderError, type InterpretationProvider, type ProviderRequest, type ProviderResult } from './types.ts';

/**
 * Gemini Interactions API (REST, https://ai.google.dev/gemini-api/docs/structured-output and /api/interactions-api,
 * read 2026-10-05). Plain fetch instead of an SDK so the deadline and cancellation are fully under our control.
 *
 * - The API key travels ONLY in the `x-goog-api-key` header: never in the URL, a log line or an error message.
 * - `store: false`: the provider is asked not to retain the interaction.
 * - The response text is located tolerantly (documentation summaries disagree on field names); the result is validated by
 *   the caller regardless. `npm run check:gemini -w @tinker/server` exercises the real endpoint with a real key.
 */
export interface GeminiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const MAX_OUTPUT_TOKENS = 2048;

/** Pull the generated text out of the response, trying the documented shape first and known alternatives after it. */
export function extractText(json: unknown): string | undefined {
  const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined);
  const root = obj(json);
  if (!root) return undefined;

  const textsOf = (content: unknown): string[] =>
    Array.isArray(content)
      ? content.flatMap((c) => {
          const part = obj(c);
          return part && typeof part['text'] === 'string' && (part['type'] === undefined || part['type'] === 'text') ? [part['text'] as string] : [];
        })
      : [];

  // documented: steps[{type:"model_output", content:[{type:"text", text}]}]
  for (const key of ['steps', 'outputs', 'output']) {
    const list = root[key];
    if (Array.isArray(list)) {
      const texts = list.flatMap((s) => {
        const step = obj(s);
        if (!step) return [];
        if (step['type'] !== undefined && step['type'] !== 'model_output' && step['type'] !== 'text') return [];
        return typeof step['text'] === 'string' ? [step['text'] as string] : textsOf(step['content']);
      });
      if (texts.length > 0) return texts.join('');
    }
  }
  for (const key of ['output_text', 'outputText']) if (typeof root[key] === 'string') return root[key] as string;
  const nested = obj(root['interaction']);
  if (nested) {
    const inner = extractText(nested);
    if (inner) return inner;
  }
  // generateContent-style fallback
  const candidates = root['candidates'];
  if (Array.isArray(candidates)) {
    const parts = obj(obj(candidates[0])?.['content'])?.['parts'];
    const texts = textsOf(parts);
    if (texts.length > 0) return texts.join('');
  }
  return undefined;
}

/** Models sometimes wrap JSON in a markdown fence even when asked not to. */
function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(trimmed);
}

export function createGeminiProvider(options: GeminiOptions): InterpretationProvider {
  const fetchImpl = options.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const base = (options.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/$/, '');

  return {
    available: true,
    name: `gemini:${options.model}`,
    async interpret(request: ProviderRequest, { signal }): Promise<ProviderResult> {
      let response: Response;
      try {
        response = await fetchImpl(`${base}/v1beta/interactions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
          signal,
          redirect: 'error',
          body: JSON.stringify({
            model: options.model,
            input: request.content,
            system_instruction: request.systemInstruction,
            generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS },
            response_format: { type: 'text', mime_type: 'application/json', schema: request.responseSchema },
            store: false,
          }),
        });
      } catch (error) {
        if (signal.aborted || (error as { name?: string }).name === 'AbortError' || (error as { name?: string }).name === 'TimeoutError') {
          throw new ProviderError('timeout', 'The AI provider did not answer in time.');
        }
        throw new ProviderError('unavailable', 'Cannot reach the AI provider.', (error as Error).name);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        // Provider error text can echo request content: keep only a short status-level hint for logs.
        const hint = `HTTP ${response.status}${/"status"\s*:\s*"([A-Z_]+)"/.exec(body)?.[1] ? ` ${/"status"\s*:\s*"([A-Z_]+)"/.exec(body)![1]}` : ''}`;
        if (response.status === 429) throw new ProviderError('rate_limited', 'The AI provider is rate limiting requests.', hint);
        if (response.status >= 500) throw new ProviderError('unavailable', 'The AI provider is temporarily unavailable.', hint);
        if (response.status === 401 || response.status === 403 || response.status === 404) throw new ProviderError('auth', 'The AI provider rejected our credentials or model.', hint);
        throw new ProviderError('rejected', 'The AI provider could not process this request.', hint);
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new ProviderError('bad_output', 'The AI provider answered with something that is not JSON.');
      }
      const status = (json as { status?: unknown } | null)?.status;
      if (typeof status === 'string' && status !== 'completed') {
        throw new ProviderError(status === 'cancelled' || status === 'failed' ? 'unavailable' : 'bad_output', 'The AI provider did not complete the request.', `status ${status}`);
      }
      const text = extractText(json);
      if (!text) throw new ProviderError('bad_output', 'The AI provider returned no text.', 'no text in response');
      let output: unknown;
      try {
        output = parseJsonText(text);
      } catch {
        throw new ProviderError('bad_output', 'The AI output was not valid JSON.');
      }
      const usage = (json as { usage?: { total_input_tokens?: number; total_output_tokens?: number } }).usage;
      return {
        output,
        model: options.model,
        ...(usage ? { usage: { ...(usage.total_input_tokens !== undefined ? { inputTokens: usage.total_input_tokens } : {}), ...(usage.total_output_tokens !== undefined ? { outputTokens: usage.total_output_tokens } : {}) } } : {}),
      };
    },
  };
}
