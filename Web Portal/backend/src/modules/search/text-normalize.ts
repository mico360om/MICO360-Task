/**
 * One normaliser for every keyword match (global search, the task keyword filter), so Arabic
 * spelling variants match: hamza/madda alef forms → ا, ة → ه, ى/ئ/ی → ي, ؤ → و, ک → ك, and
 * diacritics (tashkeel) plus tatweel are dropped. Latin text is only case-folded.
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

/**
 * The letter folding of normalizeForSearch without its space handling (compatibility forms, Arabic
 * diacritics and letter variants, case) — for a piece of a longer text, so a search can map what it
 * matched back onto the text as shown (task-search-text).
 */
export function foldText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(ARABIC_MARKS, '')
    .replace(VARIANT_RE, (c) => LETTER_VARIANTS[c] ?? c)
    .toLowerCase();
}

/** Normalised form used on both sides of a keyword match. */
export function normalizeForSearch(text: string | null | undefined): string {
  if (!text) return '';
  return foldText(text).replace(/\s+/g, ' ').trim();
}

/** True when `normalizedQuery` (already normalised) occurs in any of the given texts. */
export function matchesNormalized(normalizedQuery: string, ...texts: (string | null | undefined)[]): boolean {
  if (!normalizedQuery) return true;
  return texts.some((t) => normalizeForSearch(t).includes(normalizedQuery));
}
