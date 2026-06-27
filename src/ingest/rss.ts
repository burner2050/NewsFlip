import Parser from 'rss-parser';
import { request } from 'undici';
import { config } from '../config.js';
import { log } from '../lib/logger.js';

export interface ParsedItem {
  guid: string | null;
  url: string;
  title: string;
  author: string | null;
  content: string; // raw (may contain HTML)
  publishedAt: Date | null;
}

export interface FetchResult {
  notModified: boolean;
  etag?: string | null;
  lastModified?: string | null;
  items: ParsedItem[];
}

const parser = new Parser({
  timeout: config.fetchTimeoutMs,
  customFields: {
    item: [['content:encoded', 'contentEncoded'], ['dc:creator', 'creator']],
  },
});

/**
 * Fetch a feed with conditional-GET caching, then parse it. Returns
 * `notModified: true` (and no items) when the server replies 304.
 */
export async function fetchFeed(
  feedUrl: string,
  cache: { etag?: string | null; lastModified?: string | null },
): Promise<FetchResult> {
  const headers: Record<string, string> = {
    'user-agent': 'NewsFlip/0.1 (+https://github.com/newsflip)',
    accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
  };
  if (cache.etag) headers['if-none-match'] = cache.etag;
  if (cache.lastModified) headers['if-modified-since'] = cache.lastModified;

  const res = await request(feedUrl, {
    method: 'GET',
    headers,
    maxRedirections: 5,
    headersTimeout: config.fetchTimeoutMs,
    bodyTimeout: config.fetchTimeoutMs,
  });

  if (res.statusCode === 304) {
    await res.body.dump();
    return { notModified: true, items: [] };
  }
  if (res.statusCode >= 400) {
    await res.body.dump();
    throw new Error(`HTTP ${res.statusCode} fetching ${feedUrl}`);
  }

  const xml = await res.body.text();
  const feed = await parser.parseString(xml);

  const items: ParsedItem[] = [];
  for (const it of feed.items) {
    const url = (it.link ?? it.guid ?? '').trim();
    if (!url) {
      log.debug(`Skipping item with no link in ${feedUrl}`);
      continue;
    }
    const anyIt = it as Parser.Item & { contentEncoded?: string; creator?: string };
    items.push({
      guid: it.guid ?? null,
      url,
      title: (it.title ?? '(untitled)').trim(),
      author: anyIt.creator ?? it.creator ?? null,
      content: anyIt.contentEncoded ?? it['content:encoded'] ?? it.content ?? it.contentSnippet ?? '',
      publishedAt: parseDate(it.isoDate ?? it.pubDate),
    });
  }

  return {
    notModified: false,
    etag: header(res.headers['etag']),
    lastModified: header(res.headers['last-modified']),
    items,
  };
}

function header(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
