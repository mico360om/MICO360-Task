/**
 * The website's words for a mouse that the phone says for a finger ("click" → "tap", Stage 3 Task
 * 17): a drift test compares the app's words with the website's after exactly these substitutions,
 * and nothing else. Test-only — nothing in the app imports this folder.
 */
export const PHONE_WORDS: readonly (readonly [web: string, phone: string])[] = [
  // Workload's footer (WorkloadPage.tsx).
  ['Nothing changes until you click.', 'Nothing changes until you tap.'],
];

/** The website's text as the phone words it: each substitution made wherever it appears. */
export function onPhone(webText: string): string {
  return PHONE_WORDS.reduce((text, [web, phone]) => text.split(web).join(phone), webText);
}
