import type { WorkspaceRole, WorkspaceSummary } from '@tinker/shared';
import type { Queryable } from '../../infrastructure/database/pool.ts';
import { AppError } from '../../infrastructure/http/errors.ts';

export type Permission = 'view' | 'modify' | 'delete';

/** Role table from the LLD (section 2). Run-AI follows `modify`; managing a workspace is OWNER-only (later milestone). */
const GRANTS: Record<WorkspaceRole, readonly Permission[]> = {
  OWNER: ['view', 'modify', 'delete'],
  EDITOR: ['view', 'modify'],
  VIEWER: ['view'],
};
export const can = (role: WorkspaceRole, permission: Permission): boolean => GRANTS[role].includes(permission);

export async function listWorkspaces(db: Queryable, userId: string): Promise<WorkspaceSummary[]> {
  const { rows } = await db.query<{ id: string; name: string; role: WorkspaceRole; personal: boolean }>(
    `SELECT w.id, w.name, m.role, (w.personal_for_user_id IS NOT NULL) AS personal
       FROM workspace_memberships m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1
      ORDER BY w.created_at, w.id`,
    [userId],
  );
  return rows;
}

/** Role of `userId` in a workspace, or null when they are not a member. */
export async function workspaceRole(db: Queryable, userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
  const { rows } = await db.query<{ role: WorkspaceRole }>(
    `SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId],
  );
  return rows[0]?.role ?? null;
}

export interface DiagramAccess {
  diagramId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

/**
 * Authorization for a diagram (decision D09): non-members and soft-deleted diagrams both look like a missing
 * diagram (uniform 404, no cross-tenant disclosure); a member with too little role gets 403.
 * Called on EVERY request and again inside the commit transaction, so a replay never outlives revoked access.
 */
export async function authorizeDiagram(db: Queryable, userId: string, diagramId: string, permission: Permission): Promise<DiagramAccess> {
  const { rows } = await db.query<{ workspace_id: string; role: WorkspaceRole }>(
    `SELECT d.workspace_id, m.role
       FROM diagrams d
       JOIN workspace_memberships m ON m.workspace_id = d.workspace_id AND m.user_id = $2
      WHERE d.id = $1 AND d.deleted_at IS NULL`,
    [diagramId, userId],
  );
  const row = rows[0];
  if (!row) throw new AppError('DIAGRAM_NOT_FOUND', 'Diagram not found.');
  if (!can(row.role, permission)) throw new AppError('FORBIDDEN', 'You do not have permission to do that.');
  return { diagramId, workspaceId: row.workspace_id, role: row.role };
}

/** Same rule for workspace-level actions. Unknown workspace and non-membership are indistinguishable (404). */
export async function authorizeWorkspace(db: Queryable, userId: string, workspaceId: string, permission: Permission): Promise<WorkspaceRole> {
  const role = await workspaceRole(db, userId, workspaceId);
  if (!role) throw new AppError('NOT_FOUND', 'Workspace not found.');
  if (!can(role, permission)) throw new AppError('FORBIDDEN', 'You do not have permission to do that.');
  return role;
}
