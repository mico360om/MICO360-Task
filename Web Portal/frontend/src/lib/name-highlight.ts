/** A piece of text, and whether it is one of the names looked for. */
export interface NamePiece {
  text: string;
  name: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Splits text into plain pieces and the names found in it: whole names only (never part of a longer
 * word), in any case, the longest first ("Sara Ahmed" before "Sara"). Arabic names are found too.
 * Used to show staff which names the client would see in approved minutes.
 */
export function highlightNames(text: string, names: string[]): NamePiece[] {
  if (!text) return [];
  const list = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (list.length === 0) return [{ text, name: false }];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const pieces: NamePiece[] = [];
  let at = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > at) pieces.push({ text: text.slice(at, m.index), name: false });
    pieces.push({ text: m[0], name: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) pieces.push({ text: text.slice(at), name: false });
  return pieces;
}
