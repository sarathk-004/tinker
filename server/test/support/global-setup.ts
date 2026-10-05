import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { runner } from 'node-pg-migrate';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolvePort(port));
    });
  });
}

/** Start an isolated real Postgres, apply every migration, hand the URL to tests. Torn down after the run. */
export default async function setup(project: TestProject) {
  const dir = await mkdtemp(join(tmpdir(), 'tinker-pg-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'tinker', password: 'tinker', port, persistent: false, onLog: () => undefined, onError: () => undefined });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('tinker_test');
  const dbUrl = `postgres://tinker:tinker@127.0.0.1:${port}/tinker_test`;

  await runner({
    databaseUrl: dbUrl,
    dir: resolve(import.meta.dirname, '../../migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    log: () => undefined,
  });

  project.provide('dbUrl', dbUrl);

  return async () => {
    await pg.stop();
    await rm(dir, { recursive: true, force: true });
  };
}
