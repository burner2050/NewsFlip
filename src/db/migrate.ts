import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool, query } from './pool.js';
import { log } from '../lib/logger.js';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../db/migrations',
);

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedSet(): Promise<Set<string>> {
  const { rows } = await query<{ filename: string }>('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

export async function migrate(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedSet();

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    log.info(`Applying migration ${file}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      log.error(`Migration ${file} failed`, err);
      throw err;
    } finally {
      client.release();
    }
  }
  log.info(count === 0 ? 'No pending migrations.' : `Applied ${count} migration(s).`);
}

// Run directly: `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.ts')) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      log.error('Migration run failed', err);
      pool.end().finally(() => process.exit(1));
    });
}
