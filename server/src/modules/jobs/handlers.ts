import { REVISION_RETENTION } from '@tinker/shared';
import { REPLAY_DAYS } from '../../infrastructure/idempotency/mutation-requests.ts';
import type { Pool } from '../../infrastructure/database/pool.ts';
import { purgeOldUsage } from '../usage/daily-usage.ts';
import { JobError, type JobType } from './queue.ts';

/** Retention policy (decision D11). One place, so product copy and cleanup cannot drift apart. */
export interface RetentionPolicy {
  /** A revision is pruned only when it is NOT among the latest N of its diagram AND older than `revisionDays` (an intersection bound). */
  revisionKeepLatest: number;
  revisionDays: number;
  /** How long a soft-deleted diagram can be recovered before it is physically purged. */
  deletedDiagramDays: number;
  /** Diagnostic execution records. */
  executionDays: number;
  /** After this the mutation request tombstone itself goes (clients never retry a key that old). */
  tombstoneDays: number;
  /** Diagrams / rows handled per run, so one run stays short. */
  batchSize: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  revisionKeepLatest: REVISION_RETENTION.keepLatest,
  revisionDays: REVISION_RETENTION.keepDays,
  deletedDiagramDays: 30,
  executionDays: 90,
  tombstoneDays: 90,
  batchSize: 50,
};

export interface JobContext {
  pool: Pool;
  policy: RetentionPolicy;
  /** Aborts when the lease is lost: stop at once, the result will be discarded. */
  signal: AbortSignal;
}

export type JobHandler = (payload: unknown, context: JobContext) => Promise<Record<string, number>>;

/**
 * Delete revisions that are older than the window AND not among the latest N. The newest revisions of a diagram are never touched,
 * and the diagram's current state lives in `diagrams`, not here. Safe to run twice (the second run finds nothing).
 */
export const pruneRevisions: JobHandler = async (_payload, { pool, policy, signal }) => {
  const candidates = await pool.query<{ diagram_id: string }>(
    `SELECT diagram_id FROM diagram_revisions GROUP BY diagram_id HAVING count(*) > $1 LIMIT $2`,
    [policy.revisionKeepLatest, policy.batchSize],
  );
  let pruned = 0;
  for (const { diagram_id } of candidates.rows) {
    if (signal.aborted) break;
    const deleted = await pool.query(
      `DELETE FROM diagram_revisions
        WHERE id IN (
          SELECT id FROM (
            SELECT id, created_at, row_number() OVER (ORDER BY version DESC) AS newest
              FROM diagram_revisions WHERE diagram_id = $1
          ) ranked
          WHERE newest > $2 AND created_at < now() - make_interval(days => $3)
        )`,
      [diagram_id, policy.revisionKeepLatest, policy.revisionDays],
    );
    pruned += deleted.rowCount ?? 0;
  }
  return { diagramsChecked: candidates.rows.length, revisionsPruned: pruned };
};

/**
 * Expired idempotency data, respecting the replay policy:
 *  - past the replay window the stored response body goes, but the row stays as a tombstone (the key must keep answering
 *    "expired" and never re-execute);
 *  - execution diagnostics and finally the tombstones themselves go after their own, longer windows;
 *  - requests that are still processing or waiting for a retry are never touched.
 */
export const cleanupExpiredRequests: JobHandler = async (_payload, { pool, policy, signal }) => {
  const bodies = await pool.query(
    `UPDATE mutation_requests SET response_body = NULL
      WHERE id IN (
        SELECT id FROM mutation_requests
         WHERE status IN ('SUCCEEDED', 'FAILED') AND response_body IS NOT NULL AND completed_at < now() - make_interval(days => $1)
         LIMIT $2
      )`,
    [REPLAY_DAYS, policy.batchSize * 20],
  );
  if (signal.aborted) return { bodiesDropped: bodies.rowCount ?? 0, executionsDeleted: 0, tombstonesDeleted: 0, usageRowsDeleted: 0 };
  const executions = await pool.query(
    `DELETE FROM command_executions
      WHERE id IN (SELECT id FROM command_executions WHERE created_at < now() - make_interval(days => $1) LIMIT $2)`,
    [policy.executionDays, policy.batchSize * 20],
  );
  if (signal.aborted) return { bodiesDropped: bodies.rowCount ?? 0, executionsDeleted: executions.rowCount ?? 0, tombstonesDeleted: 0, usageRowsDeleted: 0 };
  const tombstones = await pool.query(
    `DELETE FROM mutation_requests
      WHERE id IN (
        SELECT m.id FROM mutation_requests m
         WHERE m.status IN ('SUCCEEDED', 'FAILED') AND m.completed_at < now() - make_interval(days => $1)
           AND NOT EXISTS (SELECT 1 FROM command_executions e WHERE e.mutation_request_id = m.id)
         LIMIT $2
      )`,
    [policy.tombstoneDays, policy.batchSize * 20],
  );
  const usageDays = await purgeOldUsage(pool);
  return { bodiesDropped: bodies.rowCount ?? 0, executionsDeleted: executions.rowCount ?? 0, tombstonesDeleted: tombstones.rowCount ?? 0, usageRowsDeleted: usageDays };
};

/**
 * Physically remove diagrams that were soft-deleted longer ago than the recovery window, with everything that hangs off them.
 * One diagram per transaction, so a failure leaves whole diagrams, never half of one. Live diagrams are never matched.
 */
export const purgeDeletedDiagrams: JobHandler = async (_payload, { pool, policy, signal }) => {
  const due = await pool.query<{ id: string }>(
    `SELECT id FROM diagrams WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $1) ORDER BY deleted_at LIMIT $2`,
    [policy.deletedDiagramDays, policy.batchSize],
  );
  let purged = 0;
  for (const { id } of due.rows) {
    if (signal.aborted) break;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Same lock order as every edit (idempotency rows first, then the diagram row), so a purge and an edit can never wait on each
      // other in a circle; and if a row is busy, give up quickly: the job retries (the diagram is still due next run).
      await client.query(`SET LOCAL lock_timeout = '3s'`);
      await client.query(`SELECT id FROM mutation_requests WHERE diagram_id = $1 ORDER BY id FOR UPDATE`, [id]);
      // Re-check inside the transaction: the diagram must still be deleted and still past the window.
      const still = await client.query(`SELECT 1 FROM diagrams WHERE id = $1 AND deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $2) FOR UPDATE`, [id, policy.deletedDiagramDays]);
      if (still.rows.length === 0) {
        await client.query('ROLLBACK');
        continue;
      }
      await client.query(`DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE diagram_id = $1)`, [id]);
      await client.query(`DELETE FROM conversations WHERE diagram_id = $1`, [id]);
      await client.query(`DELETE FROM command_executions WHERE diagram_id = $1`, [id]);
      await client.query(`DELETE FROM mutation_requests WHERE diagram_id = $1`, [id]);
      await client.query(`DELETE FROM diagram_revisions WHERE diagram_id = $1`, [id]);
      await client.query(`DELETE FROM diagrams WHERE id = $1`, [id]);
      await client.query('COMMIT');
      purged += 1;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new JobError('EXTERNAL', `Could not purge a diagram: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  return { diagramsDue: due.rows.length, diagramsPurged: purged };
};

export const HANDLERS: Record<JobType, JobHandler> = {
  PRUNE_REVISIONS: pruneRevisions,
  CLEANUP_EXPIRED_REQUESTS: cleanupExpiredRequests,
  PURGE_DELETED_DIAGRAMS: purgeDeletedDiagrams,
};
