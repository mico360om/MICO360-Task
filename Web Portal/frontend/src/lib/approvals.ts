/**
 * Task approvals (the server decides; these are its words on the web). A task can "need approval":
 * the person who runs its project (or an administrator) must approve it before it counts as done.
 * Finished by anyone else, it waits — in its project's Review column, or where it was — until it is
 * approved (then it is done) or sent back with a reason (then it is in progress again).
 */

/** The tick's one-line hint (task form and task panel). */
export const APPROVAL_HINT = 'A project manager must approve it before it counts as done.';

/**
 * Why the tick can't be taken off: turning "Needs approval" off is only for the project's managers and
 * administrators (owner, 30 Oct — the server refuses anyone else), so for everyone else a tick that is
 * on stays on.
 */
export const APPROVAL_LOCKED = 'Only the project’s managers can turn this off.';

/**
 * Approve and Send back, in the same words wherever they are offered: the task panel, the To approve
 * list, the Send back dialog — and the Chrome extension, which keeps a copy (Extension/src/approvals.js,
 * kept in step by its drift test).
 */
export const DECISION_WORDS = {
  waiting: 'Waiting for approval',
  approve: 'Approve',
  sendBack: 'Send back',
  cancel: 'Cancel',
  reasonLabel: 'Why are you sending it back?',
  reasonPlaceholder: 'For example: the pressure readings are missing.',
  reasonMissing: 'Write a reason first.',
} as const;
/** The longest reason the server keeps (it becomes a comment). */
export const REASON_MAX = 2000;
/** A button's name when several tasks are listed: "Approve RIG-4", "Send RIG-4 back". */
export const approveLabel = (key: string) => `Approve ${key}`;
export const sendBackLabel = (key: string) => `Send ${key} back`;
/** The Send back dialog's title and note. */
export const sendBackTitle = (key: string) => `Send ${key} back?`;
export const sendBackNote = (title: string) => `${title} goes back to In progress. Your reason is added as a comment and sent to the people on it.`;
/** What is said once it is done. */
export const approvedNotice = (key: string) => `Approved ${key}.`;
export const sentBackNotice = (key: string) => `Sent ${key} back.`;

/** True while the task waits for approval (it is not done yet). */
export function isWaitingForApproval(t: { approvalRequestedAt?: string | null } | null | undefined): boolean {
  return Boolean(t?.approvalRequestedAt);
}

/** "Waiting for Omar Ahmed’s approval", or "a project manager’s" when several people (or nobody named) run the project. */
export function waitingForText(approverName: string | null | undefined): string {
  const name = approverName?.trim();
  return `Waiting for ${name ? `${name}’s` : 'a project manager’s'} approval`;
}

/**
 * After a move asked for `askedColumnId`: what to tell the person when the task went to wait for
 * approval instead (it needs a project manager's OK) — null when it went where it was asked.
 */
export function approvalNotice(askedColumnId: string, after: { key: string; columnId: string; approvalRequestedAt?: string | null } | null | undefined): string | null {
  if (!after || !isWaitingForApproval(after) || after.columnId === askedColumnId) return null;
  return `${after.key} needs approval, so it’s waiting for a project manager.`;
}
