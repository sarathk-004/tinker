import type { Queryable } from '../../infrastructure/database/pool.ts';
import type { Sealed } from '../../infrastructure/crypto/secret-box.ts';

export interface StoredKey {
  userId: string;
  sealed: Sealed;
  last4: string;
  addedAt: Date;
  verifiedAt: Date | null;
  lastUsedAt: Date | null;
}

interface Row {
  user_id: string;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  key_version: string;
  key_last4: string;
  created_at: Date;
  verified_at: Date | null;
  last_used_at: Date | null;
}

const toStored = (r: Row): StoredKey => ({
  userId: r.user_id,
  sealed: { ciphertext: r.ciphertext, iv: r.iv, tag: r.auth_tag, keyVersion: r.key_version },
  last4: r.key_last4,
  addedAt: r.created_at,
  verifiedAt: r.verified_at,
  lastUsedAt: r.last_used_at,
});

export async function getStoredKey(db: Queryable, userId: string, provider = 'gemini'): Promise<StoredKey | null> {
  const { rows } = await db.query<Row>(
    `SELECT user_id, ciphertext, iv, auth_tag, key_version, key_last4, created_at, verified_at, last_used_at FROM user_api_keys WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  );
  return rows[0] ? toStored(rows[0]) : null;
}

/** Replace the person's key (one per provider). `verified_at` is when the provider accepted it. */
export async function putStoredKey(db: Queryable, input: { userId: string; provider?: string; sealed: Sealed; last4: string }): Promise<void> {
  await db.query(
    `INSERT INTO user_api_keys (user_id, provider, ciphertext, iv, auth_tag, key_version, key_last4, verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (user_id, provider) DO UPDATE
       SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag, key_version = EXCLUDED.key_version,
           key_last4 = EXCLUDED.key_last4, verified_at = now(), created_at = now(), updated_at = now(), last_used_at = NULL`,
    [input.userId, input.provider ?? 'gemini', input.sealed.ciphertext, input.sealed.iv, input.sealed.tag, input.sealed.keyVersion, input.last4],
  );
}

/** Hard delete: a removed key leaves nothing behind. */
export async function deleteStoredKey(db: Queryable, userId: string, provider = 'gemini'): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM user_api_keys WHERE user_id = $1 AND provider = $2`, [userId, provider]);
  return (rowCount ?? 0) > 0;
}

/** At most one write an hour per key, however busy the person is. */
export async function touchStoredKey(db: Queryable, userId: string, provider = 'gemini'): Promise<void> {
  await db.query(
    `UPDATE user_api_keys SET last_used_at = now() WHERE user_id = $1 AND provider = $2 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 hour')`,
    [userId, provider],
  );
}

/** Rows sealed with a key other than `currentVersion` (for rotation). Returns ciphertext only. */
export async function listKeysNotSealedWith(db: Queryable, currentVersion: string, onlyUsers?: readonly string[]): Promise<StoredKey[]> {
  const { rows } = await db.query<Row>(
    `SELECT user_id, ciphertext, iv, auth_tag, key_version, key_last4, created_at, verified_at, last_used_at FROM user_api_keys
      WHERE key_version <> $1 AND ($2::uuid[] IS NULL OR user_id = ANY($2))`,
    [currentVersion, onlyUsers ?? null],
  );
  return rows.map(toStored);
}

export async function resealStoredKey(db: Queryable, userId: string, expectedVersion: string, sealed: Sealed, provider = 'gemini'): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE user_api_keys SET ciphertext = $4, iv = $5, auth_tag = $6, key_version = $7, updated_at = now()
      WHERE user_id = $1 AND provider = $2 AND key_version = $3`,
    [userId, provider, expectedVersion, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyVersion],
  );
  return (rowCount ?? 0) > 0;
}
