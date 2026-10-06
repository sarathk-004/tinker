import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { describe, expect, it, inject } from 'vitest';
import { createPool } from '../src/infrastructure/database/pool.ts';

const adminUrl = () => inject('dbUrl');
const dbUrlFor = (name: string) => adminUrl().replace(/\/[^/]+$/, `/${name}`);
const migrationsDir = resolve(import.meta.dirname, '../migrations');

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

describe('database access policy (no public exposure)', () => {
  it('every application table has row level security enabled', async () => {
    const rows = await withClient(adminUrl(), (c) => c.query(`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`));
    expect(rows.rows.length).toBeGreaterThanOrEqual(10);
    for (const r of rows.rows) expect(r.rowsecurity, r.tablename).toBe(true);
  });

  it('a non-owner role (like Supabase anon/authenticated) sees nothing even if grants are added by mistake', async () => {
    await withClient(adminUrl(), async (c) => {
      await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon_probe') THEN CREATE ROLE anon_probe NOLOGIN; END IF; END $$`);
      await c.query(`GRANT USAGE ON SCHEMA public TO anon_probe`);
      await c.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon_probe`); // the mistake RLS must survive
      const subject = `policy:${randomUUID()}`;
      await c.query(`INSERT INTO users (external_auth_id, email) VALUES ($1, 'secret@example.test')`, [subject]);
      await c.query('SET ROLE anon_probe');
      const read = await c.query(`SELECT count(*)::int AS n FROM users`);
      expect(read.rows[0].n).toBe(0);
      await expect(c.query(`INSERT INTO users (external_auth_id) VALUES ('hacker')`)).rejects.toThrow(/row-level security/);
      await c.query('RESET ROLE');
    });
  });
});

describe('migrations are reversible and repeatable on a scratch database', () => {
  it('up -> down -> up succeeds and recreates the schema', async () => {
    const name = `tinker_migrate_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await withClient(adminUrl(), (c) => c.query(`CREATE DATABASE ${name}`));
    const opts = { databaseUrl: dbUrlFor(name), dir: migrationsDir, migrationsTable: 'pgmigrations', log: () => undefined } as const;
    await runner({ ...opts, direction: 'up', count: Infinity });
    await runner({ ...opts, direction: 'down', count: Infinity });
    const afterDown = await withClient(dbUrlFor(name), (c) => c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations'`));
    expect(afterDown.rows[0].n).toBe(0);
    await runner({ ...opts, direction: 'up', count: Infinity });
    const afterUp = await withClient(dbUrlFor(name), (c) => c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations'`));
    expect(afterUp.rows[0].n).toBe(10);
    await withClient(adminUrl(), (c) => c.query(`DROP DATABASE ${name}`));
  });
});

describe('connection TLS policy', () => {
  it('ignores sslmode in the URL: policy comes only from DATABASE_SSL (a Supabase-style ?sslmode=require cannot force TLS on a server without it)', async () => {
    const pool = createPool(`${adminUrl()}?sslmode=require`, { mode: 'off' });
    try {
      expect((await pool.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it('requesting TLS against a server without TLS fails loudly instead of silently downgrading', async () => {
    const pool = createPool(adminUrl(), { mode: 'no-verify' });
    try {
      await expect(pool.query('SELECT 1')).rejects.toThrow(/SSL/i);
    } finally {
      await pool.end();
    }
  });
});
