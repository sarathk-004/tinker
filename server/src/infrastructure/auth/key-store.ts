import { createLocalJWKSet, errors as joseErrors } from 'jose';
import type { JSONWebKeySet, JWTVerifyGetKey } from 'jose';

/** The signing-key provider could not be reached or returned garbage. Mapped to 503, never to "bad credentials". */
export class KeysUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KeysUnavailableError';
  }
}

export interface KeyStoreOptions {
  /** Fetch the provider's JWKS (throw on any failure). */
  fetchKeys: () => Promise<unknown>;
  now?: () => number;
  /** Refresh keys older than this. Also the longest a REVOKED key can keep verifying while the provider is reachable. */
  cacheMaxAgeMs?: number;
  /** While the provider is unreachable, keep verifying with the last good keys for at most this long (bounded trust). */
  maxStaleMs?: number;
  /** Minimum gap between fetch ATTEMPTS, so unknown-key tokens (or an outage) cannot make us hammer the provider. */
  cooldownMs?: number;
}

export const KEY_STORE_DEFAULTS = { cacheMaxAgeMs: 5 * 60_000, maxStaleMs: 60 * 60_000, cooldownMs: 30_000 } as const;

function isJwks(value: unknown): value is JSONWebKeySet {
  return typeof value === 'object' && value !== null && Array.isArray((value as { keys?: unknown }).keys);
}

/**
 * Signing-key cache with the behaviours we need around key rotation (see test/key-rotation.test.ts):
 * - a token with an UNKNOWN key id triggers one refresh (rotation: new key appears), rate limited by the cooldown;
 * - keys are refreshed every `cacheMaxAgeMs`, so a key removed by the provider stops verifying within that window;
 * - if a refresh fails, the last good keys keep working for up to `maxStaleMs` (a provider blip must not log everyone out);
 * - beyond that, or with no keys at all, verification fails with KeysUnavailableError (503, not 401);
 * - concurrent refreshes are shared (single flight).
 */
export function createKeyStore(options: KeyStoreOptions): JWTVerifyGetKey {
  const now = options.now ?? Date.now;
  const cacheMaxAgeMs = options.cacheMaxAgeMs ?? KEY_STORE_DEFAULTS.cacheMaxAgeMs;
  const maxStaleMs = options.maxStaleMs ?? KEY_STORE_DEFAULTS.maxStaleMs;
  const cooldownMs = options.cooldownMs ?? KEY_STORE_DEFAULTS.cooldownMs;

  let local: JWTVerifyGetKey | undefined;
  let fetchedAt = Number.NEGATIVE_INFINITY; // last SUCCESSFUL fetch
  let attemptedAt = Number.NEGATIVE_INFINITY; // last attempt, success or not
  let inFlight: Promise<void> | undefined;

  const refresh = (): Promise<void> => {
    inFlight ??= (async () => {
      attemptedAt = now();
      try {
        const jwks = await options.fetchKeys();
        if (!isJwks(jwks)) throw new Error('response is not a JSON Web Key Set');
        local = createLocalJWKSet(jwks);
        fetchedAt = now();
      } catch (cause) {
        // Keep whatever we had: the caller decides whether it is still usable.
        throw new KeysUnavailableError('Could not refresh the signing keys.', { cause });
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

  const stale = () => now() - fetchedAt > cacheMaxAgeMs;
  const canAttempt = () => now() - attemptedAt >= cooldownMs;
  const usableStale = () => local !== undefined && now() - fetchedAt <= maxStaleMs;

  return async (header, token) => {
    if (!local) {
      // Cold start: nothing to verify with. Respect the cooldown even here so an outage is not hammered.
      if (!canAttempt()) throw new KeysUnavailableError('Signing keys are not loaded and the provider was tried moments ago.');
      await refresh();
    } else if (stale()) {
      if (canAttempt()) {
        try {
          await refresh();
        } catch (error) {
          if (!usableStale()) throw error;
        }
      } else if (!usableStale()) {
        throw new KeysUnavailableError('Signing keys are too old and the provider is unreachable.');
      }
    }

    try {
      return await local!(header, token);
    } catch (error) {
      if (!(error instanceof joseErrors.JWKSNoMatchingKey) || !canAttempt()) throw error;
      // Unknown key id: the provider may have rotated. Refresh once (cooldown-limited) and retry. If we cannot refresh we
      // cannot tell a new legitimate key from a forged one, so report "unavailable" rather than "bad credentials".
      await refresh();
      return local!(header, token);
    }
  };
}

/** Plain HTTPS fetch of a JWKS URL with a timeout. Non-200 and non-JSON are failures. */
export function createHttpKeyFetcher(url: string, timeoutMs = 5_000, fetchImpl: typeof fetch = fetch): () => Promise<unknown> {
  return async () => {
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    if (response.status !== 200) throw new Error(`JWKS endpoint answered HTTP ${response.status}`);
    return response.json();
  };
}
