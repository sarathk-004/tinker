import type { Pool } from '../../infrastructure/database/pool.ts';
import { DEFAULT_RETENTION, HANDLERS, type JobHandler, type RetentionPolicy } from './handlers.ts';
import { JOB_TYPES, claimJob, completeJob, enqueue, failJob, heartbeat, JobError, type ClaimedJob, type JobType } from './queue.ts';

export interface WorkerOptions {
  pool: Pool;
  handlers?: Partial<Record<JobType, JobHandler>>;
  policy?: RetentionPolicy;
  /** How long a claim is valid without a heartbeat. A holder that dies is replaced after this. */
  leaseSeconds?: number;
  log?: (message: string, data: Record<string, unknown>) => void;
}

export type RunOutcome =
  | { status: 'IDLE' }
  | { status: 'COMPLETED'; job: ClaimedJob; result: Record<string, number> }
  | { status: 'RETRY' | 'DEAD_LETTER'; job: ClaimedJob }
  /** The lease was taken over while we worked: nothing we did is recorded (our side effects are idempotent by design). */
  | { status: 'FENCED'; job: ClaimedJob };

/**
 * Claim and run ONE job. The claim is a short transaction; the handler runs outside it with a heartbeat keeping the lease
 * alive. Completion and failure present the lease token, so a worker that was replaced cannot overwrite the new holder's
 * outcome. Handlers must be idempotent: after a crash the same job runs again.
 */
export async function runOnce(options: WorkerOptions): Promise<RunOutcome> {
  const leaseSeconds = options.leaseSeconds ?? 60;
  const job = await claimJob(options.pool, { leaseSeconds });
  if (!job) return { status: 'IDLE' };

  options.log?.('job claimed', { type: job.type, attempt: job.attempt, tookOver: job.tookOver });
  const started = Date.now();
  const controller = new AbortController();
  const timer = setInterval(() => {
    void heartbeat(options.pool, job, leaseSeconds).then((owned) => {
      if (!owned) controller.abort(); // someone else owns the job now
    }, () => undefined);
  }, Math.max(250, (leaseSeconds * 1000) / 3));
  try {
    const handler = options.handlers?.[job.type] ?? HANDLERS[job.type];
    if (!handler) throw new JobError('SCHEMA', `No handler for ${job.type}`);
    const result = await handler(job.payload, { pool: options.pool, policy: options.policy ?? DEFAULT_RETENTION, signal: controller.signal });
    if (controller.signal.aborted || !(await completeJob(options.pool, job, result))) {
      options.log?.('job fenced', { type: job.type, attempt: job.attempt, ms: Date.now() - started });
      return { status: 'FENCED', job };
    }
    options.log?.('job completed', { type: job.type, attempt: job.attempt, ms: Date.now() - started, ...result });
    return { status: 'COMPLETED', job, result };
  } catch (error) {
    const outcome = await failJob(options.pool, job, error);
    if (outcome === null) return { status: 'FENCED', job };
    options.log?.(outcome === 'DEAD_LETTER' ? 'job dead-lettered' : 'job will retry', { type: job.type, attempt: job.attempt, ms: Date.now() - started, kind: error instanceof JobError ? error.kind : 'INTERNAL' });
    return { status: outcome, job };
  } finally {
    clearInterval(timer);
  }
}

/** Queue the periodic maintenance once per hour (the operation key makes a second enqueue in the same hour a no-op). */
export async function scheduleMaintenance(pool: Pool, now: Date = new Date()): Promise<number> {
  const hour = now.toISOString().slice(0, 13);
  const keys: Array<[JobType, string]> = [
    ['PRUNE_REVISIONS', `prune-revisions:${hour}`],
    ['CLEANUP_EXPIRED_REQUESTS', `cleanup-expired-requests:${hour}`],
    ['PURGE_DELETED_DIAGRAMS', `purge-deleted-diagrams:${hour}`],
  ];
  let created = 0;
  for (const [type, operationKey] of keys) if ((await enqueue(pool, { type, operationKey })).created) created += 1;
  return created;
}

/** Remove finished jobs after a week so the table stays small. Dead letters stay longer for diagnosis. */
export async function trimFinishedJobs(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM jobs WHERE (status = 'COMPLETED' AND completed_at < now() - interval '7 days') OR (status = 'DEAD_LETTER' AND completed_at < now() - interval '30 days')`,
  );
  return rowCount ?? 0;
}

export interface WorkerLoop {
  stop(): Promise<void>;
}

/** Poll for work until stopped; schedule maintenance on start and every hour. */
export function startWorker(options: WorkerOptions & { pollMs?: number }): WorkerLoop {
  const pollMs = options.pollMs ?? 5_000;
  let stopped = false;
  let wake: (() => void) | undefined;
  const sleep = (ms: number) => new Promise<void>((resolve) => ((wake = resolve), setTimeout(resolve, ms)));
  let lastSchedule = 0;

  const loop = (async () => {
    while (!stopped) {
      try {
        if (Date.now() - lastSchedule > 10 * 60_000) {
          lastSchedule = Date.now();
          await scheduleMaintenance(options.pool);
          await trimFinishedJobs(options.pool);
        }
        const outcome = await runOnce(options);
        if (outcome.status === 'IDLE') await sleep(pollMs);
      } catch (error) {
        options.log?.('worker loop error', { name: error instanceof Error ? error.name : 'unknown' });
        await sleep(pollMs);
      }
    }
  })();

  return {
    async stop() {
      stopped = true;
      wake?.();
      await loop;
    },
  };
}

export { JOB_TYPES };
