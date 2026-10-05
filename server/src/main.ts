import { buildApp } from './app.ts';
import { createLocalSigner, createSupabaseVerifier, type LocalSigner, type TokenVerifier } from './infrastructure/auth/verifier.ts';
import { ConfigError, loadConfig, type Config } from './infrastructure/config/config.ts';
import { createPool } from './infrastructure/database/pool.ts';

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
    verifier = createSupabaseVerifier(config.supabaseUrl, config.jwtAudience);
  }

  const pool = createPool(config.databaseUrl, { mode: config.databaseSsl, caFile: config.databaseSslCaFile });
  try {
    await pool.query('SELECT 1');
  } catch {
    fatal('Cannot connect to the database at DATABASE_URL. For local development run: npm run dev:db -w @tinker/server, then npm run db:migrate -w @tinker/server');
  }

  const app = await buildApp({ config, pool, verifier, ...(devSigner ? { devSigner } : {}) });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
