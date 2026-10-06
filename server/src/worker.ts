import { ConfigError, loadConfig } from './infrastructure/config/config.ts';
import { createPool } from './infrastructure/database/pool.ts';
import { startWorker } from './modules/jobs/worker.ts';

/**
 * The background worker (decision D12): a separate process from the API, same database. It claims jobs from Postgres, runs the
 * maintenance handlers (revision pruning, expired request cleanup, deleted diagram purge) and schedules them hourly.
 *   npm run worker -w @tinker/server
 */
async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  if (!config.databaseUrl) {
    console.error('Invalid configuration:\n  - DATABASE_URL: is required to start the worker');
    process.exit(1);
  }
  const pool = createPool(config.databaseUrl, { mode: config.databaseSsl, caFile: config.databaseSslCaFile });
  await pool.query('SELECT 1');
  const log = (message: string, data: Record<string, unknown>) => console.log(JSON.stringify({ level: 'info', msg: message, ...data }));
  const worker = startWorker({ pool, log, leaseSeconds: config.worker.leaseSeconds, pollMs: config.worker.pollMs });
  log('worker started', { pollMs: config.worker.pollMs, leaseSeconds: config.worker.leaseSeconds });

  const shutdown = async (signal: string) => {
    log('worker stopping', { signal });
    await worker.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
