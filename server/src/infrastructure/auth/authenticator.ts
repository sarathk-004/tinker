import type { FastifyRequest } from 'fastify';
import { AppError } from '../http/errors.ts';

export interface AuthContext {
  /** Internal Tinker user id (never taken from a request body). */
  userId: string;
}

export type Authenticator = (request: FastifyRequest) => Promise<AuthContext>;

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/**
 * I1 placeholder: no token verifier exists yet (Supabase JWT verification arrives in I3, decision S4/D09),
 * so every protected route answers 401. Tests inject their own authenticator.
 */
export const rejectAllAuthenticator: Authenticator = async () => {
  throw new AppError('UNAUTHENTICATED', 'Authentication is required.');
};
