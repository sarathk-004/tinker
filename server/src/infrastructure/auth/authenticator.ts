import type { FastifyRequest } from 'fastify';
import type { Pool } from '../database/pool.ts';
import { AppError } from '../http/errors.ts';
import { ensureUser } from '../../modules/identity/users.ts';
import type { TokenVerifier } from './verifier.ts';

export interface AuthContext {
  /** Internal Tinker user id, resolved from the verified token (never taken from a request body). */
  userId: string;
  email: string | null;
  displayName: string | null;
}

export type Authenticator = (request: FastifyRequest) => Promise<AuthContext>;

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** Used when no verifier is configured: every protected route answers 401. */
export const rejectAllAuthenticator: Authenticator = async () => {
  throw new AppError('UNAUTHENTICATED', 'Authentication is required.');
};

/**
 * Bearer token -> verified claims -> internal user (+ personal workspace on first sight).
 * No caching: membership and user rows are read per request so revoked access takes effect immediately (D09).
 */
export function createJwtAuthenticator(pool: Pool, verify: TokenVerifier): Authenticator {
  return async (request) => {
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (!match) throw new AppError('UNAUTHENTICATED', 'Authentication is required.');
    const claims = await verify(match[1]!);
    const user = await ensureUser(pool, claims);
    return { userId: user.id, email: user.email, displayName: user.displayName };
  };
}
