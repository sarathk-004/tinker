import { randomUUID } from 'node:crypto';
import type {
  CommandRequest,
  CommandResponse,
  DeleteDiagramResponse,
  DiagramDetail,
  DiagramListResponse,
  ErrorCode,
  ErrorEnvelope,
  PresentationPatchRequest,
} from '@tinker/shared';
import { ERROR_HTTP_STATUS } from '@tinker/shared';
import type { Pool, PoolClient } from '../../../infrastructure/database/pool.ts';
import { AppError } from '../../../infrastructure/http/errors.ts';
import { runIdempotent, type Outcome, type RunResult, type TestHooks } from '../../../infrastructure/idempotency/mutation-requests.ts';
import { authorizeDiagram, authorizeWorkspace } from '../../workspaces/access.ts';
import { applyCommand } from '../domain/index.ts';
import {
  attachDiagramToRequest,
  getDiagramRow,
  insertCommandExecution,
  insertDiagram,
  insertRevision,
  listDiagramSummaries,
  lockDiagramRow,
  updateDocument,
  type DiagramRow,
} from '../persistence/diagrams.ts';

export interface ServiceDeps {
  pool: Pool;
  /** Test-only fault injection and lease override (rollback/expiry tests). Never set in production. */
  hooks?: TestHooks;
  newId?: () => string;
}

export interface Actor {
  userId: string;
  requestId: string;
}

export const detail = (row: DiagramRow): DiagramDetail => ({
  diagramId: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  version: row.version,
  graph: row.graph,
  presentation: row.presentation,
  updatedAt: row.updatedAt.toISOString(),
});

/** Deterministic failures (version conflict, domain refusal) are stored and replayed exactly like successes (D03). */
export function failure(requestId: string, code: ErrorCode, message: string, details?: Record<string, unknown>): Outcome {
  const body: ErrorEnvelope = { error: { code, message, requestId, ...(details ? { details } : {}) } };
  return { status: ERROR_HTTP_STATUS[code], body };
}

// ---------- reads ----------

export async function loadDiagram(deps: ServiceDeps, actor: Actor, diagramId: string): Promise<DiagramDetail> {
  await authorizeDiagram(deps.pool, actor.userId, diagramId, 'view');
  const row = await getDiagramRow(deps.pool, diagramId);
  if (!row) throw new AppError('DIAGRAM_NOT_FOUND', 'Diagram not found.');
  return detail(row);
}

export async function listDiagrams(deps: ServiceDeps, actor: Actor, workspaceId: string): Promise<DiagramListResponse> {
  await authorizeWorkspace(deps.pool, actor.userId, workspaceId, 'view');
  return { diagrams: await listDiagramSummaries(deps.pool, workspaceId) };
}

// ---------- durable mutations (all idempotent) ----------

export async function createDiagram(deps: ServiceDeps, actor: Actor, workspaceId: string, key: string, input: { name: string }): Promise<RunResult> {
  await authorizeWorkspace(deps.pool, actor.userId, workspaceId, 'modify');
  return runIdempotent(
    deps.pool,
    { actorId: actor.userId, key, method: 'POST', resource: `/v1/workspaces/${workspaceId}/diagrams`, body: input, diagramId: null },
    async (tx, mutationRequestId) => {
      await authorizeWorkspace(tx, actor.userId, workspaceId, 'modify');
      const row = await insertDiagram(tx, { workspaceId, name: input.name, createdBy: actor.userId });
      await attachDiagramToRequest(tx, mutationRequestId, row.id);
      // A baseline to go back to: without it the very first change could never be undone.
      await insertRevision(tx, { diagramId: row.id, version: row.version, graph: row.graph, presentation: row.presentation, reason: 'CHECKPOINT', createdBy: actor.userId });
      return { status: 201, body: detail(row) };
    },
    deps.hooks,
  );
}

