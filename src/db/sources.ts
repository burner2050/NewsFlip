import { query, type Sql } from './pool.js';

export interface Source {
  id: number;
  name: string;
  feed_url: string;
  site_url: string | null;
  active: boolean;
  etag: string | null;
  last_modified: string | null;
  last_fetched_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

export async function addSource(
  name: string,
  feedUrl: string,
  siteUrl?: string,
): Promise<Source> {
  const { rows } = await query<Source>(
    `INSERT INTO sources (name, feed_url, site_url)
     VALUES ($1, $2, $3)
     ON CONFLICT (feed_url) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [name, feedUrl, siteUrl ?? null],
  );
  return rows[0]!;
}

export async function listSources(activeOnly = false): Promise<Source[]> {
  const { rows } = await query<Source>(
    `SELECT * FROM sources ${activeOnly ? 'WHERE active' : ''} ORDER BY name`,
  );
  return rows;
}

export async function updateFetchState(
  id: number,
  state: { etag?: string | null; lastModified?: string | null; error?: string | null },
  client?: Sql,
): Promise<void> {
  await query(
    `UPDATE sources
       SET last_fetched_at = now(),
           etag = COALESCE($2, etag),
           last_modified = COALESCE($3, last_modified),
           last_error = $4
     WHERE id = $1`,
    [id, state.etag ?? null, state.lastModified ?? null, state.error ?? null],
    client,
  );
}
