import { errors as joseErrors, generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { AppError } from '../http/errors.ts';
import { createHttpKeyFetcher, createKeyStore, KeysUnavailableError, type KeyStoreOptions } from './key-store.ts';

/** What we trust from a verified token: the provider's subject id (never a user id from a request body). */
export interface TokenClaims {
  subject: string;
  email: string | null;
  displayName: string | null;
}

export type TokenVerifier = (token: string) => Promise<TokenClaims>;

export interface VerifierOptions {
  issuer: string;
  audience: string;
  keys: JWTVerifyGetKey;
  /**
   * Defence in depth for email sign-up: even with a valid signature, a token whose email address was never confirmed is refused.
   * (Supabase already withholds sessions from unconfirmed users while "Confirm email" is on; this still holds if that setting is
   * ever switched off by mistake.)
   */
  requireVerifiedEmail?: boolean;
}

/** Verifies signature (asymmetric keys only), issuer, audience and expiry. Any failure is a uniform 401. */
export function createTokenVerifier({ issuer, audience, keys, requireVerifiedEmail = false }: VerifierOptions): TokenVerifier {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience,
        algorithms: ['ES256', 'RS256', 'EdDSA'],
        requiredClaims: ['sub', 'exp'],
        clockTolerance: 5,
      });
      const meta = (payload['user_metadata'] ?? {}) as Record<string, unknown>;
      if (requireVerifiedEmail && meta['email_verified'] !== true) throw new AppError('EMAIL_NOT_VERIFIED', 'Confirm your email address to continue. Check your inbox for the confirmation link.');
      const name = typeof meta['full_name'] === 'string' ? meta['full_name'] : typeof meta['name'] === 'string' ? meta['name'] : null;
      return {
        subject: String(payload.sub),
        email: typeof payload['email'] === 'string' ? payload['email'] : null,
        displayName: name,
      };
    } catch (error) {
      if (error instanceof AppError) throw error; // our own refusal (for example an unconfirmed email), not a verification failure
      // Our own signal that the key provider is down or returned garbage: not the caller's fault.
      if (error instanceof KeysUnavailableError) throw new AppError('SERVICE_UNAVAILABLE', 'Authentication is temporarily unavailable.');
      // Everything jose raises about the TOKEN itself (bad signature, expired, wrong audience, unknown key...) is a 401.
      if (error instanceof joseErrors.JOSEError) throw new AppError('UNAUTHENTICATED', 'Invalid or expired credentials.');
      throw new AppError('SERVICE_UNAVAILABLE', 'Authentication is temporarily unavailable.');
    }
  };
}

/**
 * Supabase: verify against the project's published JWKS (issuer `<url>/auth/v1`). Key handling (rotation, revocation window,
 * provider outages) is in key-store.ts and covered by test/key-rotation.test.ts. `options` exists for tests.
 */
export function createSupabaseVerifier(
  supabaseUrl: string,
  audience: string,
  options: { fetchKeys?: KeyStoreOptions['fetchKeys']; requireVerifiedEmail?: boolean } & Omit<KeyStoreOptions, 'fetchKeys'> = {},
): TokenVerifier {
  const issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  const { fetchKeys, requireVerifiedEmail = true, ...rest } = options;
  const keys = createKeyStore({ fetchKeys: fetchKeys ?? createHttpKeyFetcher(`${issuer}/.well-known/jwks.json`), ...rest });
  return createTokenVerifier({ issuer, audience, keys, requireVerifiedEmail });
}

export interface LocalSigner {
  verify: TokenVerifier;
  sign: (claims: { subject: string; email?: string; displayName?: string; emailVerified?: boolean }, ttlSeconds?: number) => Promise<string>;
}

/**
 * A throwaway local identity provider for development and tests. It exercises the SAME verification code path as Supabase
 * (signature, issuer, audience, expiry) with an in-memory ES256 key. Never enabled outside development/tests (see config).
 */
export async function createLocalSigner(audience = 'authenticated', issuer = 'http://localhost/tinker-dev-auth'): Promise<LocalSigner> {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), alg: 'ES256', use: 'sig', kid: 'tinker-dev' };
  const verify = createTokenVerifier({ issuer, audience, keys: createLocalJWKSet({ keys: [jwk] }), requireVerifiedEmail: true });
  return {
    verify,
    sign: (claims, ttlSeconds = 3600) =>
      new SignJWT({ email: claims.email, user_metadata: { email_verified: claims.emailVerified ?? true, ...(claims.displayName ? { full_name: claims.displayName } : {}) } })
        .setProtectedHeader({ alg: 'ES256', kid: 'tinker-dev' })
        .setSubject(claims.subject)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(privateKey),
  };
}
