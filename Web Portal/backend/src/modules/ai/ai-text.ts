/**
 * Text as an AI provider may be sent it. A JavaScript string is UTF-16: an emoji (and other characters
 * beyond the first 65,536) is a pair of halves, and a string cut between them ends on half a character.
 * JSON.stringify writes such a half as "\ud83d", which a strict JSON reader — MICO360 AI's (.NET) among
 * them — refuses: the whole request is turned down (400), and a sweep that sends the same text again
 * every minute never gets past it.
 */

/** At most `max` characters, never ending on the first half of a pair. */
export function cutChars(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = max > 0 && /[\uD800-\uDBFF]/.test(text[max - 1]!) ? max - 1 : max;
  return text.slice(0, Math.max(0, end));
}

/** Any half of a pair standing alone (from an earlier cut, or stored so) becomes "�". */
export function wellFormed(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
}
