import { isDeepStrictEqual } from 'node:util';
import { REVISION_RETENTION, type RestoreRequest, type RevisionDetail, type RevisionListResponse } from '@tinker/shared';
import { AppError } from '../../../infrastructure/http/errors.ts';
import { runIdempotent, type RunResult } from '../../../infrastructure/idempotency/mutation-requests.ts';
import { authorizeDiagram } from '../../workspaces/access.ts';
import { detail, failure, versionConflict, type Actor, type ServiceDeps } from '../../diagrams/application/diagram-service.ts';
import { insertRevision, lockDiagramRow, updateDocument } from '../../diagrams/persistence/diagrams.ts';
import { getRevision, insertRestoreExecution, listRevisionSummaries } from '../persistence/revisions.ts';

/** GET /v1/diagrams/{id}/revisions. View access is enough to see history. */
export async function listRevisions(deps: ServiceDeps, actor: Actor, diagramId: string, query: { before?: number | undefined; limit: number }): Promise<RevisionListResponse> {
  await authorizeDiagram(deps.pool, actor.userId, diagramId, 'view');
  const page = await listRevisionSummaries(deps.pool, diagramId, query.before, query.limit);
  return { ...page, retention: { ...REVISION_RETENTION } };
}

/** GET /v1/diagrams/{id}/revisions/{version}. */
export async function getRevisionDetail(deps: ServiceDeps, actor: Actor, diagramId: string, version: number): Promise<RevisionDetail> {
  await authorizeDiagram(deps.pool, actor.userId, diagramId, 'view');
  const row = await getRevision(deps.pool, diagramId, version);
  if (!row) throw new AppError('NOT_FOUND', 'That version is not in the history (it may be older than the history window).');
  return row;
}

/**
 * POST /v1/diagrams/{id}/restore (decision D11). Making the diagram look like an older revision is an ordinary new write: same
 * idempotency, same version check, same atomic commit as every other edit, a RESTORE revision and an execution record. The
 * version number only ever goes up. Restoring the content the diagram already has is refused (nothing to do).
 */
export async function restoreRevision(deps: ServiceDeps, actor: Actor, diagramId: string, key: string, request: RestoreRequest): Promise<RunResult> {
  await authorizeDiagram(deps.pool, actor.userId, diagramId, 'modify');
  return runIdempotent(
    deps.pool,
    { actorId: actor.userId, key, method: 'POST', resource: `/v1/diagrams/${diagramId}/restore`, body: request, diagramId },
    async (tx, mutationRequestId) => {
      await authorizeDiagram(tx, actor.userId, diagramId, 'modify'); // access may have been revoked since the pre-check
      const current = await lockDiagramRow(tx, diagramId);
      if (!current) throw new AppError('DIAGRAM_NOT_FOUND', 'Diagram not found.');
      if (current.version !== request.expectedVersion) return versionConflict(actor, request.expectedVersion, current.version);

      const source = await getRevision(tx, diagramId, request.version);
      // 422 (not 404): the DIAGRAM exists; a client must not mistake a missing revision for a missing diagram.
      if (!source) return failure(actor.requestId, 'DOMAIN_VALIDATION_FAILED', 'That version is not in the history (it may be older than the history window).', { reason: 'REVISION_NOT_FOUND' });
      if (isDeepStrictEqual(source.graph, current.graph) && isDeepStrictEqual(source.presentation, current.presentation)) {
        return failure(actor.requestId, 'DOMAIN_VALIDATION_FAILED', 'The diagram already looks like that version.', { reason: 'ALREADY_CURRENT' });
      }

      const updated = await updateDocument(tx, { id: diagramId, expectedVersion: request.expectedVersion, graph: source.graph, presentation: source.presentation });
      if (!updated) throw new Error('conditional update affected no rows while holding the row lock');
      await deps.hooks?.fault?.('after-diagram-update');
      await insertRevision(tx, { diagramId, version: updated.version, graph: updated.graph, presentation: updated.presentation, reason: 'RESTORE', createdBy: actor.userId });
      await deps.hooks?.fault?.('after-revision');
      await insertRestoreExecution(tx, { mutationRequestId, diagramId, actorId: actor.userId, restoredVersion: request.version, expectedVersion: request.expectedVersion, resultVersion: updated.version });
      return { status: 200, body: detail(updated) };
    },
    deps.hooks,
  );
}
