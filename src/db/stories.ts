import { query, type Sql } from './pool.js';
import type { ArticleWithSource } from './articles.js';

export interface Story {
  id: number;
  title: string | null;
  summary: string | null;
  article_count: number;
  first_seen_at: Date;
  updated_at: Date;
}

export interface StoryListItem extends Story {
  source_count: number;
  latest_at: Date | null;
  excerpt: string | null;
}

/** pgvector accepts a textual array literal like "[0.1,0.2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/**
 * Create a new story seeded by one article: the story centroid starts as that
 * article's embedding. Assigns the article to the story. Returns the story id.
 */
export async function createStorySeed(articleId: number, client?: Sql): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO stories (title, centroid, article_count, first_seen_at, updated_at)
     SELECT a.title, a.embedding, 1, COALESCE(a.published_at, a.fetched_at), now()
       FROM articles a WHERE a.id = $1
     RETURNING id`,
    [articleId],
    client,
  );
  const storyId = rows[0]!.id;
  await query('UPDATE articles SET story_id = $1 WHERE id = $2', [storyId, articleId], client);
  return storyId;
}

export async function assignArticle(articleId: number, storyId: number, client?: Sql): Promise<void> {
  await query('UPDATE articles SET story_id = $1 WHERE id = $2', [storyId, articleId], client);
}

/**
 * Find the best-matching existing story for an article via *single-link*
 * clustering: the most similar already-clustered article within the time
 * window. Matching against individual members (not a story centroid) avoids
 * centroid drift, where a growing cluster's average vector starts matching
 * everything. Returns null if the nearest neighbour is below `minSim`.
 */
export async function bestStoryFor(
  articleId: number,
  windowHours: number,
  minSim: number,
  client?: Sql,
): Promise<{ storyId: number; sim: number } | null> {
  const { rows } = await query<{ story_id: number; sim: number }>(
    `SELECT a2.story_id, 1 - (a1.embedding <=> a2.embedding) AS sim
       FROM articles a1, articles a2
      WHERE a1.id = $1
        AND a1.embedding IS NOT NULL
        AND a2.embedding IS NOT NULL
        AND a2.story_id IS NOT NULL
        AND a2.id <> a1.id
        AND a2.fetched_at > now() - ($2 || ' hours')::interval
      ORDER BY a1.embedding <=> a2.embedding ASC
      LIMIT 1`,
    [articleId, windowHours],
    client,
  );
  const top = rows[0];
  if (!top || top.sim < minSim) return null;
  return { storyId: top.story_id, sim: top.sim };
}

/** Recompute a story's centroid, member count and title from its articles. */
export async function recomputeStory(storyId: number, client?: Sql): Promise<void> {
  await query(
    `UPDATE stories s SET
        centroid = sub.centroid,
        article_count = sub.n,
        title = COALESCE(s.title, sub.title),
        updated_at = now()
       FROM (
         SELECT avg(embedding) AS centroid,
                count(*)        AS n,
                (array_agg(title ORDER BY COALESCE(published_at, fetched_at) ASC))[1] AS title
           FROM articles WHERE story_id = $1
       ) sub
      WHERE s.id = $1`,
    [storyId],
    client,
  );
}

export async function listStories(limit = 30, offset = 0): Promise<StoryListItem[]> {
  const { rows } = await query<StoryListItem>(
    `SELECT s.id, s.title, s.summary, s.article_count, s.first_seen_at, s.updated_at,
            (SELECT count(DISTINCT a.source_id) FROM articles a WHERE a.story_id = s.id) AS source_count,
            (SELECT max(COALESCE(a.published_at, a.fetched_at)) FROM articles a WHERE a.story_id = s.id) AS latest_at,
            (SELECT a.excerpt FROM articles a WHERE a.story_id = s.id
              ORDER BY COALESCE(a.published_at, a.fetched_at) DESC LIMIT 1) AS excerpt
       FROM stories s
      WHERE s.article_count > 0
      ORDER BY latest_at DESC NULLS LAST
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}

export async function getStory(id: number): Promise<Story | null> {
  const { rows } = await query<Story>(
    `SELECT id, title, summary, article_count, first_seen_at, updated_at FROM stories WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getStoryArticles(storyId: number): Promise<ArticleWithSource[]> {
  const { rows } = await query<ArticleWithSource>(
    `SELECT a.*, s.name AS source_name, s.site_url
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.story_id = $1
      ORDER BY COALESCE(a.published_at, a.fetched_at) ASC`,
    [storyId],
  );
  return rows;
}

export async function countStories(): Promise<number> {
  const { rows } = await query<{ n: string }>(
    'SELECT count(*)::text AS n FROM stories WHERE article_count > 0',
  );
  return Number(rows[0]?.n ?? 0);
}

/** Reset clustering: detach all articles and delete stories. */
export async function resetClustering(client?: Sql): Promise<void> {
  await query('UPDATE articles SET story_id = NULL', undefined, client);
  await query('DELETE FROM stories', undefined, client);
}
