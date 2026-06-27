// Tracking / campaign params that never identify distinct content.
const TRACKING_PREFIXES = ['utm_', 'mc_'];
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'igshid',
  'mkt_tok', 'cmpid', 'cid', 'ncid', 'spm', 'ref', 'ref_src', 'source',
  '_hsenc', '_hsmi', 'icid', 'oicd', 'ito', 'at_medium', 'at_campaign',
]);

/**
 * Canonicalize a URL for deduplication:
 *  - lowercase scheme + host, drop default ports
 *  - strip a leading "www."
 *  - remove tracking query params and sort the rest
 *  - drop the fragment
 *  - normalize trailing slash
 * Falls back to a trimmed original if parsing fails.
 */
export function canonicalizeUrl(input: string): string {
  const trimmed = input.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }

  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hash = '';

  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
    u.port = '';
  }

  const kept: [string, string][] = [];
  for (const [k, v] of u.searchParams.entries()) {
    const key = k.toLowerCase();
    if (TRACKING_PARAMS.has(key)) continue;
    if (TRACKING_PREFIXES.some((p) => key.startsWith(p))) continue;
    kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);

  // Normalize trailing slash on non-root paths.
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }

  return u.toString();
}
