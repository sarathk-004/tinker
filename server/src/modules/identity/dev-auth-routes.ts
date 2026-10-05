import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseOrThrow } from '../../infrastructure/http/errors.ts';
import type { LocalSigner } from '../../infrastructure/auth/verifier.ts';

const loginSchema = z.object({
  email: z.email().max(320),
  displayName: z.string().trim().min(1).max(200).optional(),
});

/**
 * DEV ONLY (AUTH_MODE=dev and NODE_ENV=development, enforced in config and main.ts): mint a token for any email, signed by a
 * throwaway in-memory key, so the local app can be used without a Supabase project. No password, no persistence.
 */
export async function registerDevAuthRoutes(root: FastifyInstance, signer: LocalSigner): Promise<void> {
  await root.register(async (app) => {
    app.post('/dev/auth/login', async (request) => {
      const { email, displayName } = parseOrThrow(loginSchema, request.body, 'INVALID_REQUEST', 'Enter a valid email address.');
      const ttl = 3600;
      const token = await signer.sign({ subject: `dev:${email.toLowerCase()}`, email, ...(displayName ? { displayName } : {}) }, ttl);
      return { token, expiresInSeconds: ttl, note: 'Development login: not a real identity provider.' };
    });
  });
}
