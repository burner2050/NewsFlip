import { query, type Sql } from './pool.js';

export interface Article {
  id: number;
  source_id: number;
  story_id: number | null;
  guid: string | null;
  url: string;
  canonical_url: string;
  title: string;
  author: string | null;
  content: string;
  excerpt: string | null;
  lang: string | null;
  published_at: Date | null;
  fetched_at: Date;
  content_hash: string;
  simhash: number;
  created_at: Date;
}

export interface ArticleWithSource extends Article {
  source_name: string;
  site_url: string | null;
}

export interface NewArticle {
  sourceId: number;
  guid: string | null;
  url: string;
  canonicalUrl: string;
  title: string;
  author: string | null;
  content: string;
  excerpt: string | null;
  lang: string | null;
  publishedAt: Date | null;
  contentHash: string;
  simhash: bigint;
}

/**
 * Insert an article. Returns the new id, or null if a row with the same
 * canonical_url or (source_id, guid) already exists.
 */
export async function insertArticle(a: NewArticle, client?: Sql): Promise<number | null> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO articles
       (source_id, guid, url, canonical_url, title, author, content, excerpt,
        lang, published_at, content_hash, simhash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      a.sourceId, a.guid, a.url, a.canonicalUrl, a.title, a.author, a.content,
      a.excerpt, a.lang, a.publishedAt, a.contentHash, a.simhash.toString(),
    ],
    client,
  );
  return rows[0]?.id ?? null;
}

export async function existsByContentHash(hash: string, client?: Sql): Promise<boolean> {
  const { rows } = await query<{ one: number }>(
    `SELECT 1 AS one FROM articles WHERE content_hash = $1 LIMIT 1`,
    [hash],
    client,
  );
  return rows.length > 0;
}

/** Recent simhashes within the dedup look-back window, for near-dup checks. */
export async function recentSimhashes(windowHours: number, client?: Sql): Promise<bigint[]> {
  const { rows } = await query<{ simhash: string }>(
    `SELECT simhash::text AS simhash FROM articles
      WHERE fetched_at > now() - ($1 || ' hours')::interval`,
    [windowHours],
    client,
  );
  // Cast to text in SQL so the 64-bit value survives without precision loss.
  return rows.map((r) => BigInt(r.simhash));
}

export async function listRecent(limit = 50, offset = 0): Promise<ArticleWithSource[]> {
  const { rows } = await query<ArticleWithSource>(
    `SELECT a.*, s.name AS source_name, s.site_url
       FROM articles a
       JOIN sources s ON s.id = a.source_id
      ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}

export async function getArticle(id: number): Promise<ArticleWithSource | null> {
  const { rows } = await query<ArticleWithSource>(
    `SELECT a.*, s.name AS source_name, s.site_url
       FROM articles a
       JOIN sources s ON s.id = a.source_id
      WHERE a.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function countArticles(): Promise<number> {
  const { rows } = await query<{ n: string }>('SELECT count(*)::text AS n FROM articles');
  return Number(rows[0]?.n ?? 0);
}
