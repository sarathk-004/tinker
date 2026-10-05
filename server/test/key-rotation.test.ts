import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpKeyFetcher } from '../src/infrastructure/auth/key-store.ts';
import { createSupabaseVerifier, type TokenVerifier } from '../src/infrastructure/auth/verifier.ts';

/**
 * Signing-key rotation, revocation and provider-outage behaviour, with a fake clock and a fake key server.
 * Timeline settings used below: keys are re-checked every 60 s, a failed provider may be retried every 10 s,
 * and stale keys may be used for at most 600 s while the provider is down.
 */
const URL_BASE = 'https://example-project.supabase.co';
const ISSUER = `${URL_BASE}/auth/v1`;
const AUDIENCE = 'authenticated';
const CACHE = 60_000;
const STALE = 600_000;
const COOLDOWN = 10_000;

interface SigningKey {
  kid: string;
  jwk: JWK;
  sign: (subject: string) => Promise<string>;
}

async function makeKey(kid: string): Promise<SigningKey> {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), alg: 'ES256', use: 'sig', kid };
  return {
    kid,
    jwk,
    sign: (subject) =>
      new SignJWT({ email: `${subject}@example.test` })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setSubject(subject)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('1d')
        .sign(privateKey),
  };
}

/** A pretend Supabase: publishes whichever keys the test says, can go down, counts requests. */
function fakeProvider(initial: SigningKey[]) {
  const state = { keys: initial, down: false as boolean | 'garbage', hits: 0 };
  return {
    state,
    fetchKeys: async () => {
      state.hits += 1;
      if (state.down === true) throw new Error('provider down');
      if (state.down === 'garbage') return { not: 'a key set' };
      return { keys: state.keys.map((k) => k.jwk) };
    },
  };
}

function setup(keys: SigningKey[]) {
  let now = 1_000_000;
  const provider = fakeProvider(keys);
  const verify = createSupabaseVerifier(URL_BASE, AUDIENCE, {
    fetchKeys: provider.fetchKeys,
    now: () => now,
    cacheMaxAgeMs: CACHE,
    maxStaleMs: STALE,
    cooldownMs: COOLDOWN,
  });
  return { provider, verify, advance: (ms: number) => (now += ms) };
}

const code = async (verify: TokenVerifier, token: string) => verify(token).then(() => 'OK', (e: { code?: string }) => e.code);

describe('signing-key rotation and revocation', () => {
  it('verifies with the published key and fetches the key set once, not per request', async () => {
    const a = await makeKey('key-a');
    const { provider, verify } = setup([a]);
    for (let i = 0; i < 25; i++) expect(await code(verify, await a.sign(`u${i}`))).toBe('OK');
    expect(provider.state.hits).toBe(1);
  });

  it('rotation: a token signed with a NEW key works once the key is published and the retry cooldown has passed; old tokens keep working', async () => {
    const [a, b] = [await makeKey('key-a'), await makeKey('key-b')];
    const { provider, verify, advance } = setup([a]);
    expect(await code(verify, await a.sign('before'))).toBe('OK'); // t=0, keys fetched

    provider.state.keys = [a, b]; // the provider publishes the new key
    advance(5_000);
    // Within the cooldown we may not refetch yet: the new key's tokens are refused (client retries), not accepted blindly.
    expect(await code(verify, await b.sign('too-early'))).toBe('UNAUTHENTICATED');
    expect(provider.state.hits).toBe(1);

    advance(6_000); // 11 s after the last fetch
    expect(await code(verify, await b.sign('after-cooldown'))).toBe('OK');
    expect(provider.state.hits).toBe(2);
    expect(await code(verify, await a.sign('old-token-still-valid'))).toBe('OK'); // both keys are now published
  });

  it('revocation: a key the provider removes keeps verifying only until the next refresh (at most the cache age), then stops', async () => {
    const [a, b] = [await makeKey('key-a'), await makeKey('key-b')];
    const { provider, verify, advance } = setup([a, b]);
    expect(await code(verify, await a.sign('x'))).toBe('OK'); // fetched at t=0

    provider.state.keys = [b]; // key A revoked at the provider
    advance(30_000);
    expect(await code(verify, await a.sign('still-cached'))).toBe('OK'); // inside the revocation window: documented and bounded
    advance(31_000); // 61 s since the fetch: stale, refresh happens on the next request
    expect(await code(verify, await a.sign('revoked'))).toBe('UNAUTHENTICATED');
    expect(await code(verify, await b.sign('current'))).toBe('OK');
  });
});

