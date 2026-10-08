import { LIMITS, type AddMemberRequest, type UpdateWorkspaceRequest, type WorkspaceDetail, type WorkspaceRole } from '@tinker/shared';
import { withTransaction, type Pool, type Queryable } from '../../infrastructure/database/pool.ts';
import { AppError } from '../../infrastructure/http/errors.ts';
import type { Actor } from '../diagrams/application/diagram-service.ts';
import { authorizeWorkspace, getWorkspaceSummary } from './access.ts';

/**
 * Managing a workspace: settings, delete, members. Only an OWNER may do any of it (except leaving). Each is one short transaction that
 * re-checks the role inside it, so a person removed a moment ago cannot slip a change through.
 */
const ownerOf = async (db: Queryable, userId: string, workspaceId: string) => {
  const role = await authorizeWorkspace(db, userId, workspaceId, 'delete');
  if (role !== 'OWNER') throw new AppError('FORBIDDEN', 'Only an owner can do that.');
};

/** A private workspace never reveals that it exists: "not a member" and "no such workspace" both answer 404. */
export async function getWorkspaceDetail(db: Queryable, userId: string, workspaceId: string): Promise<WorkspaceDetail> {
  const found = await getWorkspaceSummary(db, userId, workspaceId);
  if (!found) throw new AppError('NOT_FOUND', 'Workspace not found.');
  if (!found.member) return { ...found.summary, member: false, members: [], invites: [] };
  const members = await db.query<{ user_id: string; email: string | null; display_name: string | null; role: WorkspaceRole }>(
    `SELECT m.user_id, u.email, u.display_name, m.role
       FROM workspace_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = $1
      ORDER BY (m.role = 'OWNER') DESC, m.created_at, m.user_id`,
    [workspaceId],
  );
  // Only owners see who has been invited but has not signed in yet.
  const invites =
    found.summary.role === 'OWNER'
      ? (await db.query<{ email: string; role: 'EDITOR' | 'VIEWER' }>(`SELECT email, role FROM workspace_invites WHERE workspace_id = $1 ORDER BY created_at`, [workspaceId])).rows
      : [];
  return {
    ...found.summary,
    member: true,
    members: members.rows.map((r) => ({ userId: r.user_id, email: r.email, displayName: r.display_name, role: r.role })),
    invites,
  };
}

export async function updateWorkspace(pool: Pool, actor: Actor, workspaceId: string, input: UpdateWorkspaceRequest): Promise<WorkspaceDetail> {
  await withTransaction(pool, async (tx) => {
    await ownerOf(tx, actor.userId, workspaceId);
    await tx.query(
      `UPDATE workspaces
          SET name = COALESCE($2, name),
              description = CASE WHEN $3::boolean THEN $4 ELSE description END,
              visibility = COALESCE($5, visibility),
              cover = CASE WHEN $6::boolean THEN $7 ELSE cover END,
              updated_at = now()
        WHERE id = $1`,
      [workspaceId, input.name ?? null, input.description !== undefined, input.description || null, input.visibility ?? null, input.cover !== undefined, input.cover ?? null],
    );
  });
  return getWorkspaceDetail(pool, actor.userId, workspaceId);
}

/**
 * Delete a team workspace (the personal one cannot be deleted). Its diagrams are soft-deleted with it, so the usual recovery window and
 * purge job apply; the workspace row itself goes once no diagram remains.
 */
export async function deleteWorkspace(pool: Pool, actor: Actor, workspaceId: string, confirmName: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    await ownerOf(tx, actor.userId, workspaceId);
    const { rows } = await tx.query<{ name: string; personal: boolean }>(`SELECT name, (personal_for_user_id IS NOT NULL) AS personal FROM workspaces WHERE id = $1 FOR UPDATE`, [workspaceId]);
    const ws = rows[0];
    if (!ws) throw new AppError('NOT_FOUND', 'Workspace not found.');
    if (ws.personal) throw new AppError('DOMAIN_VALIDATION_FAILED', 'Your personal workspace cannot be deleted.', { reason: 'PERSONAL_WORKSPACE' });
    if (confirmName.trim() !== ws.name) throw new AppError('DOMAIN_VALIDATION_FAILED', 'Type the workspace name exactly to delete it.', { reason: 'NAME_MISMATCH' });
    await tx.query(`UPDATE diagrams SET deleted_at = COALESCE(deleted_at, now()) WHERE workspace_id = $1`, [workspaceId]);
    await tx.query(`UPDATE projects SET deleted_at = COALESCE(deleted_at, now()) WHERE workspace_id = $1`, [workspaceId]);
    await tx.query(`DELETE FROM workspace_invites WHERE workspace_id = $1`, [workspaceId]);
    await tx.query(`UPDATE workspaces SET deleted_at = now(), updated_at = now() WHERE id = $1`, [workspaceId]);
  });
}

