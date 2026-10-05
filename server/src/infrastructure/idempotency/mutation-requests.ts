import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../http/errors.ts';
import { withTransaction, type Pool, type PoolClient } from '../database/pool.ts';

/** Decisions D01-D03. Lease for a reservation; long enough to cover a 15 s AI interpretation (I5) with headroom. */
export const LEASE_SECONDS = 60;
/** Full response replay window; after this the compact tombstone answers IDEMPOTENCY_RESULT_EXPIRED (never re-executes). */
export const REPLAY_DAYS = 7;
export const MAX_ATTEMPTS = 3;

export interface Outcome {
  status: number;
  body: unknown;
}

export interface MutationIdentity {
  actorId: string;
  key: string;
  method: string;
  /** Normalised resource path including ids, e.g. `/v1/diagrams/<uuid>/commands`. */
  resource: string;
  /** Validated original request body (never provider output). */
  body: unknown;
  diagramId: string | null;
}

/** Stable JSON: object keys sorted, so semantically equal requests hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Hash of API version + method + resource path + validated body (expectedVersion lives in the body or query). */
export function requestHash(identity: Pick<MutationIdentity, 'method' | 'resource' | 'body'>): string {
  return createHash('sha256')
    .update(canonicalJson({ api: 'v1', method: identity.method, resource: identity.resource, body: identity.body }))
    .digest('hex');
}

type Reservation =
  | { kind: 'reserved'; id: string; leaseToken: string }
  | { kind: 'replay'; outcome: Outcome };

interface ExistingRow {
  id: string;
  request_hash: string;
  status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'RETRYABLE_FAILED';
  live: boolean;
  attempt_count: number;
  response_status: number | null;
  response_body: unknown;
  expired_result: boolean;
}

/**
 * Short reservation transaction. Exactly one caller per (actor, key) ever holds an active lease:
 * - new key: reserve; same key + same hash: replay a stored result, report in-progress, or take over an EXPIRED lease;
 * - same key + different hash: IDEMPOTENCY_KEY_REUSED. An expired lease alone never proves failure, but because
 *   completion commits atomically with the mutation, an expired PROCESSING row means nothing was committed.
 */
const VANISHED = Symbol('reservation vanished');

async function reserveOnce(pool: Pool, identity: MutationIdentity, hash: string, leaseSeconds: number): Promise<Reservation | typeof VANISHED> {
  return withTransaction(pool, async (tx) => {
    const leaseToken = randomUUID();
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO mutation_requests
         (actor_id, idempotency_key, request_hash, method, resource, diagram_id, status, lease_token, lease_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PROCESSING', $7, now() + make_interval(secs => $8))
       ON CONFLICT (actor_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [identity.actorId, identity.key, hash, identity.method, identity.resource, identity.diagramId, leaseToken, leaseSeconds],
    );
    if (inserted.rows[0]) return { kind: 'reserved', id: inserted.rows[0].id, leaseToken };

    const existing = await tx.query<ExistingRow>(
      `SELECT id, request_hash, status, attempt_count, response_status, response_body,
              (lease_expires_at > now()) AS live,
              (completed_at IS NOT NULL AND completed_at < now() - make_interval(days => $3)) AS expired_result
         FROM mutation_requests
        WHERE actor_id = $1 AND idempotency_key = $2
        FOR UPDATE`,
      [identity.actorId, identity.key, REPLAY_DAYS],
    );
    const row = existing.rows[0];
    if (!row) return VANISHED; // the holder released it between our INSERT and SELECT; try again
    if (row.request_hash !== hash) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.');
    }
    if (row.status === 'SUCCEEDED' || row.status === 'FAILED') {
      if (row.expired_result) {
        throw new AppError('IDEMPOTENCY_RESULT_EXPIRED', 'The original result is no longer stored; fetch the current state and retry with a new key.');
      }
      return { kind: 'replay', outcome: { status: row.response_status ?? 200, body: row.response_body } };
    }
    if (row.status === 'PROCESSING' && row.live) {
      throw new AppError('REQUEST_ALREADY_PROCESSING', 'This request is already being processed.');
    }
    if (row.attempt_count >= MAX_ATTEMPTS) {
      throw new AppError('SERVICE_UNAVAILABLE', 'The request could not be completed after several attempts.');
    }
    await tx.query(
      `UPDATE mutation_requests
          SET status = 'PROCESSING', lease_token = $2, lease_expires_at = now() + make_interval(secs => $3),
              attempt_count = attempt_count + 1, updated_at = now()
        WHERE id = $1`,
      [row.id, leaseToken, leaseSeconds],
    );
    return { kind: 'reserved', id: row.id, leaseToken };
  });
}

