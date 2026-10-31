/**
 * A new task's checklist while it is being written (the website's task-form/ChecklistField.tsx
 * helpers, the same rules — lib/checklist-draft.test.ts runs both on the same lists): its rows, each
 * with its own stable key (never sent), and the items as they are saved. Pure.
 */

/** The server keeps up to 191 characters per checklist item, and up to 100 items. */
export const CHECKLIST_ITEM_MAX = 191;
export const CHECKLIST_MAX = 100;

/** One checklist item being written. `id` is the row's own (stable) key, never sent anywhere. */
export interface ChecklistRow {
  id: string;
  text: string;
}

let rowSeq = 0;
export const newChecklistRow = (text: string): ChecklistRow => ({ id: `cl-${++rowSeq}`, text });
/** Rows for a list of item texts (a template's checklist). */
export const checklistRows = (texts: string[]): ChecklistRow[] => texts.map(newChecklistRow);

/** The items in some typed text: one per line, trimmed, empty lines left out. */
const linesOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim().slice(0, CHECKLIST_ITEM_MAX))
    .filter(Boolean);

/**
 * The checklist as it is saved: its items' text, then whatever was typed in "Add an item" and not
 * added yet — so tapping Create task never loses it.
 */
export function checklistTexts(rows: ChecklistRow[], pending = ''): string[] {
  return [...rows.map((r) => r.text.trim()).filter(Boolean), ...linesOf(pending)].slice(0, CHECKLIST_MAX);
}

/** The field's words (the website's ChecklistField and TaskFormDialog). */
export const CHECKLIST_TEXT = {
  label: 'Checklist',
  addLabel: 'Add a checklist item',
  placeholder: 'Add an item and press Enter',
  full: `A checklist holds up to ${CHECKLIST_MAX} items`,
  add: 'Add',
} as const;

/** "Checklist item 3": an item's box, to TalkBack. */
export const checklistItemLabel = (n: number): string => `Checklist item ${n}`;

/** "Remove “Pump check” from the checklist" (an empty item: "Remove “item 3” …"). */
export const checklistRemoveLabel = (text: string, n: number): string => `Remove “${text || `item ${n}`}” from the checklist`;
