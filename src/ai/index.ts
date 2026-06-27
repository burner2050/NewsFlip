import { config } from '../config.js';
import { log } from '../lib/logger.js';
import type { Embedder, FactExtractor, Summarizer } from './types.js';
import { StubEmbedder, StubFactExtractor, StubSummarizer } from './stub.js';
import { LocalEmbedder } from './local.js';

// Factory functions. Phase 2: add `case 'anthropic'` etc. returning real
// implementations of the same interfaces.

export function getEmbedder(): Embedder {
  switch (config.embeddingProvider) {
    case 'stub':
      return new StubEmbedder(config.embeddingDim);
    case 'local':
    case 'transformers':
      return new LocalEmbedder();
    default:
      log.warn(`Unknown EMBEDDING_PROVIDER "${config.embeddingProvider}", falling back to stub`);
      return new StubEmbedder(config.embeddingDim);
  }
}

export function getFactExtractor(): FactExtractor {
  switch (config.aiProvider) {
    case 'stub':
      return new StubFactExtractor();
    default:
      log.warn(`Unknown AI_PROVIDER "${config.aiProvider}", falling back to stub`);
      return new StubFactExtractor();
  }
}

export function getSummarizer(): Summarizer {
  switch (config.aiProvider) {
    case 'stub':
      return new StubSummarizer();
    default:
      log.warn(`Unknown AI_PROVIDER "${config.aiProvider}", falling back to stub`);
      return new StubSummarizer();
  }
}

export type { Embedder, FactExtractor, Summarizer } from './types.js';
