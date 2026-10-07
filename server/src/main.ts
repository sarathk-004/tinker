import { buildApp } from './app.ts';
import { createLocalSigner, createSupabaseVerifier, type LocalSigner, type TokenVerifier } from './infrastructure/auth/verifier.ts';
import { ConfigError, loadConfig, type Config } from './infrastructure/config/config.ts';
import { createPool } from './infrastructure/database/pool.ts';
import { installProcessGuards } from './infrastructure/process-guards.ts';

function fatal(message: string): never {
  console.error(message);
  process.exit(1);
}

function loadOrExit(): Config {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) fatal(error.message);
    throw error;
  }
}

async function main(): Promise<void> {
  const config = loadOrExit();
  if (!config.databaseUrl) fatal('Invalid configuration:\n  - DATABASE_URL: is required to start the API');

  let verifier: TokenVerifier;
  let devSigner: LocalSigner | undefined;
  if (config.authMode === 'dev') {
    devSigner = await createLocalSigner(config.jwtAudience);
    verifier = devSigner.verify;
    console.warn('AUTH_MODE=dev: tokens come from POST /dev/auth/login (throwaway local key). Never use this outside local development.');
  } else {
    if (!config.supabaseUrl) fatal('Invalid configuration:\n  - SUPABASE_URL: is required when AUTH_MODE=supabase (or set AUTH_MODE=dev for local development)');
    verifier = createSupabaseVerifier(config.supabaseUrl, config.jwtAudience, { requireVerifiedEmail: config.requireVerifiedEmail });
  }

  const pool = createPool(config.databaseUrl, { mode: config.databaseSsl, caFile: config.databaseSslCaFile });
  try {
    await pool.query('SELECT 1');
  } catch {
    fatal('Cannot connect to the database at DATABASE_URL. For local development run: npm run dev:db -w @tinker/server, then npm run db:migrate -w @tinker/server');
  }

  const app = await buildApp({ config, pool, verifier, ...(devSigner ? { devSigner } : {}) });

  installProcessGuards(async () => {
    await app.close();
    await pool.end();
  });
  // A hand-run deploy that forgot NODE_ENV=production would keep the development routes and relaxed checks: say so loudly.
  if (config.nodeEnv === 'development' && !['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
    console.warn(`WARNING: NODE_ENV is "development" but the API listens on ${config.host}. Set NODE_ENV=production for any deployment.`);
  }

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