export async function renameDiagram(deps: ServiceDeps, actor: Actor, diagramId: string, key: string, input: { expectedVersion: number; name: string }): Promise<RunResult> {
  await authorizeDiagram(deps.pool, actor.userId, diagramId, 'modify');
  return runIdempotent(
    deps.pool,
    { actorId: actor.userId, key, method: 'PATCH', resource: `/v1/diagrams/${diagramId}`, body: input, diagramId },
    async (tx) => {
      await authorizeDiagram(tx, actor.userId, diagramId, 'modify');
      const current = await lockDiagramRow(tx, diagramId);
      if (!current) throw new AppError('DIAGRAM_NOT_FOUND', 'Diagram not found.');
      if (current.version !== input.expectedVersion) return versionConflict(actor, input.expectedVersion, current.version);
      const updated = await updateDocument(tx, { id: diagramId, expectedVersion: input.expectedVersion, name: input.name });
      if (!updated) throw new Error('conditional update affected no rows while holding the row lock');
      return { status: 200, body: detail(updated) };
    },
    deps.hooks,
  );
}

export async function deleteDiagram(deps: ServiceDeps, actor: Actor, diagramId: string, key: string, input: { expectedVersion: number }): Promise<RunResult> {
  await authorizeDiagram(deps.pool, actor.userId, diagramId, 'delete');
  return runIdempotent(
    deps.pool,
    { actorId: actor.userId, key, method: 'DELETE', resource: `/v1/diagrams/${diagramId}`, body: input, diagramId },
    async (tx) => {
      await authorizeDiagram(tx, actor.userId, diagramId, 'delete');
      const current = await lockDiagramRow(tx, diagramId);
      if (!current) throw new AppError('DIAGRAM_NOT_FOUND', 'Diagram not found.');
      if (current.version !== input.expectedVersion) return versionConflict(actor, input.expectedVersion, current.version);
      const updated = await updateDocument(tx, { id: diagramId, expectedVersion: input.expectedVersion, deleted: true });
      if (!updated) throw new Error('conditional update affected no rows while holding the row lock');
      const body: DeleteDiagramResponse = { diagramId, version: updated.version, deleted: true };
      return { status: 200, body };
    },
    deps.hooks,
  );
}

/**
 * The one structural-edit path. Manual edits call it today; typed AI (I5) and voice (I7) will call the same function
 * with interpreted commands (architecture invariant: one DiagramCommand handler).
 */
export async function executeCommand(deps: ServiceDeps, actor: Actor, diagramId: string, key: string, request: CommandRequest): Promise<RunResult> {
  await authorizeDiagram(deps.pool, actor.userId, diagramId, 'modify');
  const newId = deps.newId ?? randomUUID;
  return runIdempotent(
    deps.pool,
    { actorId: actor.userId, key, method: 'POST', resource: `/v1/diagrams/${diagramId}/commands`, body: request, diagramId },
    async (tx, mutationRequestId) => {
      await authorizeDiagram(tx, actor.userId, diagramId, 'modify'); // access may have been revoked since the pre-check
      const current = await lockDiagramRow(tx, diagramId);
      if (!current) throw new AppError('DIAGRAM_NOT_FOUND', 'Diagram not found.');
      const record = (status: 'SUCCEEDED' | 'FAILED', extra: { errorCode?: string; resultVersion?: number } = {}) =>
        insertCommandExecution(tx, {
          mutationRequestId,
          diagramId,
          actorId: actor.userId,
          command: request.command,
          status,
          expectedVersion: request.expectedVersion,
          ...extra,
        });

      if (current.version !== request.expectedVersion) {
        await record('FAILED', { errorCode: 'DIAGRAM_VERSION_CONFLICT' });
        return versionConflict(actor, request.expectedVersion, current.version);
      }
      const applied = applyCommand({ graph: current.graph, presentation: current.presentation }, request.command, newId);
      if (!applied.ok) {
        await record('FAILED', { errorCode: 'DOMAIN_VALIDATION_FAILED' });
        return failure(actor.requestId, 'DOMAIN_VALIDATION_FAILED', applied.error.message, { reason: applied.error.reason, ...applied.error.details });
      }

      // Conditional update + revision + execution record + stored response: one transaction (LLD section 7).
      const updated = await updateDocument(tx, {
        id: diagramId,
        expectedVersion: request.expectedVersion,
        graph: applied.value.graph,
        presentation: applied.value.presentation,
      });
      if (!updated) throw new Error('conditional update affected no rows while holding the row lock');
      await deps.hooks?.fault?.('after-diagram-update');
      await insertRevision(tx, {
        diagramId,
        version: updated.version,
        graph: updated.graph,
        presentation: updated.presentation,
        reason: 'MANUAL_COMMAND',
        createdBy: actor.userId,
      });
      await deps.hooks?.fault?.('after-revision');
      await record('SUCCEEDED', { resultVersion: updated.version });

      const body: CommandResponse = {
        diagramId,
        version: updated.version,
        appliedCommand: { type: request.command.type },
        graph: updated.graph,
        presentation: updated.presentation,
      };
      return { status: 200, body };
    },
    deps.hooks,
  );
}

