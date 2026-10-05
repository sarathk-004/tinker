import pg from 'pg';

// BIGINT (int8) columns hold diagram versions and small counters; return them as numbers, not strings.
pg.types.setTypeParser(20, (value) => Number(value));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
/** Anything that can run a query: the pool or a transaction client. */
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Never let a stuck statement hold row locks forever.
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
  });
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
