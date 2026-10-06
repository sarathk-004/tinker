import { ProviderError, type InterpretationProvider, type ProviderRequest } from '../providers/types.ts';

export interface ProviderCall<T> {
  provider: InterpretationProvider;
  request: ProviderRequest;
  /** Total wall-clock budget INCLUDING every provider retry (decision D07). */
  deadlineMs: number;
  /** Validates the UNTRUSTED model output; throw ProviderError('bad_output', ...) when it does not fit. */
  parse: (output: unknown) => T;
  now?: () => number;
  /** Tests only: shrink the minimum time worth spending on a retry. */
  minRetryBudgetMs?: number;
  /** Latency metric: one call per provider attempt (never user text, never the key). */
  onAttempt?: (attempt: { attempt: number; ms: number; outcome: 'ok' | ProviderError['kind'] }) => void;
}

/** Minimum time worth spending on a retry: below this a second attempt cannot realistically finish. */
const MIN_RETRY_BUDGET_MS = 1_500;
/** The first attempt may use at most this share of the total budget, so a hung call can still be retried inside the deadline. */
const FIRST_ATTEMPT_SHARE = 0.5;

/**
 * One provider call under a hard TOTAL deadline (it also holds when a provider ignores cancellation). The first attempt is
 * capped at half the budget; a hung, transient or malformed first attempt is retried once with whatever budget remains.
 * Throws ProviderError.
 */
export async function runProvider<T>(input: ProviderCall<T>): Promise<T> {
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

      const attemptStarted = now();
      const report = (outcome: 'ok' | ProviderError['kind']) => input.onAttempt?.({ attempt, ms: now() - attemptStarted, outcome });
      try {
        const call = input.provider.interpret(input.request, { signal: attemptController.signal });
        call.catch(() => undefined); // a result arriving after the deadline is ignored, never an unhandled rejection
        const result = await Promise.race([call, stopped]);
        const value = input.parse(result.output);
        report('ok');
        return value;
      } catch (error) {
        const totalExpired = total.signal.aborted;
        const failure = error instanceof ProviderError ? error : new ProviderError('unavailable', 'The AI provider failed.');
        report(totalExpired ? 'timeout' : failure.kind);
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