/**
 * Drag-end / viewport saves (D05): provided positions merge by node id, absent entries stay, unknown nodes are refused.
 * Bumps the one version counter; creates no revision (no revision per pointer movement).
 */
export async function patchPresentation(deps: ServiceDeps, actor: Actor, diagramId: string, key: string, request: PresentationPatchRequest): Promise<RunResult> {
  await authorizeDiagram(deps.pool, actor.userId, diagramId, 'modify');
  return runIdempotent(
    deps.pool,
    { actorId: actor.userId, key, method: 'PATCH', resource: `/v1/diagrams/${diagramId}/presentation`, body: request, diagramId },
    async (tx: PoolClient) => {
      await authorizeDiagram(tx, actor.userId, diagramId, 'modify');
      const current = await lockDiagramRow(tx, diagramId);
      if (!current) throw new AppError('DIAGRAM_NOT_FOUND', 'Diagram not found.');
      if (current.version !== request.expectedVersion) return versionConflict(actor, request.expectedVersion, current.version);

      const known = new Set(current.graph.nodes.map((n) => n.id));
      for (const nodeId of Object.keys(request.nodePositions ?? {})) {
        if (!known.has(nodeId)) {
          return failure(actor.requestId, 'DOMAIN_VALIDATION_FAILED', 'A position refers to a node that does not exist.', { reason: 'NODE_NOT_FOUND', nodeId });
        }
      }
      // Remembered arrangements may only mention components that exist.
      const knownOnly = (positions: Record<string, { x: number; y: number }> | undefined) => positions && Object.fromEntries(Object.entries(positions).filter(([id]) => known.has(id)));
      const layouts = request.layouts ? { ...(request.layouts.LR ? { LR: knownOnly(request.layouts.LR)! } : {}), ...(request.layouts.TB ? { TB: knownOnly(request.layouts.TB)! } : {}) } : current.presentation.layouts;
      const presentation = {
        nodePositions: { ...current.presentation.nodePositions, ...(request.nodePositions ?? {}) },
        viewport: request.viewport ?? current.presentation.viewport,
        ...((request.notes ?? current.presentation.notes) ? { notes: request.notes ?? current.presentation.notes! } : {}),
        ...((request.layoutDir ?? current.presentation.layoutDir) ? { layoutDir: request.layoutDir ?? current.presentation.layoutDir! } : {}),
        ...(layouts && Object.keys(layouts).length > 0 ? { layouts } : {}),
      };
      const updated = await updateDocument(tx, { id: diagramId, expectedVersion: request.expectedVersion, presentation });
      if (!updated) throw new Error('conditional update affected no rows while holding the row lock');
      return { status: 200, body: detail(updated) };
    },
    deps.hooks,
  );
}

export function versionConflict(actor: Actor, expectedVersion: number, currentVersion: number): Outcome {
  return failure(actor.requestId, 'DIAGRAM_VERSION_CONFLICT', 'The diagram has changed since this request was created.', { expectedVersion, currentVersion });
}

/** Make a stored outcome safe to send again: mark success replays, and stamp the current request id on stored errors. */
export function presentOutcome(result: RunResult, requestId: string): Outcome {
  if (!result.replayed) return result.outcome;
  const body = result.outcome.body;
  if (body && typeof body === 'object' && 'error' in (body as object)) {
    const envelope = body as ErrorEnvelope;
    return { status: result.outcome.status, body: { error: { ...envelope.error, requestId } } };
  }
  return { status: result.outcome.status, body: { ...(body as object), replayed: true } };
}
