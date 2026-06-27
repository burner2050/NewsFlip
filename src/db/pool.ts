import pg from 'pg';
import { config } from '../config.js';

// node-postgres returns BIGINT (OID 20) as strings by default to avoid
// precision loss. Our ids comfortably fit in a JS number, and the app treats
// them as numbers, so parse them. Override only if you expect ids > 2^53.
pg.types.setTypeParser(20, (val) => Number.parseInt(val, 10));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // Background client errors (e.g. server restart) shouldn't crash the process.
  console.error('Unexpected idle pg client error', err);
});

export type Sql = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
  client: Sql = pool,
): Promise<pg.QueryResult<T>> {
  return client.query<T>(text, params as any[]);
}

/** Run a function inside a transaction, committing on success. */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
