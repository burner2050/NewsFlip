import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { query } from '../db/pool.js';
import { getEmbedder } from '../ai/index.js';
import {
  assignArticle,
  bestStoryFor,
  createStorySeed,
  recomputeStory,
  resetClustering,
  toVectorLiteral,
} from '../db/stories.js';

/**
 * Compute and store embeddings for any articles that don't have one yet.
 * Uses the configured (currently stub) embedder; swapping in a real embedding
 * model needs no changes here. Returns the number of articles embedded.
 */
export async function backfillEmbeddings(batchSize = 200): Promise<number> {
  const embedder = getEmbedder();
  let total = 0;

  for (;;) {
    const { rows } = await query<{ id: number; title: string; content: string }>(
      `SELECT id, title, content FROM articles WHERE embedding IS NULL LIMIT $1`,
      [batchSize],
    );
    if (rows.length === 0) break;

    const vectors = await embedder.embed(rows.map((r) => `${r.title}\n${r.content}`));
    for (let i = 0; i < rows.length; i++) {
      await query('UPDATE articles SET embedding = $1::vector WHERE id = $2', [
        toVectorLiteral(vectors[i]!),
        rows[i]!.id,
      ]);
    }
    total += rows.length;
    if (rows.length < batchSize) break;
  }

  if (total > 0) log.info(`Embedded ${total} article(s)`);
  return total;
}

/**
 * Incrementally cluster every article that has an embedding but no story yet,
 * oldest first so earlier articles seed the stories that later ones join.
 * Returns counts of stories created vs. joined.
 */
export async function clusterUnassigned(): Promise<{ created: number; joined: number }> {
  const { rows } = await query<{ id: number }>(
    `SELECT id FROM articles
      WHERE story_id IS NULL AND embedding IS NOT NULL
      ORDER BY COALESCE(published_at, fetched_at) ASC`,
  );

  let created = 0;
  let joined = 0;
  for (const { id } of rows) {
    const match = await bestStoryFor(id, config.clusterWindowHours, config.clusterSimThreshold);
    if (match) {
      await assignArticle(id, match.storyId);
      await recomputeStory(match.storyId);
      joined++;
    } else {
      await createStorySeed(id);
      created++;
    }
  }

  if (created || joined) {
    log.info(`Clustering: ${created} new story(ies), ${joined} article(s) joined existing`);
  }
  return { created, joined };
}

/** Embed any new articles, then cluster them. Safe to call after each ingest. */
export async function embedAndCluster(): Promise<void> {
  await backfillEmbeddings();
  await clusterUnassigned();
}

/** Wipe all stories and re-cluster from scratch (embeddings are kept). */
export async function recluster(): Promise<{ created: number; joined: number }> {
  await resetClustering();
  await backfillEmbeddings();
  return clusterUnassigned();
}

/** Recompute ALL embeddings (after changing the embedder). Detaches stories. */
export async function reembedAll(): Promise<number> {
  await resetClustering();
  await query('UPDATE articles SET embedding = NULL');
  return backfillEmbeddings();
}

/** Recompute ALL embeddings (after changing the embedder), then re-cluster. */
export async function reembedAndRecluster(): Promise<{ created: number; joined: number }> {
  await reembedAll();
  return clusterUnassigned();
}
