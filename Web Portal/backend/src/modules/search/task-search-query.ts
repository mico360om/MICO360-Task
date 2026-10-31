import { normalizeForSearch } from './text-normalize';

/** At most this many words (or phrases) are looked for; the rest of a long query is ignored. */
export const MAX_TERMS = 10;

/** Straight and curly quotes (phones type “ ”), and the « » Arabic keyboards offer. */
const OPEN_CLOSE: Record<string, string> = { '"': '"', '“': '”', '”': '”', '„': '“', '«': '»' };
const QUOTES = /["“”„«»]/g;

export interface TaskQuery {
  /**
   * What must ALL appear somewhere in a task (any of its fields), normalised as the index is
   * (text-normalize): single words, or a "quoted phrase" kept whole. Each one matches a part of a
   * word too ("scaff" finds "scaffold").
   */
  terms: string[];
  /** The whole query normalised (quotes left out), for an exact task key ("RIG-4"). */
  whole: string;
}

/**
 * Reads a task search: words split on spaces, a "quoted phrase" kept as one exact phrase (an
 * unclosed quote is still being typed, so its words count one by one), every term normalised the
 * way the index stores text — case, Arabic letter forms (أ إ آ → ا, ة → ه, ى → ي) and diacritics —
 * repeats dropped, at most MAX_TERMS.
 */
export function parseTaskQuery(query: string): TaskQuery {
  const text = String(query ?? '');
  const raw: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const close = OPEN_CLOSE[ch];
    if (close) {
      const end = findClose(text, i + 1, close);
      if (end > 0) {
        raw.push(text.slice(i + 1, end));
        i = end + 1;
        continue;
      }
      // Unclosed: the rest is plain words.
      raw.push(...text.slice(i + 1).split(/\s+/));
      break;
    }
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < text.length && !/\s/.test(text[j]!) && !OPEN_CLOSE[text[j]!]) j += 1;
    raw.push(text.slice(i, j));
    i = j;
  }
  const terms: string[] = [];
  for (const r of raw) {
    const t = normalizeForSearch(r.replace(QUOTES, ' '));
    if (t && !terms.includes(t)) terms.push(t);
    if (terms.length >= MAX_TERMS) break;
  }
  return { terms, whole: normalizeForSearch(text.replace(QUOTES, ' ')) };
}

/** Where the quote opened just before `from` closes (a curly one may close with either curly quote). */
function findClose(text: string, from: number, close: string): number {
  for (let k = from; k < text.length; k++) {
    const c = text[k]!;
    if (c === close || (close === '”' && c === '“') || (close === '“' && c === '”')) return k;
  }
  return -1;
}

/** The escape character of the search's LIKE patterns (`ESCAPE '!'`): not a backslash, so no SQL mode changes it. */
export const LIKE_ESCAPE = '!';

/** A value for `LIKE … ESCAPE '!'`: the wildcards and the escape character matched as themselves. */
export function escapeLike(text: string): string {
  return text.replace(/[!%_]/g, (c) => `${LIKE_ESCAPE}${c}`);
}
