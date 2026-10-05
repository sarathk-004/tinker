import { AppError } from './errors.ts';

export interface RateLimiter {
  /** Throws RATE_LIMITED when `userId` exceeded the window's allowance. */
  check(userId: string): void;
}

/**
 * Fixed-window, in-memory, per-user (decision D10). Valid for a SINGLE API instance only: counters reset on restart and
 * are not shared, so this must move to shared storage before a second instance is added.
 */
export function createRateLimiter(options: { limit: number; windowMs?: number; now?: () => number }): RateLimiter {
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    check(userId) {
      const t = now();
      if (windows.size > 10_000) {
        for (const [key, w] of windows) if (t - w.start >= windowMs) windows.delete(key);
      }
      let w = windows.get(userId);
      if (!w || t - w.start >= windowMs) {
        w = { start: t, count: 0 };
        windows.set(userId, w);
      }
      w.count += 1;
      if (w.count > options.limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((w.start + windowMs - t) / 1000));
        throw new AppError('RATE_LIMITED', 'Too many requests. Please slow down.', { retryAfterSeconds });
      }
    },
  };
}
