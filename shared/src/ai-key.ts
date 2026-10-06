import { z } from 'zod';

/**
 * Whose model key does the AI run on? (decision I9-BYOK)
 *  - `server`          the operator's key serves everyone (development, or a private deployment).
 *  - `user`            every person brings their own key; without one, free-form AI, voice and spoken replies are off
 *                      (plain commands, manual editing, history and computed advice keep working).
 *  - `user_or_server`  their own key when they have one, otherwise the operator's.
 */
export const aiKeyModeSchema = z.enum(['server', 'user', 'user_or_server']);
export type AiKeyMode = z.infer<typeof aiKeyModeSchema>;

/** Which key this person's requests use right now. */
export const aiKeySourceSchema = z.enum(['USER', 'SERVER', 'NONE']);
export type AiKeySource = z.infer<typeof aiKeySourceSchema>;

/** GET /v1/me/ai-key. Never contains the key itself: only whether one is stored, its last four characters and when it was checked. */
export const aiKeyStatusSchema = z.strictObject({
  mode: aiKeyModeSchema,
  source: aiKeySourceSchema,
  /** A key of the person's own is stored. */
  configured: z.boolean(),
  last4: z.string().max(4).nullable(),
  addedAt: z.iso.datetime().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
});
export type AiKeyStatus = z.infer<typeof aiKeyStatusSchema>;

/** PUT /v1/me/ai-key. The key is checked with the provider before it is stored. */
export const putAiKeyRequestSchema = z.strictObject({
  apiKey: z
    .string()
    .trim()
    .min(20, 'That does not look like a complete API key.')
    .max(200)
    .regex(/^[A-Za-z0-9._-]+$/, 'An API key contains only letters, digits and . _ -'),
});
export type PutAiKeyRequest = z.infer<typeof putAiKeyRequestSchema>;
