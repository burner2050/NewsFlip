import { config } from '../config.js';
import { recentSimhashes } from '../db/articles.js';
import { hammingDistance } from '../lib/hash.js';

/**
 * In-memory near-duplicate detector for one ingest run. Seeded with recent
 * simhashes from the DB, then updated as new articles are accepted so dupes
 * within the same run are also caught.
 *
 * Exact-duplicate detection (same canonical_url / content_hash) is handled by
 * the DB unique constraints + ON CONFLICT, so this only covers *near* dupes
 * (e.g. the same wire story reworded by two outlets sharing most vocabulary).
 */
export class NearDupIndex {
  private hashes: bigint[] = [];

  private constructor(seed: bigint[]) {
    this.hashes = seed;
  }

  static async load(): Promise<NearDupIndex> {
    const seed = await recentSimhashes(config.dedupWindowHours);
    return new NearDupIndex(seed);
  }

  /** True if `sh` is within the Hamming threshold of any known simhash. */
  isDuplicate(sh: bigint): boolean {
    const threshold = config.dedupHammingThreshold;
    for (const known of this.hashes) {
      if (hammingDistance(sh, known) <= threshold) return true;
    }
    return false;
  }

  add(sh: bigint): void {
    this.hashes.push(sh);
  }
}
