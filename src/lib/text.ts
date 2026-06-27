/** Strip HTML tags and decode a few common entities into plain text. */
export function stripHtml(html: string): string {
  if (!html) return '';
  const noTags = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(noTags);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Collapse whitespace into single spaces and trim. */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Lowercased, punctuation-free token stream used for hashing/simhash. */
export function tokenize(s: string): string[] {
  return normalizeWhitespace(s.toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** A short plain-text excerpt from (possibly HTML) content. */
export function makeExcerpt(text: string, maxLen = 280): string {
  const clean = normalizeWhitespace(stripHtml(text));
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1).replace(/\s+\S*$/, '') + '…';
}