export async function addMember(pool: Pool, actor: Actor, workspaceId: string, input: AddMemberRequest): Promise<'ADDED' | 'INVITED'> {
  return withTransaction(pool, async (tx) => {
    await ownerOf(tx, actor.userId, workspaceId);
    const count = await tx.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM workspace_memberships WHERE workspace_id = $1) + (SELECT count(*) FROM workspace_invites WHERE workspace_id = $1) AS n`,
      [workspaceId],
    );
    if (Number(count.rows[0]?.n ?? 0) >= LIMITS.maxWorkspaceMembers) {
      throw new AppError('DOMAIN_VALIDATION_FAILED', `A workspace can have up to ${LIMITS.maxWorkspaceMembers} people.`, { reason: 'LIMIT_EXCEEDED', limit: LIMITS.maxWorkspaceMembers });
    }
    const person = await tx.query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = $1 ORDER BY created_at LIMIT 1`, [input.email]);
    const user = person.rows[0];
    if (user) {
      const exists = await tx.query(`SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, user.id]);
      if (exists.rows.length > 0) throw new AppError('DOMAIN_VALIDATION_FAILED', 'That person is already in this workspace.', { reason: 'ALREADY_MEMBER' });
      await tx.query(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)`, [workspaceId, user.id, input.role]);
      await tx.query(`DELETE FROM workspace_invites WHERE workspace_id = $1 AND email = $2`, [workspaceId, input.email]);
      await tx.query(`UPDATE workspaces SET updated_at = now() WHERE id = $1`, [workspaceId]);
      return 'ADDED' as const;
    }
    await tx.query(
      `INSERT INTO workspace_invites (workspace_id, email, role, invited_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, email) DO UPDATE SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by`,
      [workspaceId, input.email, input.role, actor.userId],
    );
    return 'INVITED' as const;
  });
}

export async function changeMemberRole(pool: Pool, actor: Actor, workspaceId: string, memberId: string, role: 'EDITOR' | 'VIEWER'): Promise<void> {
  await withTransaction(pool, async (tx) => {
    await ownerOf(tx, actor.userId, workspaceId);
    const target = await tx.query<{ role: WorkspaceRole }>(`SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`, [workspaceId, memberId]);
    if (!target.rows[0]) throw new AppError('NOT_FOUND', 'That person is not in this workspace.');
    if (target.rows[0].role === 'OWNER') throw new AppError('DOMAIN_VALIDATION_FAILED', 'The role of an owner cannot be changed.', { reason: 'OWNER_ROLE' });
    await tx.query(`UPDATE workspace_memberships SET role = $3 WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, memberId, role]);
  });
}

/** An owner removes anyone but an owner; anyone may remove themselves (leave), except an owner, who deletes the workspace instead. */
export async function removeMember(pool: Pool, actor: Actor, workspaceId: string, memberId: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const role = await authorizeWorkspace(tx, actor.userId, workspaceId, 'view');
    const leaving = memberId === actor.userId;
    if (!leaving && role !== 'OWNER') throw new AppError('FORBIDDEN', 'Only an owner can remove people.');
    const target = await tx.query<{ role: WorkspaceRole }>(`SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`, [workspaceId, memberId]);
    if (!target.rows[0]) throw new AppError('NOT_FOUND', 'That person is not in this workspace.');
    if (target.rows[0].role === 'OWNER') throw new AppError('DOMAIN_VALIDATION_FAILED', 'An owner cannot be removed. Delete the workspace instead.', { reason: 'OWNER_ROLE' });
    await tx.query(`DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, memberId]);
  });
}

export async function removeInvite(pool: Pool, actor: Actor, workspaceId: string, email: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    await ownerOf(tx, actor.userId, workspaceId);
    await tx.query(`DELETE FROM workspace_invites WHERE workspace_id = $1 AND email = $2`, [workspaceId, email]);
  });
}
