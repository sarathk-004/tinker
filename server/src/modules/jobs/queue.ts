import { randomUUID } from 'node:crypto';
import { withTransaction, type Pool, type Queryable } from '../../infrastructure/database/pool.ts';

/** Decision D12. Postgres is the queue: short claim transaction, then the work happens outside any transaction under a lease. */
export const JOB_TYPES = ['PRUNE_REVISIONS', 'CLEANUP_EXPIRED_REQUESTS', 'PURGE_DELETED_DIAGRAMS'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export type JobErrorKind = 'LEASE_EXPIRED' | 'SCHEMA' | 'EXTERNAL' | 'INTERNAL';

/** Seconds to wait before attempt N+1 after attempt N failed (10 s, then 60 s; a third failure is a dead letter). */
export const RETRY_DELAYS_SECONDS = [10, 60] as const;

/** A failure a handler can classify. Anything else thrown is INTERNAL. */
export class JobError extends Error {
  constructor(
    public readonly kind: Exclude<JobErrorKind, 'LEASE_EXPIRED'>,
    message: string,
  ) {
    super(message);
    this.name = 'JobError';
  }
}

export interface ClaimedJob {
  id: string;
  type: JobType;
  operationKey: string;
  payload: unknown;
  attempt: number;
  maxAttempts: number;
  /** Proof of ownership; every later call must present it. */
  leaseToken: string;
}

/**
 * What may be stored from a failure: a short single line without anything that looks like a connection string, a bearer
 * token or a key. Stack traces and driver details never reach the table.
 */
export function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    .replace(/\b(?:Bearer|Token)\s+\S+/gi, '[credential]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 300);
}

/** Add work. The operation key makes enqueueing idempotent: the same key is queued once, ever (while its row exists). */
export async function enqueue(
  db: Queryable,
  job: { type: JobType; operationKey: string; payload?: unknown; availableAt?: Date; maxAttempts?: number },
): Promise<{ created: boolean }> {
  const { rowCount } = await db.query(
    `INSERT INTO jobs (type, operation_key, payload, available_at, max_attempts)
     VALUES ($1, $2, $3::jsonb, COALESCE($4, now()), $5)
     ON CONFLICT (operation_key) DO NOTHING`,
    [job.type, job.operationKey, JSON.stringify(job.payload ?? {}), job.availableAt ?? null, job.maxAttempts ?? RETRY_DELAYS_SECONDS.length + 1],
  );
  return { created: (rowCount ?? 0) > 0 };
}

/**
 * Claim one due job (or one whose holder disappeared) in a SHORT transaction, then return so the work runs outside it.
 *  - FOR UPDATE SKIP LOCKED: concurrent workers never claim the same row.
 *  - A RUNNING job with an expired lease is a crashed holder: it is taken over (kind LEASE_EXPIRED), unless it has already used
 *    all its attempts, in which case it becomes a dead letter instead of looping forever.
 */
export async function claimJob(pool: Pool, options: { leaseSeconds: number }): Promise<ClaimedJob | null> {
  return withTransaction(pool, async (tx) => {
    for (let guard = 0; guard < 25; guard++) {
      const { rows } = await tx.query<{ id: string; status: string; attempt_count: number; max_attempts: number }>(
        `SELECT id, status, attempt_count, max_attempts FROM jobs
          WHERE (status = 'PENDING' AND available_at <= now()) OR (status = 'RUNNING' AND lease_expires_at < now())
          ORDER BY available_at, created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
      );
      const row = rows[0];
      if (!row) return null;
      const crashed = row.status === 'RUNNING';
      if (crashed && row.attempt_count >= row.max_attempts) {
        await tx.query(
          `UPDATE jobs SET status = 'DEAD_LETTER', lease_token = NULL, lease_expires_at = NULL, completed_at = now(), updated_at = now(),
                  last_error = 'The worker stopped before finishing, on every attempt.', last_error_kind = 'LEASE_EXPIRED'
            WHERE id = $1`,
          [row.id],
        );
        continue; // look for the next job
      }
      const token = randomUUID();
      const claimed = await tx.query<{ id: string; type: JobType; operation_key: string; payload: unknown; attempt_count: number; max_attempts: number }>(
        `UPDATE jobs
            SET status = 'RUNNING', attempt_count = attempt_count + 1, lease_token = $2,
                lease_expires_at = now() + make_interval(secs => $3), locked_at = now(), updated_at = now(),
                last_error = CASE WHEN $4 THEN 'The previous worker stopped before finishing.' ELSE last_error END,
                last_error_kind = CASE WHEN $4 THEN 'LEASE_EXPIRED' ELSE last_error_kind END
          WHERE id = $1
          RETURNING id, type, operation_key, payload, attempt_count, max_attempts`,
        [row.id, token, options.leaseSeconds, crashed],
      );
      const job = claimed.rows[0]!;
      return { id: job.id, type: job.type, operationKey: job.operation_key, payload: job.payload, attempt: job.attempt_count, maxAttempts: job.max_attempts, leaseToken: token };
    }
    return null;
  });
}

/** Extend the lease. False means the lease is no longer ours (taken over after expiry): stop working. */
export async function heartbeat(pool: Pool, job: ClaimedJob, leaseSeconds: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE jobs SET lease_expires_at = now() + make_interval(secs => $3), updated_at = now()
      WHERE id = $1 AND lease_token = $2 AND status = 'RUNNING'`,
    [job.id, job.leaseToken, leaseSeconds],
  );
  return (rowCount ?? 0) > 0;
}

/** Finish successfully. False means we were fenced off (our lease was taken over): the result is discarded. */
export async function completeJob(pool: Pool, job: ClaimedJob, result: unknown): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE jobs SET status = 'COMPLETED', result = $3::jsonb, completed_at = now(), lease_token = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE id = $1 AND lease_token = $2 AND status = 'RUNNING'`,
    [job.id, job.leaseToken, JSON.stringify(result ?? null)],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Record a failure. Within the attempt budget the job goes back to PENDING after the retry delay; out of attempts it becomes a
 * dead letter. Fenced like completion. Returns what happened (or null when fenced).
 */
export async function failJob(pool: Pool, job: ClaimedJob, error: unknown): Promise<'RETRY' | 'DEAD_LETTER' | null> {
  const kind: JobErrorKind = error instanceof JobError ? error.kind : 'INTERNAL';
  const exhausted = job.attempt >= job.maxAttempts;
  const delay = RETRY_DELAYS_SECONDS[Math.min(job.attempt - 1, RETRY_DELAYS_SECONDS.length - 1)]!;
  const { rowCount } = await pool.query(
    `UPDATE jobs
        SET status = CASE WHEN $3 THEN 'DEAD_LETTER' ELSE 'PENDING' END,
            available_at = CASE WHEN $3 THEN available_at ELSE now() + make_interval(secs => $4) END,
            completed_at = CASE WHEN $3 THEN now() ELSE NULL END,
            lease_token = NULL, lease_expires_at = NULL, last_error = $5, last_error_kind = $6, updated_at = now()
      WHERE id = $1 AND lease_token = $2 AND status = 'RUNNING'`,
    [job.id, job.leaseToken, exhausted, delay, sanitizeError(error), kind],
  );
  if ((rowCount ?? 0) === 0) return null;
  return exhausted ? 'DEAD_LETTER' : 'RETRY';
}
