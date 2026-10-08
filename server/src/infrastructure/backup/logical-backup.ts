/**
 * Logical backup, restore and verification (acceptance A32). Used by `scripts/backup-drill.ts` and covered by tests.
 * The export runs in a READ ONLY, REPEATABLE READ transaction (a consistent snapshot, never a write to the source).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runner } from 'node-pg-migrate';
import pg from 'pg';

pg.types.setTypeParser(20, (v) => Number(v));

/** Parents before children (foreign keys). `pgmigrations` is recreated by running the migrations. */
export const TABLES = ['users', 'workspaces', 'workspace_memberships', 'workspace_invites', 'projects', 'diagrams', 'diagram_revisions', 'conversations', 'conversation_messages', 'mutation_requests', 'command_executions', 'jobs'] as const;

export interface Manifest {
  createdAt: string;
  migrations: string[];
  tables: Record<string, { rows: number; sha256: string }>;
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

function tlsFor(url: string): { connectionString: string; ssl?: { rejectUnauthorized: boolean } } {
  const u = new URL(url);
  const remote = !['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  u.searchParams.delete('sslmode');
  // A remote (managed) database is reached over TLS. Verification of the server certificate is the API's concern (LC4); this tool
  // only reads/writes data you own, so it accepts the provider's chain.
  return remote ? { connectionString: u.toString(), ssl: { rejectUnauthorized: false } } : { connectionString: u.toString() };
}

export async function exportBackup(sourceUrl: string, dir: string): Promise<Manifest> {
  mkdirSync(dir, { recursive: true });
  const client = new pg.Client(tlsFor(sourceUrl));
  await client.connect();
  try {
    await client.query("SET TIME ZONE 'UTC'"); // timestamps must render identically on every server, or checksums would differ for the wrong reason
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const migrations = (await client.query<{ name: string }>('SELECT name FROM pgmigrations ORDER BY id')).rows.map((r) => r.name);
    const manifest: Manifest = { createdAt: new Date().toISOString(), migrations, tables: {} };
    for (const table of TABLES) {
      const { rows } = await client.query<{ row: unknown }>(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY t::text`);
      const text = rows.map((r) => JSON.stringify(r.row)).join('\n') + (rows.length ? '\n' : '');
      writeFileSync(join(dir, `${table}.ndjson`), text);
      manifest.tables[table] = { rows: rows.length, sha256: sha(text) };
    }
    await client.query('COMMIT');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  } finally {
    await client.end();
  }
}

/** Load a backup into an EMPTY database: migrations first, then every table in one transaction, then verify against the manifest. */
export async function restoreBackup(targetUrl: string, dir: string): Promise<{ rows: number }> {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
  for (const table of TABLES) {
    const text = readFileSync(join(dir, `${table}.ndjson`), 'utf8');
    if (sha(text) !== manifest.tables[table]!.sha256) throw new Error(`backup file for ${table} does not match its checksum: refusing to restore`);
  }
  await runner({ databaseUrl: tlsFor(targetUrl).connectionString, dir: resolve(import.meta.dirname, '../../../migrations'), direction: 'up', migrationsTable: 'pgmigrations', log: () => undefined, count: Infinity });
  const client = new pg.Client(tlsFor(targetUrl));
  await client.connect();
  let total = 0;
  try {
    await client.query('BEGIN');
    for (const table of TABLES) {
      const existing = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
      if (existing.rows[0].n !== 0) throw new Error(`restore target is not empty (${table} has rows): refusing to mix data`);
      const lines = readFileSync(join(dir, `${table}.ndjson`), 'utf8').split('\n').filter(Boolean);
      for (let i = 0; i < lines.length; i += 500) {
        const chunk = `[${lines.slice(i, i + 500).join(',')}]`;
        await client.query(`INSERT INTO ${table} SELECT * FROM json_populate_recordset(null::${table}, $1::json)`, [chunk]);
      }
      total += lines.length;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  return { rows: total };
}

/** Compare a restored database with the manifest: row counts and a content digest per table. */
export async function verifyRestore(targetUrl: string, manifest: Manifest): Promise<string[]> {
  const problems: string[] = [];
  const client = new pg.Client(tlsFor(targetUrl));
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  try {
    for (const table of TABLES) {
      const { rows } = await client.query<{ row: unknown }>(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY t::text`);
      const text = rows.map((r) => JSON.stringify(r.row)).join('\n') + (rows.length ? '\n' : '');
      const expected = manifest.tables[table]!;
      if (rows.length !== expected.rows) problems.push(`${table}: ${rows.length} rows restored, ${expected.rows} expected`);
      else if (sha(text) !== expected.sha256) problems.push(`${table}: content differs from the backup (checksum)`);
    }
    // The restored data must still satisfy the application's own invariants: every diagram's current version matches its latest revision-or-later.
    const orphans = await client.query(`SELECT count(*)::int AS n FROM diagram_revisions r LEFT JOIN diagrams d ON d.id = r.diagram_id WHERE d.id IS NULL`);
    if (orphans.rows[0].n !== 0) problems.push('revisions without a diagram');
    const ahead = await client.query(`SELECT count(*)::int AS n FROM diagram_revisions r JOIN diagrams d ON d.id = r.diagram_id WHERE r.version > d.version`);
    if (ahead.rows[0].n !== 0) problems.push('a revision is newer than its diagram');
  } finally {
    await client.end();
  }
  return problems;
}

