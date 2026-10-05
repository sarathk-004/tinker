import type { Pool } from '../../infrastructure/database/pool.ts';
import { withTransaction } from '../../infrastructure/database/pool.ts';
import type { TokenClaims } from '../../infrastructure/auth/verifier.ts';

export interface InternalUser {
  id: string;
  externalAuthId: string;
  email: string | null;
  displayName: string | null;
}

/**
 * Map a verified identity to an internal user and make sure the personal workspace + owner membership exist.
 * One transaction, idempotent and safe under concurrent first requests (decision D09): every insert is
 * ON CONFLICT-guarded and `workspaces.personal_for_user_id` is a unique bootstrap key.
 */
export async function ensureUser(pool: Pool, claims: TokenClaims): Promise<InternalUser> {
  return withTransaction(pool, async (tx) => {
    const user = await tx.query<{ id: string; email: string | null; display_name: string | null }>(
      `INSERT INTO users (external_auth_id, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (external_auth_id) DO UPDATE
         SET email = COALESCE(EXCLUDED.email, users.email),
             display_name = COALESCE(EXCLUDED.display_name, users.display_name),
             updated_at = CASE WHEN users.email IS DISTINCT FROM COALESCE(EXCLUDED.email, users.email)
                                 OR users.display_name IS DISTINCT FROM COALESCE(EXCLUDED.display_name, users.display_name)
                               THEN now() ELSE users.updated_at END
       RETURNING id, email, display_name`,
      [claims.subject, claims.email, claims.displayName],
    );
    const row = user.rows[0]!;

    await tx.query(
      `INSERT INTO workspaces (name, created_by, personal_for_user_id)
       VALUES ('Personal', $1, $1)
       ON CONFLICT (personal_for_user_id) DO NOTHING`,
      [row.id],
    );
    await tx.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       SELECT id, $1, 'OWNER' FROM workspaces WHERE personal_for_user_id = $1
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [row.id],
    );
    return { id: row.id, externalAuthId: claims.subject, email: row.email, displayName: row.display_name };
  });
}
