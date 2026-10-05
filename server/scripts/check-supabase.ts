/**
 * Smoke-check the Supabase wiring without changing anything. Reads server/.env.supabase.local (or the environment).
 *   npm run check:supabase -w @tinker/server
 * Optional inputs (never printed): SUPABASE_ACCESS_TOKEN (a real user JWT) to verify a live token,
 * DATABASE_URL to test the database connection and row level security.
 */
import { createLocalSigner, createSupabaseVerifier } from '../src/infrastructure/auth/verifier.ts';
import { loadConfig } from '../src/infrastructure/config/config.ts';
import { createPool } from '../src/infrastructure/database/pool.ts';

const config = loadConfig({ ...process.env, NODE_ENV: 'development', AUTH_MODE: 'supabase' });
if (!config.supabaseUrl) throw new Error('SUPABASE_URL is not set');
const issuer = `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1`;
const results: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
};

// 1. The project publishes asymmetric signing keys we can verify against.
const jwks = (await fetch(`${issuer}/.well-known/jwks.json`).then((r) => r.json())) as { keys: Array<{ alg?: string; kty?: string }> };
check('JWKS reachable and non-empty', jwks.keys.length > 0, jwks.keys.map((k) => `${k.kty}/${k.alg}`).join(', '));
check('JWKS uses asymmetric algorithms only', jwks.keys.every((k) => ['ES256', 'RS256', 'EdDSA'].includes(k.alg ?? '')));

// 2. The real verifier rejects tokens it should reject with a 401 (not a 503 "provider down").
const verify = createSupabaseVerifier(config.supabaseUrl, config.jwtAudience);
const foreign = await createLocalSigner(config.jwtAudience, issuer); // right issuer and audience, WRONG signing key
await verify(await foreign.sign({ subject: 'attacker', email: 'attacker@example.com' })).then(
  () => check('forged token (right issuer, foreign key) is rejected', false, 'ACCEPTED: this is a security failure'),
  (e: { code?: string }) => check('forged token (right issuer, foreign key) is rejected', e.code === 'UNAUTHENTICATED', `code=${e.code}`),
);
await verify('not-a-jwt').then(
  () => check('garbage token is rejected', false),
  (e: { code?: string }) => check('garbage token is rejected', e.code === 'UNAUTHENTICATED', `code=${e.code}`),
);

// 3. A real user token (optional).
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (token) {
  await verify(token).then(
    (claims) => check('real Supabase token verifies', true, `subject present=${Boolean(claims.subject)}, email present=${Boolean(claims.email)}`),
    (e: { code?: string; message?: string }) => check('real Supabase token verifies', false, `${e.code}: ${e.message}`),
  );
} else {
  console.log('SKIP  real Supabase token (set SUPABASE_ACCESS_TOKEN to test one)');
}

// 4. The database (optional).
if (config.databaseUrl) {
  const pool = createPool(config.databaseUrl, { mode: config.databaseSsl, caFile: config.databaseSslCaFile });
  try {
    const r = await pool.query(
      `SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity)::int AS rls_tables,
              (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')::int AS tables,
              current_user AS role, version() AS version`,
    );
    const row = r.rows[0] as { rls_tables: number; tables: number; role: string; version: string };
    check('database reachable over TLS', true, `${row.version.split(' ').slice(0, 2).join(' ')} as role "${row.role}"`);
    check('every public table has RLS enabled', row.tables > 0 && row.rls_tables === row.tables, `${row.rls_tables}/${row.tables}`);
    // With RLS on and no policies, a role that neither owns the tables nor bypasses RLS would silently read zero rows.
    const access = await pool.query(
      `SELECT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass,
              EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users' AND tableowner = current_user) AS owner`,
    );
    const a = access.rows[0] as { bypass: boolean; owner: boolean };
    check('server role owns the tables or bypasses RLS', a.bypass || a.owner, `owner=${a.owner} bypassrls=${a.bypass}`);
    const migrated = await pool.query(`SELECT count(*)::int AS n FROM pgmigrations WHERE name = '1760000000000_initial-schema'`);
    check('schema migration recorded', (migrated.rows[0] as { n: number }).n === 1);
  } catch (e) {
    check('database reachable over TLS', false, (e as Error).message.replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
  } finally {
    await pool.end();
  }
} else {
  console.log('SKIP  database (set DATABASE_URL in server/.env.supabase.local)');
}

process.exit(results.some(([, ok]) => !ok) ? 1 : 0);
