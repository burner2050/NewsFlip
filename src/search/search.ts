import { query } from '../db/pool.js';
import type { ArticleWithSource } from '../db/articles.js';

export interface SearchHit extends ArticleWithSource {
  rank: number;
  headline: string; // ts_headline snippet with <mark> highlights
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
}

/**
 * Full-text search over articles using Postgres `websearch_to_tsquery`
 * (supports quoted phrases, OR, and -negation). Results are ranked and the
 * matching content snippet is highlighted.
 */
export async function searchArticles(
  q: string,
  limit = 25,
  offset = 0,
): Promise<SearchResult> {
  const text = q.trim();
  if (!text) return { hits: [], total: 0 };

  const { rows } = await query<SearchHit & { total: string }>(
    `WITH matched AS (
       SELECT a.*, s.name AS source_name, s.site_url,
              ts_rank(a.search_tsv, websearch_to_tsquery('english', $1)) AS rank
         FROM articles a
         JOIN sources s ON s.id = a.source_id
        WHERE a.search_tsv @@ websearch_to_tsquery('english', $1)
     )
     SELECT *,
            count(*) OVER () ::text AS total,
            ts_headline('english', content, websearch_to_tsquery('english', $1),
              'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=30, MinWords=10') AS headline
       FROM matched
      ORDER BY rank DESC, COALESCE(published_at, fetched_at) DESC
      LIMIT $2 OFFSET $3`,
    [text, limit, offset],
  );

  const total = rows.length > 0 ? Number(rows[0]!.total) : 0;
  return { hits: rows, total };
}

/** Validate a query string is acceptable to websearch_to_tsquery (always is). */
export function normalizeQuery(q: string): string {
  return q.trim().slice(0, 500);
}
