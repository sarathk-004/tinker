/**
 * Logical backup and RECOVERY DRILL (acceptance A32). A managed database's own backups (Supabase PITR / daily backups) can only be
 * restored by the provider, and the Free plan has none; this gives an independent, testable copy and proves a restore works.
 *
 *   npm run backup:drill -w @tinker/server                    drill: export SOURCE -> restore into a fresh scratch database -> verify -> drop it
 *   npm run backup:export -w @tinker/server -- <dir>           export only (consistent snapshot, one NDJSON file per table + manifest)
 *   npm run backup:restore -w @tinker/server -- <dir>          restore a backup into the (empty) database at RESTORE_URL
 *
 * SOURCE is DATABASE_URL (.env, or .env via `npm run backup:drill:supabase`). The drill never writes to
 * the source: the export runs in a READ ONLY, REPEATABLE READ transaction. Backups contain user data: they go to `backups/` (git-ignored).
 * Reports: rows and bytes, time to export, time to restore (= the measured RTO for this data size), and the age of the data (RPO).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { TABLES, exportBackup, restoreBackup, verifyRestore, type Manifest } from '../src/infrastructure/backup/logical-backup.ts';

const bytesOf = (dir: string) => readdirSync(dir).reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);

async function drill(sourceUrl: string): Promise<number> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve(import.meta.dirname, '../../backups', stamp);
  const t0 = Date.now();
  const manifest = await exportBackup(sourceUrl, dir);
  const exportMs = Date.now() - t0;
  const rows = Object.values(manifest.tables).reduce((s, t) => s + t.rows, 0);
  console.log(`export:  ${rows} rows in ${Object.keys(manifest.tables).length} tables, ${(bytesOf(dir) / 1024).toFixed(0)} KiB, ${exportMs} ms  (${dir})`);

  // A fresh database on the local server (never the source): the "isolated environment" of the runbook.
  const local = process.env.DRILL_ADMIN_URL ?? 'postgres://tinker:tinker@localhost:54329/postgres';
  const name = `tinker_drill_${Date.now()}`;
  const admin = new pg.Client(local);
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const targetUrl = local.replace(/\/[^/]*$/, `/${name}`);
  let problems: string[] = [];
  let restoreMs = 0;
  try {
    const t1 = Date.now();
    const restored = await restoreBackup(targetUrl, dir);
    restoreMs = Date.now() - t1;
    console.log(`restore: ${restored.rows} rows into a new empty database in ${restoreMs} ms (migrations + data)`);
    problems = await verifyRestore(targetUrl, manifest);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  }
  const ageSeconds = Math.round((Date.now() - Date.parse(manifest.createdAt)) / 1000);
  console.log(`verify:  ${problems.length === 0 ? 'every table matches the backup (row counts and content checksums), no orphaned revisions' : problems.join('; ')}`);
  console.log(`measured RTO for this data size (export + restore, not counting the human): ${((exportMs + restoreMs) / 1000).toFixed(1)} s; restore alone ${(restoreMs / 1000).toFixed(1)} s`);
  console.log(`measured RPO of this backup: data as of ${manifest.createdAt} (a backup is only as fresh as when it was taken; run it on a schedule to bound the loss window)`);
  void ageSeconds;
  return problems.length === 0 ? 0 : 1;
}

const [command, arg] = process.argv.slice(2);
if (command === 'export') {
  const url = process.env.DATABASE_URL;
  if (!url || !arg) {
    console.error('usage: DATABASE_URL=... backup:export <dir>');
    process.exit(2);
  }
  const m = await exportBackup(url, resolve(arg));
  console.log(`exported ${Object.values(m.tables).reduce((s, t) => s + t.rows, 0)} rows to ${resolve(arg)}`);
} else if (command === 'restore') {
  const url = process.env.RESTORE_URL;
  if (!url || !arg) {
    console.error('usage: RESTORE_URL=<empty database url> backup:restore <dir>');
    process.exit(2);
  }
  const { rows } = await restoreBackup(url, resolve(arg));
  const problems = await verifyRestore(url, JSON.parse(readFileSync(join(resolve(arg), 'manifest.json'), 'utf8')) as Manifest);
  console.log(`restored ${rows} rows; ${problems.length === 0 ? 'verified' : `PROBLEMS: ${problems.join('; ')}`}`);
  process.exit(problems.length === 0 ? 0 : 1);
} else if (command === 'drill' || command === undefined) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set (.env).');
    process.exit(2);
  }
  process.exit(await drill(url));
}
