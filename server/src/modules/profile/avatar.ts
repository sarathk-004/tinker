import type { AvatarResponse } from '@tinker/shared';
import type { Queryable } from '../../infrastructure/database/pool.ts';
import { AppError } from '../../infrastructure/http/errors.ts';
import { AVATAR_MAX_BYTES, AVATAR_MAX_SIDE, avatarProblem, type AvatarProblem } from './image.ts';

const MESSAGE: Record<AvatarProblem, string> = {
  EMPTY: 'That picture is empty.',
  TOO_LARGE: `That picture is too large. Use one under ${AVATAR_MAX_BYTES / 1024} KB.`,
  NOT_AN_IMAGE: 'That file is not a PNG, JPEG or WebP picture.',
  TYPE_MISMATCH: 'The picture is not the kind of file it says it is.',
  DIMENSIONS: `That picture is too big in pixels. Use one at most ${AVATAR_MAX_SIDE} pixels wide and tall.`,
};

export async function avatarUpdatedAt(db: Queryable, userId: string): Promise<string | null> {
  const { rows } = await db.query<{ updated_at: Date }>('SELECT updated_at FROM user_avatars WHERE user_id = $1', [userId]);
  return rows[0]?.updated_at.toISOString() ?? null;
}

export async function getAvatar(db: Queryable, userId: string): Promise<AvatarResponse | null> {
  const { rows } = await db.query<{ content_type: AvatarResponse['contentType']; data: Buffer; updated_at: Date }>('SELECT content_type, data, updated_at FROM user_avatars WHERE user_id = $1', [userId]);
  const row = rows[0];
  return row ? { contentType: row.content_type, data: row.data.toString('base64'), updatedAt: row.updated_at.toISOString() } : null;
}

/** Store the person's picture after checking its real bytes. Replaces the previous one. */
export async function putAvatar(db: Queryable, userId: string, contentType: string, base64: string): Promise<{ updatedAt: string }> {
  const bytes = Buffer.from(base64, 'base64');
  const problem = avatarProblem(bytes, contentType);
  if (problem) throw new AppError('DOMAIN_VALIDATION_FAILED', MESSAGE[problem], { reason: 'INVALID_AVATAR', problem });
  const { rows } = await db.query<{ updated_at: Date }>(
    `INSERT INTO user_avatars (user_id, content_type, data) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data, updated_at = now()
     RETURNING updated_at`,
    [userId, contentType, bytes],
  );
  return { updatedAt: rows[0]!.updated_at.toISOString() };
}

export async function deleteAvatar(db: Queryable, userId: string): Promise<void> {
  await db.query('DELETE FROM user_avatars WHERE user_id = $1', [userId]);
}
