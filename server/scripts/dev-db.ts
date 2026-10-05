/**
 * Local development Postgres without Docker (real Postgres binaries via the embedded-postgres package).
 * Persistent data lives in server/.data/postgres (gitignored). Throwaway credentials, loopback only.
 *   npm run dev:db -w @tinker/server        start (keeps running; Ctrl+C to stop)
 * Then: npm run db:migrate -w @tinker/server
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const port = Number(process.env.DEV_DB_PORT ?? 54329);
const databaseDir = resolve(import.meta.dirname, '..', '.data', 'postgres');
const fresh = !existsSync(resolve(databaseDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({ databaseDir, user: 'tinker', password: 'tinker', port, persistent: true });

if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('tinker');
console.log(`Postgres ready: postgres://tinker:tinker@localhost:${port}/tinker (data: ${databaseDir})`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
setInterval(() => undefined, 1 << 30); // keep the process alive
