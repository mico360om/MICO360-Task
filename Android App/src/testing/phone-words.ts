/**
 * The website's words for a mouse or a keyboard that the phone says for a finger ("click" → "tap",
 * Stage 3 Task 17; "press Enter" → "tap Add", Stage 2 final review A11): a drift test compares the
 * app's words with the website's after exactly these substitutions, and nothing else. Each names the
 * website file it comes from (its own drift test checks that file still says it). Test-only —
 * nothing in the app imports this folder.
 */
export const PHONE_WORDS: readonly (readonly [web: string, phone: string, file: string])[] = [
  // Workload's footer.
  ['Nothing changes until you click.', 'Nothing changes until you tap.', 'frontend/src/pages/WorkloadPage.tsx'],
  // New task's checklist box: the phone's box has an Add button beside it (the keyboard's key adds too).
  ['Add an item and press Enter', 'Add an item and tap Add', 'frontend/src/components/task-form/ChecklistField.tsx'],
];

/** The substitutions for one website file. */
export function phoneWordsIn(file: string): (readonly [web: string, phone: string, file: string])[] {
  return PHONE_WORDS.filter(([, , f]) => f === file);
}

/** The website's text as the phone words it: each substitution made wherever it appears. */
export function onPhone(webText: string): string {
  return PHONE_WORDS.reduce((text, [web, phone]) => text.split(web).join(phone), webText);
}
