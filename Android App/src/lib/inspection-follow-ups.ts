import type { DraftView } from './inspection-outbox';
import { displayName, type ApiMember } from './types';

/**
 * Follow-up tasks from failed inspection items, as the website's inspection page offers them: who
 * the new tasks go to (the project owner, a member, or nobody yet), which failed items still need
 * one, and the words. A request is kept on the phone and made once there's a signal.
 */

/** '~default': the project owner (the server's default) · '~nobody': no one yet · else a member's id. */
export type AssigneeChoice = '~default' | '~nobody' | string;

/** The "Give new tasks to" choices: the owner (named when on the team), every member, nobody yet. */
export function followUpChoices(members: readonly ApiMember[], owner: { id: string } | null | undefined): Array<{ value: AssigneeChoice; label: string }> {
  const ownerMember = owner ? members.find((m) => m.id === owner.id) : undefined;
  return [
    { value: '~default', label: `The project owner${ownerMember ? ` (${displayName(ownerMember)})` : ''}` },
    ...members.map((m) => ({ value: m.id, label: displayName(m) })),
    { value: '~nobody', label: 'Nobody yet' },
  ];
}

/** The request's assignee: undefined (the owner, the server decides), null (nobody) or a member. */
export function assigneeOf(choice: AssigneeChoice): string | null | undefined {
  if (choice === '~default') return undefined;
  if (choice === '~nobody') return null;
  return choice;
}

/** The failed items with no task yet: none made, none asked for on this phone, none being made. */
export function failedWithout(view: Pick<DraftView, 'snapshot' | 'followUpsWaiting'>, failedIds: string[]): string[] {
  const made = new Map((view.snapshot.followUps ?? []).map((f) => [f.itemId, f]));
  const waiting = new Set(view.followUpsWaiting);
  return failedIds.filter((itemId) => !made.get(itemId)?.task && !waiting.has(itemId) && !made.get(itemId)?.pending);
}

/** The "all" button: how many it makes, or that every failed item has one. */
export function allButton(n: number): { label: string; disabled: boolean } {
  return n > 0 ? { label: `Create tasks for all failed items (${n})`, disabled: false } : { label: 'Every failed item has a task', disabled: true };
}

/** The card's words, the website's. */
export const FOLLOW_UP_WORDS = {
  heading: 'Failed items ({n})',
  intro: 'Each failed item can become a task in this project, linked back to this inspection.',
  giveTo: 'Give new tasks to',
  makeOne: 'Make a follow-up task',
  makeOneLabel: 'Make a follow-up task: {label}',
  failed: 'The follow-up tasks couldn’t be saved. Please try again.',
} as const;
