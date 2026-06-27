import { createHash } from 'node:crypto';
import type { ArticleInput, Embedder, Fact, FactExtractor, Summarizer } from './types.js';
import { makeExcerpt, tokenize } from '../lib/text.js';

/**
 * Deterministic hashing embedder: maps token hashes into a fixed-dim vector
 * (the "hashing trick") and L2-normalizes. It is NOT semantic — two articles
 * sharing vocabulary land near each other, paraphrases do not. Good enough to
 * exercise pgvector storage/indexing until a real embedding model is wired in.
 */
export class StubEmbedder implements Embedder {
  constructor(readonly dim: number) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(this.dim).fill(0);
    for (const tok of tokenize(text)) {
      const h = createHash('md5').update(tok).digest();
      const idx = h.readUInt32LE(0) % this.dim;
      const sign = (h[4]! & 1) === 0 ? 1 : -1;
      vec[idx]! += sign;
    }
    let norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    if (norm === 0) norm = 1;
    return vec.map((x) => x / norm);
  }
}

/** No-op fact extractor. Phase 2 replaces this with an LLM-backed extractor. */
export class StubFactExtractor implements FactExtractor {
  async extract(_article: ArticleInput): Promise<Fact[]> {
    return [];
  }
}

/** Naive extractive "summary": the leading sentences of the first article. */
export class StubSummarizer implements Summarizer {
  async summarize(articles: ArticleInput[]): Promise<string> {
    const first = articles[0];
    if (!first) return '';
    return makeExcerpt(`${first.title}. ${first.content}`, 400);
  }
}
