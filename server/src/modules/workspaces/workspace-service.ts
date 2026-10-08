import { LIMITS, type CreateWorkspaceRequest, type WorkspaceSummary } from '@tinker/shared';
import { runIdempotent, type RunResult } from '../../infrastructure/idempotency/mutation-requests.ts';
import { failure, type Actor, type ServiceDeps } from '../diagrams/application/diagram-service.ts';

/**
 * POST /v1/workspaces. A person can start a team workspace of their own (they become its OWNER). Like every durable write it is
 * idempotent, and the cap is checked inside the transaction that creates the workspace, so two simultaneous requests cannot both
 * slip past it (the person's row is locked for the length of the check).
 */
export async function createWorkspace(deps: ServiceDeps, actor: Actor, key: string, input: CreateWorkspaceRequest): Promise<RunResult> {
  return runIdempotent(
    deps.pool,
    { actorId: actor.userId, key, method: 'POST', resource: '/v1/workspaces', body: input, diagramId: null },
    async (tx) => {
      await tx.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [actor.userId]);
      const owned = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM workspaces w JOIN workspace_memberships m ON m.workspace_id = w.id
          WHERE m.user_id = $1 AND m.role = 'OWNER' AND w.personal_for_user_id IS NULL`,
        [actor.userId],
      );
      if ((owned.rows[0]?.n ?? 0) >= LIMITS.maxOwnedWorkspaces) {
        return failure(actor.requestId, 'DOMAIN_VALIDATION_FAILED', `You can own up to ${LIMITS.maxOwnedWorkspaces} team workspaces.`, { reason: 'LIMIT_EXCEEDED', limit: LIMITS.maxOwnedWorkspaces });
      }
      const created = await tx.query<{ id: string; name: string }>(`INSERT INTO workspaces (name, created_by) VALUES ($1, $2) RETURNING id, name`, [input.name, actor.userId]);
      const workspace = created.rows[0]!;
      await tx.query(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`, [workspace.id, actor.userId]);
      await tx.query(`INSERT INTO projects (workspace_id, name, created_by) VALUES ($1, 'General', $2)`, [workspace.id, actor.userId]);
      const body: WorkspaceSummary = { id: workspace.id, name: workspace.name, role: 'OWNER', personal: false, description: null, visibility: 'PRIVATE', diagramCount: 0, memberCount: 1, projectCount: 1, cover: null, updatedAt: new Date().toISOString() };
      return { status: 201, body };
    },
    deps.hooks,
  );
}
