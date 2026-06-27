import { createHash } from 'node:crypto';
import { tokenize } from './text.js';

/** SHA-256 hex of a normalized string — used for exact-duplicate detection. */
export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 64-bit FNV-1a hash of a token, returned as a BigInt. */
function fnv1a64(token: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < token.length; i++) {
    hash ^= BigInt(token.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash;
}

/**
 * 64-bit SimHash over the document's tokens (with 2-gram shingles for a bit of
 * word-order sensitivity). Near-duplicate documents produce hashes with a small
 * Hamming distance. Returned as a signed BigInt so it round-trips through a
 * Postgres BIGINT column.
 */
export function simhash(text: string): bigint {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0n;

  const features = new Map<string, number>();
  const add = (f: string) => features.set(f, (features.get(f) ?? 0) + 1);
  for (let i = 0; i < tokens.length; i++) {
    add(tokens[i]!);
    if (i + 1 < tokens.length) add(`${tokens[i]}_${tokens[i + 1]}`);
  }

  const bitWeights = new Array<number>(64).fill(0);
  for (const [feature, weight] of features) {
    const h = fnv1a64(feature);
    for (let b = 0; b < 64; b++) {
      const bit = (h >> BigInt(b)) & 1n;
      bitWeights[b]! += bit === 1n ? weight : -weight;
    }
  }

  let result = 0n;
  for (let b = 0; b < 64; b++) {
    if (bitWeights[b]! > 0) result |= 1n << BigInt(b);
  }
  return toSigned64(result);
}

/** Hamming distance between two 64-bit simhashes (count of differing bits). */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = (toUnsigned64(a) ^ toUnsigned64(b)) & 0xffffffffffffffffn;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}

const TWO_63 = 1n << 63n;
const TWO_64 = 1n << 64n;

/** Map an unsigned 64-bit value into the signed range Postgres BIGINT expects. */
export function toSigned64(v: bigint): bigint {
  const u = v & (TWO_64 - 1n);
  return u >= TWO_63 ? u - TWO_64 : u;
}

/** Map a (possibly signed) 64-bit value back to unsigned for bit ops. */
export function toUnsigned64(v: bigint): bigint {
  return v < 0n ? v + TWO_64 : v;
}