describe('key provider outage', () => {
  it('known keys keep working through an outage (last good keys), and retries to the provider are rate limited', async () => {
    const a = await makeKey('key-a');
    const { provider, verify, advance } = setup([a]);
    expect(await code(verify, await a.sign('warm'))).toBe('OK');

    provider.state.down = true;
    advance(CACHE + 1_000); // cache is stale, provider is down
    const before = provider.state.hits;
    for (let i = 0; i < 40; i++) expect(await code(verify, await a.sign(`during-outage-${i}`))).toBe('OK');
    expect(provider.state.hits - before).toBe(1); // 40 requests, one provider attempt (cooldown)
    advance(COOLDOWN + 1);
    await verify(await a.sign('later'));
    expect(provider.state.hits - before).toBe(2);
  });

  it('an unknown key during an outage is "unavailable" (503), not "bad credentials" (401)', async () => {
    const [a, c] = [await makeKey('key-a'), await makeKey('key-c')];
    const { provider, verify, advance } = setup([a]);
    await verify(await a.sign('warm'));
    provider.state.down = true;
    advance(COOLDOWN + 1);
    expect(await code(verify, await c.sign('maybe-a-legitimate-new-key'))).toBe('SERVICE_UNAVAILABLE');
  });

  it('trust in stale keys is bounded: after the maximum stale age the API refuses with 503 instead of trusting old keys forever', async () => {
    const a = await makeKey('key-a');
    const { provider, verify, advance } = setup([a]);
    await verify(await a.sign('warm'));
    provider.state.down = true;
    advance(STALE - 1_000);
    expect(await code(verify, await a.sign('inside'))).toBe('OK');
    advance(2_000);
    expect(await code(verify, await a.sign('beyond'))).toBe('SERVICE_UNAVAILABLE');
  });

  it('recovers by itself when the provider returns, and a key revoked during the outage is then rejected', async () => {
    const [a, b] = [await makeKey('key-a'), await makeKey('key-b')];
    const { provider, verify, advance } = setup([a, b]);
    await verify(await a.sign('warm'));
    provider.state.down = true;
    advance(CACHE + 1_000);
    expect(await code(verify, await a.sign('during'))).toBe('OK');

    provider.state.down = false;
    provider.state.keys = [b]; // A was revoked while we could not see it
    advance(COOLDOWN + 1);
    expect(await code(verify, await a.sign('revoked'))).toBe('UNAUTHENTICATED');
    expect(await code(verify, await b.sign('fine'))).toBe('OK');
  });

  it('cold start during an outage answers 503 and does not hammer the provider', async () => {
    const a = await makeKey('key-a');
    const { provider, verify, advance } = setup([a]);
    provider.state.down = true;
    for (let i = 0; i < 30; i++) expect(await code(verify, await a.sign(`u${i}`))).toBe('SERVICE_UNAVAILABLE');
    expect(provider.state.hits).toBe(1);
    provider.state.down = false;
    advance(COOLDOWN + 1);
    expect(await code(verify, await a.sign('back'))).toBe('OK');
  });

  it('a provider that returns garbage instead of keys is treated as an outage (503), never as "no keys"', async () => {
    const a = await makeKey('key-a');
    const { provider, verify } = setup([a]);
    provider.state.down = 'garbage';
    expect(await code(verify, await a.sign('x'))).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('abuse resistance', () => {
  it('a flood of tokens signed with unknown keys causes at most one extra provider fetch per cooldown', async () => {
    const [a, attacker] = [await makeKey('key-a'), await makeKey('evil-key')];
    const { provider, verify, advance } = setup([a]);
    await verify(await a.sign('warm'));
    advance(COOLDOWN + 1);
    const before = provider.state.hits;
    for (let i = 0; i < 60; i++) expect(await code(verify, await attacker.sign(`forged-${i}`))).toBe('UNAUTHENTICATED');
    expect(provider.state.hits - before).toBe(1);
  });

  it('a token claiming a known key id but signed with a different key is rejected', async () => {
    const [a, impostor] = [await makeKey('key-a'), await makeKey('key-a')]; // same kid, different key material
    const { verify } = setup([a]);
    expect(await code(verify, await impostor.sign('impostor'))).toBe('UNAUTHENTICATED');
  });

  it('simultaneous first requests share a single key fetch', async () => {
    const a = await makeKey('key-a');
    const { provider, verify } = setup([a]);
    const results = await Promise.all(Array.from({ length: 25 }, async (_, i) => code(verify, await a.sign(`u${i}`))));
    expect(new Set(results)).toEqual(new Set(['OK']));
    expect(provider.state.hits).toBe(1);
  });
});

describe('HTTP key fetcher (real HTTP against a local server)', () => {
  let server: Server;
  let base: string;
  let mode: 'ok' | 'error500' | 'html' | 'hang' | 'redirect' = 'ok';
  beforeAll(async () => {
    server = createServer((_req, res) => {
      if (mode === 'hang') return; // never answer
      if (mode === 'error500') return void res.writeHead(500).end('boom');
      if (mode === 'html') return void res.writeHead(200, { 'content-type': 'text/html' }).end('<html>maintenance</html>');
      if (mode === 'redirect') return void res.writeHead(302, { location: 'http://127.0.0.1:1/evil' }).end();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks.json`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('returns the key set on 200 and fails on 500, non-JSON, redirects and timeouts', async () => {
    const fetchKeys = createHttpKeyFetcher(base, 300);
    mode = 'ok';
    await expect(fetchKeys()).resolves.toEqual({ keys: [] });
    for (const bad of ['error500', 'html', 'redirect', 'hang'] as const) {
      mode = bad;
      await expect(fetchKeys(), bad).rejects.toBeDefined();
    }
  });

  it('through the verifier, an HTTP 500 from the key endpoint is a 503, not a 401', async () => {
    const a = await makeKey('key-a');
    mode = 'error500';
    const verify = createSupabaseVerifier(URL_BASE, AUDIENCE, { fetchKeys: createHttpKeyFetcher(base, 300) });
    expect(await code(verify, await a.sign('x'))).toBe('SERVICE_UNAVAILABLE');
  });
});
