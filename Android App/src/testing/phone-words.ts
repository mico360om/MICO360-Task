/**
 * The website's words as the app says them (Stage 4, lead amendment 2): where a website sentence
 * names a mouse or a page reload, the phone says its own equivalent. These are the ONLY changes a
 * word drift test allows; every other word is the website's, letter for letter. Test-only.
 */
import { normalise } from './web-source';

/** Phone words → the website's words they stand for. */
export const PHONE_WORDS: ReadonlyArray<{ phone: string; web: string }> = [
  { phone: 'even if the app closes', web: 'even if the page reloads' },
  { phone: 'Draw with your finger.', web: 'Draw with your finger or mouse.' },
];

/** An app word as the website writes it (each phone wording put back). */
export function asWebsiteWords(word: string): string {
  return PHONE_WORDS.reduce((w, { phone, web }) => w.split(phone).join(web), word);
}

/** The website's source as plain text: JSX tags (`<bdi>`, `<span …>`) out, spaces and line breaks as one space. */
function plainSource(source: string): string {
  return normalise(source)
    .replace(/<\/?[a-zA-Z][^<>{}]*>/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Whether the website's files say this app word: each part of it between `{placeholders}` (the
 * phone wording put back) is in the website's text, in any of the files.
 */
export function websiteSays(sources: string | string[], word: string): boolean {
  const text = plainSource(Array.isArray(sources) ? sources.join('\n') : sources);
  return asWebsiteWords(word)
    .split(/\{[^}]*\}/)
    .map((part) => part.replace(/\s+/g, ' '))
    .filter((part) => part.trim() !== '')
    .every((part) => text.includes(part));
}
