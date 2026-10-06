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
  // Fast path (one read, no transaction, no write): the user, their personal workspace and membership already exist and the token
  // carries nothing new. This is the case for almost every request, and it keeps a hosted database to ONE round trip here.
  const existing = await pool.query<{ id: string; email: string | null; display_name: string | null; bootstrapped: boolean }>(
    `SELECT u.id, u.email, u.display_name,
            EXISTS (SELECT 1 FROM workspaces w JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = u.id WHERE w.personal_for_user_id = u.id) AS bootstrapped
       FROM users u WHERE u.external_auth_id = $1`,
    [claims.subject],
  );
  const known = existing.rows[0];
  if (known?.bootstrapped && (claims.email === null || claims.email === known.email) && (claims.displayName === null || claims.displayName === known.display_name)) {
    return { id: known.id, externalAuthId: claims.subject, email: known.email, displayName: known.display_name };
  }
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