async function reserve(pool: Pool, identity: MutationIdentity, hash: string, leaseSeconds: number): Promise<Reservation> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await reserveOnce(pool, identity, hash, leaseSeconds);
    if (result !== VANISHED) return result;
  }
  throw new AppError('REQUEST_ALREADY_PROCESSING', 'This request is being processed; retry shortly.');
}

/** Lock the reservation row and prove we still own an unexpired lease (late/cancelled work must fail here). */
async function lockReservation(tx: PoolClient, id: string, leaseToken: string): Promise<void> {
  const { rows } = await tx.query<{ ok: boolean }>(
    `SELECT (status = 'PROCESSING' AND lease_token = $2 AND lease_expires_at > now()) AS ok
       FROM mutation_requests WHERE id = $1 FOR UPDATE`,
    [id, leaseToken],
  );
  if (!rows[0]?.ok) throw new AppError('REQUEST_ALREADY_PROCESSING', 'This request is no longer owned by this attempt.');
}

async function completeReservation(tx: PoolClient, id: string, outcome: Outcome): Promise<void> {
  await tx.query(
    `UPDATE mutation_requests
        SET status = $2, response_status = $3, response_body = $4::jsonb,
            lease_token = NULL, lease_expires_at = NULL, completed_at = now(), updated_at = now()
      WHERE id = $1`,
    [id, outcome.status < 400 ? 'SUCCEEDED' : 'FAILED', outcome.status, JSON.stringify(outcome.body)],
  );
}

/** Give the key back after an error that committed nothing (auth failure, DB error): a retry may run again. */
async function releaseReservation(pool: Pool, id: string, leaseToken: string): Promise<void> {
  await pool.query(`DELETE FROM mutation_requests WHERE id = $1 AND lease_token = $2 AND status = 'PROCESSING'`, [id, leaseToken]);
}

export type FaultHook = (stage: string) => void | Promise<void>;

/** Test-only knobs: fault injection at named stages and a short lease to exercise expiry/fencing. */
export interface TestHooks {
  fault?: FaultHook;
  leaseSeconds?: number;
}

export interface RunResult {
  outcome: Outcome;
  replayed: boolean;
}

/**
 * Execute a durable mutation at most once per (actor, Idempotency-Key).
 * `commit` runs inside ONE transaction together with the reservation completion: the mutation, its revision,
 * its execution record and the stored response commit or roll back as a unit. It must re-authorise.
 * It returns a terminal outcome (success or a deterministic 4xx such as a version conflict) or throws an AppError
 * for failures that must NOT be cached (e.g. revoked access); those release the reservation.
 */
export async function runIdempotent(
  pool: Pool,
  identity: MutationIdentity,
  commit: (tx: PoolClient, mutationRequestId: string) => Promise<Outcome>,
  hooks: TestHooks = {},
): Promise<RunResult> {
  const fault = hooks.fault;
  const hash = requestHash(identity);
  const reservation = await reserve(pool, identity, hash, hooks.leaseSeconds ?? LEASE_SECONDS);
  if (reservation.kind === 'replay') return { outcome: reservation.outcome, replayed: true };

  try {
    // Work done here (an AI call in I5) happens while holding only the lease; late results must fail the lock below.
    await fault?.('after-reserve');
    const outcome = await withTransaction(pool, async (tx) => {
      await lockReservation(tx, reservation.id, reservation.leaseToken);
      const result = await commit(tx, reservation.id);
      await fault?.('before-complete');
      await completeReservation(tx, reservation.id, result);
      return result;
    });
    return { outcome, replayed: false };
  } catch (error) {
    await releaseReservation(pool, reservation.id, reservation.leaseToken).catch(() => undefined);
    throw error;
  }
}
