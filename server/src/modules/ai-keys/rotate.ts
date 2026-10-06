import type { Pool } from '../../infrastructure/database/pool.ts';
import type { SecretBox } from '../../infrastructure/crypto/secret-box.ts';
import { listKeysNotSealedWith, resealStoredKey } from './user-keys.ts';

/**
 * Re-seal every stored personal key with the CURRENT master key (run after changing KEY_ENCRYPTION_SECRET and listing the old one
 * in KEY_ENCRYPTION_SECRET_PREVIOUS). Each row is re-sealed only if it still carries the version we read (a person replacing their
 * key meanwhile is never overwritten). Keys that cannot be opened are counted, never logged or altered.
 */
export async function rotateAiKeys(pool: Pool, box: SecretBox, onlyUsers?: readonly string[]): Promise<{ resealed: number; unreadable: number; skipped: number }> {
  let resealed = 0;
  let unreadable = 0;
  let skipped = 0;
  for (const row of await listKeysNotSealedWith(pool, box.keyVersion, onlyUsers)) {
    let plaintext: string;
    try {
      plaintext = box.open(row.sealed, `${row.userId}:gemini`);
    } catch {
      unreadable += 1;
      continue;
    }
    const updated = await resealStoredKey(pool, row.userId, row.sealed.keyVersion, box.seal(plaintext, `${row.userId}:gemini`));
    if (updated) resealed += 1;
    else skipped += 1;
  }
  return { resealed, unreadable, skipped };
}
