import { ProviderError, type InterpretationProvider, type ProviderRequest, type ProviderResult } from './types.ts';

/** Used when no key is configured: AI commands answer 503, manual editing is unaffected (acceptance A18). */
export const disabledProvider: InterpretationProvider = {
  available: false,
  name: 'disabled',
  async interpret() {
    throw new ProviderError('disabled', 'AI commands are not configured on this server.');
  },
};

export type FakeScript =
  | { output: unknown }
  | { error: ProviderError }
  /** Wait `ms` (or until aborted) then answer: models a slow provider. */
  | { output: unknown; delayMs: number; ignoreAbort?: boolean }
  /** Run arbitrary code first (e.g. change the database mid-flight). */
  | { before: () => Promise<void> | void; output: unknown };

/**
 * Deterministic provider for tests: plays back scripted answers in order and records every request it receives.
 * It proves our handling of provider behaviour; it does NOT prove live connectivity to Gemini.
 */
export function createFakeProvider(script: FakeScript[] | ((request: ProviderRequest, call: number) => FakeScript)) {
  const calls: ProviderRequest[] = [];
  const provider: InterpretationProvider & { calls: ProviderRequest[] } = {
    available: true,
    name: 'fake',
    calls,
    async interpret(request, { signal }): Promise<ProviderResult> {
      const index = calls.length;
      calls.push(request);
      const step = typeof script === 'function' ? script(request, index) : (script[Math.min(index, script.length - 1)] as FakeScript);
      if ('error' in step) throw step.error;
      if ('before' in step) await step.before();
      if ('delayMs' in step) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, step.delayMs);
          if (!step.ignoreAbort) {
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new ProviderError('timeout', 'aborted'));
            });
          }
        });
      }
      return { output: step.output, model: 'fake' };
    },
  };
  return provider;
}
