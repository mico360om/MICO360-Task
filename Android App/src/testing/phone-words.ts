/**
 * The website's words as the phone says them. Where a website sentence names a mouse ("click") or a
 * page reload, the app says its phone equivalent ("tap", "even if the app closes" — Stage 3 Task 17,
 * Stage 4 lead amendment 2). These are the ONLY changes a word drift test allows; every other word
 * is the website's, letter for letter. Test-only — nothing in the app imports this folder.
 */
import { normalise } from './web-source';

/** Website words → phone words for a mouse ("click" → "tap", Stage 3 Task 17). */
export const PHONE_WORDS: readonly (readonly [web: string, phone: string])[] = [
  // Workload's footer (WorkloadPage.tsx).
  ['Nothing changes until you click.', 'Nothing changes until you tap.'],
];

/** Website words → phone words for a page reload or a mouse in an inspection (Stage 4, lead amendment 2). */
export const DEVICE_WORDS: readonly (readonly [web: string, phone: string])[] = [
  ['even if the page reloads', 'even if the app closes'],
  ['Draw with your finger or mouse.', 'Draw with your finger.'],
];

const ALL_WORDS = [...PHONE_WORDS, ...DEVICE_WORDS];

/** The website's text as the phone words it: each substitution made wherever it appears. */
export function onPhone(webText: string): string {
  return ALL_WORDS.reduce((text, [web, phone]) => text.split(web).join(phone), webText);
}

/** An app word as the website writes it (each phone wording put back). */
export function asWebsiteWords(word: string): string {
  return ALL_WORDS.reduce((w, [web, phone]) => w.split(phone).join(web), word);
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
