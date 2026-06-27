import { insertArticle, existsByContentHash, type NewArticle } from '../db/articles.js';
import { listSources, updateFetchState, type Source } from '../db/sources.js';
import { log } from '../lib/logger.js';
import { canonicalizeUrl } from '../lib/url.js';
import { contentHash, simhash } from '../lib/hash.js';
import { makeExcerpt, normalizeWhitespace, stripHtml } from '../lib/text.js';
import { fetchFeed, type ParsedItem } from './rss.js';
import { NearDupIndex } from './dedup.js';

export interface IngestStats {
  sources: number;
  fetched: number;
  notModified: number;
  inserted: number;
  duplicates: number;
  errors: number;
}

/** Ingest every active source. */
export async function ingestAll(): Promise<IngestStats> {
  const sources = await listSources(true);
  const dedup = await NearDupIndex.load();
  const stats: IngestStats = {
    sources: sources.length,
    fetched: 0,
    notModified: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
  };

  for (const source of sources) {
    try {
      await ingestSource(source, dedup, stats);
    } catch (err) {
      stats.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Ingest failed for ${source.name} (${source.feed_url}): ${msg}`);
      await updateFetchState(source.id, { error: msg });
    }
  }

  log.info(
    `Ingest done: ${stats.inserted} new, ${stats.duplicates} dup, ` +
      `${stats.notModified} unchanged, ${stats.errors} errors across ${stats.sources} sources`,
  );
  return stats;
}

async function ingestSource(source: Source, dedup: NearDupIndex, stats: IngestStats): Promise<void> {
  const result = await fetchFeed(source.feed_url, {
    etag: source.etag,
    lastModified: source.last_modified,
  });

  if (result.notModified) {
    stats.notModified++;
    await updateFetchState(source.id, { error: null });
    return;
  }

  stats.fetched++;
  for (const item of result.items) {
    if (await persistItem(source, item, dedup)) stats.inserted++;
    else stats.duplicates++;
  }

  await updateFetchState(source.id, {
    etag: result.etag,
    lastModified: result.lastModified,
    error: null,
  });
}

/** Normalize, dedup and insert a single feed item. Returns true if inserted. */
async function persistItem(source: Source, item: ParsedItem, dedup: NearDupIndex): Promise<boolean> {
  const plain = normalizeWhitespace(stripHtml(item.content));
  const hashBasis = normalizeWhitespace(`${item.title}\n${plain}`).toLowerCase();
  const cHash = contentHash(hashBasis);
  const sHash = simhash(`${item.title} ${plain}`);

  // Exact duplicate by content hash (handles syndicated copies under new URLs).
  if (await existsByContentHash(cHash)) return false;
  // Near-duplicate by simhash within the look-back window.
  if (dedup.isDuplicate(sHash)) return false;

  const article: NewArticle = {
    sourceId: source.id,
    guid: item.guid,
    url: item.url,
    canonicalUrl: canonicalizeUrl(item.url),
    title: item.title,
    author: item.author,
    content: plain,
    excerpt: makeExcerpt(plain),
    lang: null,
    publishedAt: item.publishedAt,
    contentHash: cHash,
    simhash: sHash,
  };

  const id = await insertArticle(article);
  if (id === null) return false; // lost a race / canonical_url or guid collision
  dedup.add(sHash);
  return true;
}
