import { readFileSync } from 'node:fs';
import pg from 'pg';

// BIGINT (int8) columns hold diagram versions and small counters; return them as numbers, not strings.
pg.types.setTypeParser(20, (value) => Number(value));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
/** Anything that can run a query: the pool or a transaction client. */
export type Queryable = Pick<pg.Pool, 'query'>;

export interface SslOptions {
  mode: 'off' | 'verify' | 'no-verify';
  caFile?: string | undefined;
}

/**
 * Remove `sslmode` from the URL (it would override the explicit `ssl` option) and build the TLS settings deterministically.
 * Postgres connection strings from Supabase carry `?sslmode=require`; here TLS policy comes only from DATABASE_SSL.
 */
function tlsFor(connectionString: string, ssl: SslOptions): { connectionString: string; ssl?: pg.ClientConfig['ssl'] } {
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  const cleaned = url.toString();
  if (ssl.mode === 'off') return { connectionString: cleaned };
  if (ssl.mode === 'no-verify') return { connectionString: cleaned, ssl: { rejectUnauthorized: false } };
  const ca = ssl.caFile ? { ca: readFileSync(ssl.caFile, 'utf8') } : {};
  return { connectionString: cleaned, ssl: { rejectUnauthorized: true, ...ca } };
}

export function createPool(connectionString: string, ssl: SslOptions = { mode: 'off' }): Pool {
  const pool = new pg.Pool({
    ...tlsFor(connectionString, ssl),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Never let a stuck statement hold row locks forever.
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  // An IDLE connection can be dropped by the database or its pooler (restart, failover, network). The pool emits `error` for it and
  // Node kills the process when nobody listens. Log it and carry on: the pool discards that connection and opens a new one.
  pool.on('error', (error) => console.error(JSON.stringify({ level: 'warn', msg: 'idle database connection failed', name: error.name, code: (error as { code?: string }).code })));
  return pool;
}

/** Run `fn` in one transaction: commit on success, roll back on any error. */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
