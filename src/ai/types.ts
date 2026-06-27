/**
 * Pluggable AI surface. Phase 1 ships deterministic stubs so the whole pipeline
 * runs without external services. Phase 2 swaps in real providers (Anthropic /
 * OpenAI / Ollama) by implementing these interfaces — no call-site changes.
 */

export interface ArticleInput {
  title: string;
  content: string;
}

export interface Embedder {
  readonly dim: number;
  /** Return one vector per input text. */
  embed(texts: string[]): Promise<number[][]>;
}

export interface Fact {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

export interface FactExtractor {
  extract(article: ArticleInput): Promise<Fact[]>;
}

export interface Summarizer {
  /** A concise neutral summary of one or more articles in a story. */
  summarize(articles: ArticleInput[]): Promise<string>;
}
