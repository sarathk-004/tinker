import { AppError } from './errors.ts';

export interface ConcurrencyLimiter {
  /** Take a slot for `userId` or throw RATE_LIMITED. Call the returned function exactly once to release it. */
  acquire(userId: string): () => void;
}

/**
 * At most `max` simultaneous AI requests per user (decision D10). In-memory: valid for a SINGLE API instance only; with several
 * instances this must move to shared storage with leases (see docs/later-checks.md).
 */
export function createConcurrencyLimiter(options: { max: number }): ConcurrencyLimiter {
  const active = new Map<string, number>();
  return {
    acquire(userId) {
      const count = active.get(userId) ?? 0;
      if (count >= options.max) {
        throw new AppError('RATE_LIMITED', 'Too many AI requests are running at once. Wait for one to finish.', { retryAfterSeconds: 3 });
      }
      active.set(userId, count + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (active.get(userId) ?? 1) - 1;
        if (left <= 0) active.delete(userId);
        else active.set(userId, left);
      };
    },
  };
}
