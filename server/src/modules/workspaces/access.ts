import type { ProjectCover, WorkspaceRole, WorkspaceSummary } from '@tinker/shared';
import type { Queryable } from '../../infrastructure/database/pool.ts';
import { AppError } from '../../infrastructure/http/errors.ts';

export type Permission = 'view' | 'modify' | 'delete';

/** Role table from the LLD (section 2). Run-AI follows `modify`; managing a workspace and its members is OWNER-only. */
const GRANTS: Record<WorkspaceRole, readonly Permission[]> = {
  OWNER: ['view', 'modify', 'delete'],
  EDITOR: ['view', 'modify'],
  VIEWER: ['view'],
};
export const can = (role: WorkspaceRole, permission: Permission): boolean => GRANTS[role].includes(permission);

interface SummaryRow {
  id: string;
  name: string;
  role: WorkspaceRole;
  personal: boolean;
  description: string | null;
  visibility: 'PRIVATE' | 'PUBLIC';
  diagram_count: number;
  member_count: number;
  project_count: number;
  cover: ProjectCover | null;
  updated_at: Date;
}

const toSummary = (r: SummaryRow): WorkspaceSummary => ({
  id: r.id,
  name: r.name,
  role: r.role,
  personal: r.personal,
  description: r.description,
  visibility: r.visibility,
  diagramCount: r.diagram_count,
  memberCount: r.member_count,
  projectCount: r.project_count,
  cover: r.cover,
  updatedAt: r.updated_at.toISOString(),
});

/** What the dashboard shows per workspace: the person's role, how many diagrams and members, and when anything last changed. */
const SUMMARY_SELECT = `
  w.id, w.name, w.description, w.visibility, w.cover, (w.personal_for_user_id IS NOT NULL) AS personal,
  (SELECT count(*)::int FROM diagrams d WHERE d.workspace_id = w.id AND d.deleted_at IS NULL) AS diagram_count,
  (SELECT count(*)::int FROM workspace_memberships mm WHERE mm.workspace_id = w.id) AS member_count,
  (SELECT count(*)::int FROM projects pp WHERE pp.workspace_id = w.id AND pp.deleted_at IS NULL) AS project_count,
  GREATEST(w.updated_at, COALESCE((SELECT max(d.updated_at) FROM diagrams d WHERE d.workspace_id = w.id AND d.deleted_at IS NULL), w.updated_at)) AS updated_at`;

export async function listWorkspaces(db: Queryable, userId: string): Promise<WorkspaceSummary[]> {
  const { rows } = await db.query<SummaryRow>(
    `SELECT ${SUMMARY_SELECT}, m.role
       FROM workspace_memberships m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 AND w.deleted_at IS NULL
      ORDER BY w.created_at, w.id`,
    [userId],
  );
  return rows.map(toSummary);
}

/** One workspace for a person who may see it: a member, or anyone looking at a public one (as a viewer). Otherwise null. */
export async function getWorkspaceSummary(db: Queryable, userId: string, workspaceId: string): Promise<{ summary: WorkspaceSummary; member: boolean } | null> {
  const { rows } = await db.query<SummaryRow & { member_role: WorkspaceRole | null }>(
    `SELECT ${SUMMARY_SELECT}, m.role AS member_role, COALESCE(m.role, 'VIEWER') AS role
       FROM workspaces w LEFT JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = $2
      WHERE w.id = $1 AND w.deleted_at IS NULL AND (m.user_id IS NOT NULL OR w.visibility = 'PUBLIC')`,
    [workspaceId, userId],
  );
  const row = rows[0];
  return row ? { summary: toSummary(row), member: row.member_role !== null } : null;
}

/** Role of `userId` in a workspace (a viewer for anyone looking at a public one), or null when they may not see it. */
export async function workspaceRole(db: Queryable, userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
  const { rows } = await db.query<{ role: WorkspaceRole }>(
    `SELECT COALESCE(m.role, 'VIEWER') AS role
       FROM workspaces w LEFT JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = $2
      WHERE w.id = $1 AND w.deleted_at IS NULL AND (m.user_id IS NOT NULL OR w.visibility = 'PUBLIC')`,
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
    `SELECT d.workspace_id, COALESCE(m.role, 'VIEWER') AS role
       FROM diagrams d
       JOIN workspaces w ON w.id = d.workspace_id AND w.deleted_at IS NULL
       LEFT JOIN workspace_memberships m ON m.workspace_id = d.workspace_id AND m.user_id = $2
      WHERE d.id = $1 AND d.deleted_at IS NULL AND (m.user_id IS NOT NULL OR w.visibility = 'PUBLIC')`,
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
