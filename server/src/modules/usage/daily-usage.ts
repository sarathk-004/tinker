import type { Quota } from '@tinker/shared';
import { withTransaction, type Pool } from '../../infrastructure/database/pool.ts';
import { AppError } from '../../infrastructure/http/errors.ts';

/**
 * Daily AI allowance (security review H1). Model calls cost the operator money, so each person gets a small fixed number a day
 * and the whole service has a second, global ceiling (the budget breaker). Counted in Postgres, so a restart cannot reset it.
 *
 *   AI    one request that actually needs the model: a free-form command, a question the model explains, a spoken reply.
 *         Plain commands the parser understands cost nothing and are not counted.
 *   VOICE one voice session opened (the speech model runs for the whole session).
 *
 * The day is the UTC day; everything resets at 00:00 UTC.
 */
export type UsageKind = 'AI' | 'VOICE';

export interface UsageLimits {
  ai: number;
  voice: number;
  globalAi: number;
  globalVoice: number;
}

export interface DailyUsage {
  /** Take one unit for `userId`, or throw DAILY_LIMIT_REACHED. Counted before the model is called (a started call costs money even if it fails). */
  consume(userId: string, kind: UsageKind): Promise<void>;
  snapshot(userId: string): Promise<Quota>;
}

const GLOBAL = 'GLOBAL';
const TODAY = `(now() AT TIME ZONE 'UTC')::date`;

export function nextResetUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export function createDailyUsage(pool: Pool, limits: UsageLimits, clock: () => Date = () => new Date()): DailyUsage {
  const limitFor = (kind: UsageKind) => (kind === 'AI' ? limits.ai : limits.voice);
  const globalFor = (kind: UsageKind) => (kind === 'AI' ? limits.globalAi : limits.globalVoice);

  // The WHERE on the conflict branch makes the check and the increment ONE atomic statement: two simultaneous requests can never
  // both take the last unit. No row back means the limit was already reached.
  const take = (tx: Pick<Pool, 'query'>, scope: string, kind: UsageKind, limit: number) =>
    tx.query<{ count: number }>(
      `INSERT INTO usage_daily (scope, day, kind, count) VALUES ($1, ${TODAY}, $2, 1)
       ON CONFLICT (scope, day, kind) DO UPDATE SET count = usage_daily.count + 1, updated_at = now()
         WHERE usage_daily.count < $3
       RETURNING count`,
      [scope, kind, limit],
    );

  const resetDetails = () => ({ resetsAt: nextResetUtc(clock()).toISOString(), retryAfterSeconds: Math.max(1, Math.ceil((nextResetUtc(clock()).getTime() - clock().getTime()) / 1000)) });

  return {
    async consume(userId, kind) {
      await withTransaction(pool, async (tx) => {
        // Global first, then the person: one fixed order, so concurrent callers can never deadlock on these two rows.
        if ((await take(tx, GLOBAL, kind, globalFor(kind))).rows.length === 0) {
          throw new AppError('DAILY_LIMIT_REACHED', 'AI is paused for today to keep the service within its budget. Plain commands still work. It comes back tomorrow (00:00 UTC).', { scope: 'SERVICE', kind, ...resetDetails() });
        }
        if ((await take(tx, userId, kind, limitFor(kind))).rows.length === 0) {
          // Throwing rolls the global increment back too.
          throw new AppError(
            'DAILY_LIMIT_REACHED',
            kind === 'AI'
              ? `You have used your ${limitFor(kind)} AI requests for today. Plain commands still work. Your allowance resets at 00:00 UTC.`
              : `You have used your ${limitFor(kind)} voice sessions for today. Typing still works. Your allowance resets at 00:00 UTC.`,
            { scope: 'USER', kind, limit: limitFor(kind), ...resetDetails() },
          );
        }
      });
    },

    async snapshot(userId) {
      const { rows } = await pool.query<{ kind: UsageKind; count: number }>(`SELECT kind, count FROM usage_daily WHERE scope = $1 AND day = ${TODAY}`, [userId]);
      const used = (kind: UsageKind) => rows.find((r) => r.kind === kind)?.count ?? 0;
      return {
        resetsAt: nextResetUtc(clock()).toISOString(),
        ai: { used: used('AI'), limit: limits.ai },
        voice: { used: used('VOICE'), limit: limits.voice },
      };
    },
  };
}

/** Days other than today are never read; the cleanup job drops them after a week (kept briefly for diagnosis). */
export async function purgeOldUsage(pool: Pool, keepDays = 7): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM usage_daily WHERE day < ${TODAY} - $1::int`, [keepDays]);
  return rowCount ?? 0;
}
