import { isNameCharFallback } from './mentions';

/**
 * The website's `lib/name-highlight.ts` without Unicode property escapes (Hermes on React Native
 * 0.74 has none): the same pieces for the same text and names.
 */

/** A piece of text, and whether it is one of the names looked for. */
export interface NamePiece {
  text: string;
  name: boolean;
}

/**
 * Splits text into plain pieces and the names found in it: whole names only (never part of a longer
 * word — the characters on both sides are not letters or digits), in any case, the longest first
 * ("Sara Ahmed" before "Sara"). Arabic names are found too. Shows staff which names the client
 * would see.
 */
export function highlightNames(text: string, names: string[]): NamePiece[] {
  if (!text) return [];
  const list = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (list.length === 0) return [{ text, name: false }];
  const lower = list.map((n) => n.toLowerCase());
  const nameCharAt = (i: number) => i >= 0 && i < text.length && isNameCharFallback(text.charAt(i));
  const pieces: NamePiece[] = [];
  let at = 0;
  let i = 0;
  while (i < text.length) {
    let found = 0;
    if (!nameCharAt(i - 1)) {
      for (let n = 0; n < list.length; n += 1) {
        const len = list[n]!.length;
        if (text.slice(i, i + len).toLowerCase() === lower[n] && !nameCharAt(i + len)) {
          found = len;
          break;
        }
      }
    }
    if (found === 0) {
      i += 1;
      continue;
    }
    if (i > at) pieces.push({ text: text.slice(at, i), name: false });
    pieces.push({ text: text.slice(i, i + found), name: true });
    i += found;
    at = i;
  }
  if (at < text.length) pieces.push({ text: text.slice(at), name: false });
  return pieces;
}
