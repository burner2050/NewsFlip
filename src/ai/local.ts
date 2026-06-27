import type { Embedder } from './types.js';
import { log } from '../lib/logger.js';

// Transformers.js is heavy (bundles an ONNX runtime), so it's imported lazily —
// only when the local embedder is actually used, keeping the stub path light.
type FeatureExtractionPipeline = (
  texts: string | string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

/**
 * Local semantic embedder using sentence-transformers/all-MiniLM-L6-v2 via
 * Transformers.js. Runs fully offline (no API key); the ~90MB ONNX model is
 * downloaded and cached on first use. Output is 384-dim and L2-normalized,
 * matching the `vector(384)` schema — no migration needed.
 */
export class LocalEmbedder implements Embedder {
  readonly dim = 384;
  private static readonly MODEL = 'Xenova/all-MiniLM-L6-v2';
  private pipe: Promise<FeatureExtractionPipeline> | null = null;

  private getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipe) {
      this.pipe = (async () => {
        log.info(`Loading local embedding model ${LocalEmbedder.MODEL} (first run downloads it)…`);
        const { pipeline } = await import('@xenova/transformers');
        const p = await pipeline('feature-extraction', LocalEmbedder.MODEL);
        log.info('Local embedding model ready');
        return p as unknown as FeatureExtractionPipeline;
      })();
    }
    return this.pipe;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const pipe = await this.getPipeline();
    const out: number[][] = [];
    // Process one at a time to bound memory; MiniLM truncates long inputs to its
    // 256-token window, so cap input length to keep things fast.
    for (const text of texts) {
      const res = await pipe(text.slice(0, 2000), { pooling: 'mean', normalize: true });
      out.push(Array.from(res.data));
    }
    return out;
  }
}
