import { generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { meResponseSchema } from '@tinker/shared';
import { createLocalSigner, createTokenVerifier } from '../src/infrastructure/auth/verifier.ts';
import { ensureUser } from '../src/modules/identity/users.ts';
import { call, startHarness, type Harness } from './support/harness.ts';

describe('token verification (same code path Supabase tokens use)', () => {
  it('accepts a valid token and extracts only trusted claims', async () => {
    const signer = await createLocalSigner();
    const token = await signer.sign({ subject: 'abc', email: 'a@example.test', displayName: 'Ada' });
    expect(await signer.verify(token)).toEqual({ subject: 'abc', email: 'a@example.test', displayName: 'Ada' });
  });

  it('rejects expired, wrong-audience, wrong-issuer, wrong-key, tampered and unsigned tokens with a uniform 401', async () => {
    const signer = await createLocalSigner('authenticated');
    const other = await createLocalSigner('authenticated');
    const wrongAudience = await createLocalSigner('someone-else');

    const expired = await signer.sign({ subject: 'abc' }, -60);
    const good = await signer.sign({ subject: 'abc' });
    const [h, p, s] = good.split('.');
    const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: 'admin', exp: 9999999999 })).toString('base64url')}.${s}`;
    const noneAlg = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${p}.`;

    const attempts: Record<string, string> = {
      expired,
      tampered,
      noneAlg,
      wrongKey: await other.sign({ subject: 'abc' }),
      wrongAudience: await wrongAudience.sign({ subject: 'abc' }),
      empty: '',
      garbage: 'not-a-jwt',
    };
    for (const [name, token] of Object.entries(attempts)) {
      await expect(signer.verify(token), name).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });

  it('rejects a token with a missing subject and symmetric (HS256) tokens', async () => {
    const signer = await createLocalSigner();
    const { privateKey } = await generateKeyPair('ES256');
    const noSub = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'tinker-dev' }).setIssuer('http://localhost/tinker-dev-auth').setAudience('authenticated').setExpirationTime('1h').sign(privateKey);
    await expect(signer.verify(noSub)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const hs = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('abc').setIssuer('http://localhost/tinker-dev-auth').setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode('secret-secret-secret-secret-123456'));
    await expect(signer.verify(hs)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('reports an unreachable key set as 503, not as bad credentials', async () => {
    const verify = createTokenVerifier({
      issuer: 'x',
      audience: 'y',
      keys: async () => {
        throw new Error('network down');
      },
    });
    const signer = await createLocalSigner();
    await expect(verify(await signer.sign({ subject: 'abc' }))).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('identity provisioning', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());

  it('the first request creates the internal user, a personal workspace and an owner membership', async () => {
    const user = await h.newUser('first');
    const me = await call(h, user, 'GET', '/v1/me');
    expect(me.status).toBe(200);
    expect(meResponseSchema.safeParse(me.body).success).toBe(true);
    expect(me.body.workspaces).toHaveLength(1);
    expect(me.body.workspaces[0]).toMatchObject({ role: 'OWNER', personal: true });
    expect(me.body.user.email).toBe(`${user.subject}@example.test`);
  });

  it('is idempotent: later requests reuse the same user and workspace', async () => {
    const user = await h.newUser('again');
    const a = await call(h, user, 'GET', '/v1/me');
    const b = await call(h, user, 'GET', '/v1/me');
    expect(b.body.user.id).toBe(a.body.user.id);
    expect(b.body.workspaces).toEqual(a.body.workspaces);
  });

  it('concurrent first requests produce exactly one user, one workspace and one membership', async () => {
    const user = await h.newUser('race');
    const results = await Promise.all(Array.from({ length: 12 }, () => call(h, user, 'GET', '/v1/me')));
    expect(new Set(results.map((r) => r.status))).toEqual(new Set([200]));
    expect(new Set(results.map((r) => r.body.user.id)).size).toBe(1);
    const counts = await h.pool.query(
      `SELECT (SELECT count(*) FROM users WHERE external_auth_id = $1)::int AS users,
              (SELECT count(*) FROM workspaces w JOIN users u ON u.id = w.personal_for_user_id WHERE u.external_auth_id = $1)::int AS workspaces,
              (SELECT count(*) FROM workspace_memberships m JOIN users u ON u.id = m.user_id WHERE u.external_auth_id = $1)::int AS memberships`,
      [user.subject],
    );
    expect(counts.rows[0]).toEqual({ users: 1, workspaces: 1, memberships: 1 });
  });

  it('ensureUser called directly is atomic and repeatable, and refreshes the email', async () => {
    const claims = { subject: `direct:${Math.random()}`, email: 'one@example.test', displayName: null };
    const first = await ensureUser(h.pool, claims);
    const second = await ensureUser(h.pool, { ...claims, email: 'two@example.test' });
    expect(second.id).toBe(first.id);
    expect(second.email).toBe('two@example.test');
  });

  it('never trusts a user id from the request body or headers', async () => {
    const mallory = await h.newUser('mallory');
    const victim = await h.newUser('victim');
    const victimMe = await call(h, victim, 'GET', '/v1/me');
    const res = await call(h, mallory, 'GET', '/v1/me', undefined, { 'x-user-id': victimMe.body.user.id });
    expect(res.body.user.id).not.toBe(victimMe.body.user.id);
  });
});
