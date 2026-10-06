import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { exportBackup, restoreBackup, verifyRestore, type Manifest } from '../src/infrastructure/backup/logical-backup.ts';
import { call, cmd, createDiagramFor, startHarness, type Harness } from './support/harness.ts';

/** Recovery drill (A32) as a test: back up a database with real application data, restore into a new empty database, compare. */
describe('logical backup and restore', () => {
  let h: Harness;
  const dbUrl = inject('dbUrl');
  const scratch: string[] = [];

  beforeAll(async () => {
    h = await startHarness();
    const u = await h.newUser('backup');
    const { diagram } = await createDiagramFor(h, u, 'Backed up');
    let version = 1;
    for (const name of ['Orders', 'PostgreSQL', 'Redis']) version = (await cmd(diagram.diagramId, u, h, version, { type: 'ADD_NODE', node: { name, kind: 'SERVICE' } })).body.version;
    await call(h, u, 'POST', `/v1/diagrams/${diagram.diagramId}/ai/ask`, { question: 'what is connected?' });
    await call(h, u, 'POST', `/v1/diagrams/${diagram.diagramId}/restore`, { expectedVersion: version, version: 2 }, { 'idempotency-key': crypto.randomUUID() });
  });
  afterAll(async () => {
    const admin = new pg.Client(dbUrl.replace(/\/[^/]*$/, '/postgres'));
    await admin.connect();
    for (const name of scratch) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
    await h.close();
  });

  async function emptyDatabase(): Promise<string> {
    const name = `drill_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const admin = new pg.Client(dbUrl.replace(/\/[^/]*$/, '/postgres'));
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    scratch.push(name);
    return dbUrl.replace(/\/[^/]*$/, `/${name}`);
  }

  it('a restored database is identical to the backup, table by table', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tinker-backup-'));
    const manifest = await exportBackup(dbUrl, dir);
    expect(manifest.tables['diagrams']!.rows).toBeGreaterThan(0);
    expect(manifest.tables['diagram_revisions']!.rows).toBeGreaterThan(3);
    expect(manifest.tables['conversation_messages']!.rows).toBeGreaterThan(0);
    const target = await emptyDatabase();
    const { rows } = await restoreBackup(target, dir);
    expect(rows).toBe(Object.values(manifest.tables).reduce((s, t) => s + t.rows, 0));
    expect(await verifyRestore(target, manifest)).toEqual([]);
    // and the restored data is usable: the schema constraints and migrations are in place
    const client = new pg.Client(target);
    await client.connect();
    const { rows: counts } = await client.query(`SELECT (SELECT count(*) FROM diagrams)::int AS diagrams, (SELECT count(*) FROM pgmigrations)::int AS migrations`);
    await client.end();
    expect(counts[0].diagrams).toBe(manifest.tables['diagrams']!.rows);
    expect(counts[0].migrations).toBe(manifest.migrations.length);
  });

  it('refuses a backup whose file was changed, and a target that already holds data (never mixes or half-restores)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tinker-backup-'));
    await exportBackup(dbUrl, dir);
    const file = join(dir, 'diagrams.ndjson');
    writeFileSync(file, readFileSync(file, 'utf8').replace('Backed up', 'Tampered'));
    await expect(restoreBackup(await emptyDatabase(), dir)).rejects.toThrow(/checksum/);

    const good = mkdtempSync(join(tmpdir(), 'tinker-backup-'));
    await exportBackup(dbUrl, good);
    const target = await emptyDatabase();
    await restoreBackup(target, good);
    await expect(restoreBackup(target, good)).rejects.toThrow(/not empty/);
  });

  it('the export never writes to the source (read-only snapshot)', async () => {
    const before = (await h.pool.query(`SELECT count(*)::int AS n, max(updated_at) AS latest FROM diagrams`)).rows[0];
    await exportBackup(dbUrl, mkdtempSync(join(tmpdir(), 'tinker-backup-')));
    const after = (await h.pool.query(`SELECT count(*)::int AS n, max(updated_at) AS latest FROM diagrams`)).rows[0];
    expect(after).toEqual(before);
  });

  it('verification catches a restore that lost data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tinker-backup-'));
    const manifest = await exportBackup(dbUrl, dir);
    const target = await emptyDatabase();
    await restoreBackup(target, dir);
    const client = new pg.Client(target);
    await client.connect();
    await client.query(`DELETE FROM conversation_messages`);
    await client.end();
    const problems = await verifyRestore(target, manifest as Manifest);
    expect(problems.some((p) => p.startsWith('conversation_messages'))).toBe(true);
  });
});
