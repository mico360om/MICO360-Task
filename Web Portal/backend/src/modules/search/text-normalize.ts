/**
 * One normaliser for every keyword match (global search, the task keyword filter), so Arabic
 * spelling variants match: hamza/madda alef forms → ا, ة → ه, ى/ئ/ی → ي, ؤ → و, ک → ك, and
 * diacritics (tashkeel) plus tatweel are dropped. Latin text is only case-folded, so a database
 * LIKE on the raw column stays a superset of what this matches.
 */

// Tashkeel + Quranic marks + superscript alef, and tatweel (ـ).
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ]/g;
const LETTER_VARIANTS: Record<string, string> = {
  'أ': 'ا', // أ
  'إ': 'ا', // إ
  'آ': 'ا', // آ
  'ٱ': 'ا', // ٱ
  'ة': 'ه', // ة → ه
  'ى': 'ي', // ى → ي
  'ئ': 'ي', // ئ → ي
  'ی': 'ي', // Persian ی → ي
  'ؤ': 'و', // ؤ → و
  'ک': 'ك', // Persian ک → ك
};
const VARIANT_RE = new RegExp(`[${Object.keys(LETTER_VARIANTS).join('')}]`, 'g');

/** Normalised form used on both sides of a keyword match. */
export function normalizeForSearch(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .normalize('NFKC')
    .replace(ARABIC_MARKS, '')
    .replace(VARIANT_RE, (c) => LETTER_VARIANTS[c] ?? c)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `normalizedQuery` (already normalised) occurs in any of the given texts. */
export function matchesNormalized(normalizedQuery: string, ...texts: (string | null | undefined)[]): boolean {
  if (!normalizedQuery) return true;
  return texts.some((t) => normalizeForSearch(t).includes(normalizedQuery));
}

const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿ]/;
// Letters a normalised query can contain that come from several raw spellings (the targets above).
const VARIANT_TARGETS = new Set(['ا', 'ه', 'ي', 'و', 'ك']);

/**
 * Substrings every raw text must contain to possibly match `query` after normalisation — a
 * database pre-filter (LIKE) that is always a superset of the real match. Latin runs are kept
 * whole; Arabic runs contribute only their letters that have no spelling variants (diacritics
 * can sit between letters in the raw text, so Arabic runs can't be matched as one substring).
 */
export function prefilterTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const token of normalizeForSearch(query).split(' ')) {
    if (!token) continue;
    for (const run of token.match(/[؀-ۿݐ-ݿࢠ-ࣿ]+|[^؀-ۿݐ-ݿࢠ-ࣿ]+/g) ?? []) {
      if (!ARABIC_LETTER.test(run)) {
        terms.add(run);
        continue;
      }
      for (const ch of run) if (!VARIANT_TARGETS.has(ch)) terms.add(ch);
    }
  }
  return [...terms];
}
