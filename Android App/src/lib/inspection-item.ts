import { effectiveResult, limitsText, parseReading, readingText, type ItemResult, type ReadingItem } from './inspection-rules';
import type { FollowUpView } from './inspection-types';

/**
 * One checklist item on the phone, as the website's `InspectionItem.tsx` works it out: a reading's
 * result as it is typed (outside its limits it fails, whatever was tapped — the server's rules), its
 * words, and the line under a failed item about its follow-up task.
 */

/** A note or reading being typed is saved this long after the last key (and at once when the box is left). */
export const DRAFT_DELAY_MS = 700;

/** The item's words, the website's. */
export const ITEM_WORDS = {
  pass: 'Pass',
  fail: 'Fail',
  na: 'N/A',
  notAnswered: 'Not answered',
  readingPlaceholder: 'Reading',
  naLabel: 'N/A: {label}',
  cantTake: 'Couldn’t take it',
  cantTakeLabel: 'Couldn’t take it (fail): {label}',
  note: 'Note',
  noteLabel: 'Note: {label}',
  addNoteLabel: 'Add a note: {label}',
  makeFollowUp: 'Make a follow-up task',
  makeFollowUpLabel: 'Make a follow-up task: {label}',
  readingNumber: 'Enter the reading as a number, like 12.5',
} as const;

/** A reading as it is being typed: the number it reads as, its result, and whether that is outside the limits. */
export function readingDraft(item: ReadingItem, text: string): { reading: string | null; result: ItemResult | null; outside: boolean } {
  const reading = text.trim() ? parseReading(text.trim()) : null;
  if (reading === null) return { reading: null, result: null, outside: false };
  const result = effectiveResult(item, { result: null, reading });
  return { reading, result, outside: result === 'FAIL' };
}

/** What is wrong with a typed reading (said when the box is left): null when it is blank or a number. */
export function readingError(text: string): string | null {
  return text.trim() && parseReading(text.trim()) === null ? ITEM_WORDS.readingNumber : null;
}

/** "Outside the allowed 0–150 psi". */
export function outsideText(item: ReadingItem): string {
  return `Outside the allowed ${limitsText(item)}`;
}

/** "Allowed 0–150 psi" ('' without limits). */
export function allowedText(item: ReadingItem): string {
  const limits = limitsText(item);
  return limits ? `Allowed ${limits}` : '';
}

/** A reading once it can't change: "162.5 psi", "Not taken (N/A)", "Couldn’t be taken (failed)" or "—". */
export function readOnlyReading(item: ReadingItem, answer: { result: ItemResult | null; reading: string | null } | undefined): string {
  if (answer?.reading) return readingText(item, answer.reading);
  if (answer?.result === 'NA') return 'Not taken (N/A)';
  if (answer?.result === 'FAIL') return 'Couldn’t be taken (failed)';
  return '—';
}

/**
 * The reading box's keyboard (Final I3): Android's decimal pad has no minus sign on many phones, so
 * a reading whose limits go below zero gets the number keyboard (it has one); else the decimal pad.
 */
export function readingKeyboard(item: ReadingItem): 'numeric' | 'decimal-pad' {
  return item.min !== null && item.min < 0 ? 'numeric' : 'decimal-pad';
}

/** What TalkBack calls the reading box: "Pressure, reading in psi". */
export function readingLabel(item: ReadingItem): string {
  return `${item.label}, reading${item.unit ? ` in ${item.unit}` : ''}`;
}

export type FollowUpLine = { kind: 'task'; text: string; taskId: string } | { kind: 'text'; text: string } | { kind: 'make' };

/** The line under a failed item: its task, where it is, or the button to make one (null: nothing). */
export function followUpLine(f: FollowUpView | undefined, o: { queued: boolean; canMake: boolean }): FollowUpLine | null {
  if (f?.task) return { kind: 'task', text: `Follow-up task: ${f.task.key}${f.task.deleted ? ' (deleted)' : f.task.done ? ' (done)' : ''}`, taskId: f.task.id };
  if (f?.moved) return { kind: 'text', text: 'Its follow-up task was moved to another project.' };
  if (o.queued) return { kind: 'text', text: 'Follow-up task saved on this phone: it’s made when you’re back online.' };
  if (f?.pending) return { kind: 'text', text: 'Its follow-up task is being made…' };
  return o.canMake ? { kind: 'make' } : null;
}
