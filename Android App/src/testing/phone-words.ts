/**
 * The website's words as the phone says them. Where a website sentence names a mouse or a keyboard
 * ("click" → "tap", Stage 3 Task 17; "press Enter" → "tap Add", Stage 2 final review A11) or a page
 * reload ("even if the app closes", Stage 4 lead amendment 2), the app says its phone equivalent.
 * These are the ONLY changes a word drift test allows; every other word is the website's, letter for
 * letter. Each names the website file it comes from (its own drift test checks that file still says
 * it). Test-only — nothing in the app imports this folder.
 */
import { normalise } from './web-source';

/** Website words → phone words for a mouse or a keyboard. */
export const PHONE_WORDS: readonly (readonly [web: string, phone: string, file: string])[] = [
  // Workload's footer.
  ['Nothing changes until you click.', 'Nothing changes until you tap.', 'frontend/src/pages/WorkloadPage.tsx'],
  // New task's checklist box: the phone's box has an Add button beside it (the keyboard's key adds too).
  ['Add an item and press Enter', 'Add an item and tap Add', 'frontend/src/components/task-form/ChecklistField.tsx'],
];

/** Website words → phone words for a page reload or a mouse in an inspection (Stage 4, lead amendment 2). */
export const DEVICE_WORDS: readonly (readonly [web: string, phone: string, file: string])[] = [
  ['even if the page reloads', 'even if the app closes', 'frontend/src/pages/InspectionPage.tsx'],
  ['Draw with your finger or mouse.', 'Draw with your finger.', 'frontend/src/components/inspections/SignaturePad.tsx'],
  // The sync banner (Final I10): the changes are in the app, kept while it is open; a record too big
  // for the phone to keep is told apart from the phone's storage being full.
  ['only in this page', 'only in the app', 'frontend/src/components/inspections/SyncBanner.tsx'],
  ['Keep it open until', 'Keep the app open until', 'frontend/src/components/inspections/SyncBanner.tsx'],
  ['will send when online', 'will send when you’re back online with the app open', 'frontend/src/components/inspections/SyncBanner.tsx'],
  ['This phone’s storage is full, so', 'This inspection is too big to keep on the phone, so', 'frontend/src/components/inspections/SyncBanner.tsx'],
  ['This phone’s storage is full:', 'This inspection is too big to keep on the phone:', 'frontend/src/components/inspections/SyncBanner.tsx'],
];

const ALL_WORDS = [...PHONE_WORDS, ...DEVICE_WORDS];

/** The substitutions for one website file. */
export function phoneWordsIn(file: string): (readonly [web: string, phone: string, file: string])[] {
  return ALL_WORDS.filter(([, , f]) => f === file);
}

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
