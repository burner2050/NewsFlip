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

// Common English stopwords — removed before embedding so vectors are dominated
// by content words (names, places, orgs) instead of generic vocabulary, which
// keeps unrelated articles from looking similar.
const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','else','for','of','to','in','on','at','by','with',
  'from','as','is','are','was','were','be','been','being','it','its','this','that','these','those',
  'he','she','they','them','his','her','their','we','you','i','me','my','our','us','your',
  'not','no','nor','so','than','too','very','can','will','just','should','now','also','more','most',
  'has','have','had','do','does','did','done','would','could','may','might','must','shall',
  'about','after','before','over','under','again','further','once','here','there','when','where','why','how',
  'all','any','both','each','few','other','some','such','only','own','same','up','down','out','off',
  'said','says','say','new','one','two','first','last','year','years','day','people','told','according',
]);

/** Content tokens for embedding: stopwords dropped, minimum length 3. */
export function contentTokens(s: string): string[] {
  return tokenize(s).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** A short plain-text excerpt from (possibly HTML) content. */
export function makeExcerpt(text: string, maxLen = 280): string {
  const clean = normalizeWhitespace(stripHtml(text));
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1).replace(/\s+\S*$/, '') + '…';
}
