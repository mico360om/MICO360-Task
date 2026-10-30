/**
 * Task approvals (the server decides; these are the web's words — a copy of Web Portal/frontend/src/lib/
 * approvals.ts, kept in step by src/approvals.test.js). A task can "need approval": finished by someone
 * who can't approve it, the server puts it to wait (in its project's Review column, or where it was)
 * instead of making it done, and answers the move with the task where it waits. Someone who can approve
 * it (whoever runs its project, or an administrator) can Approve it or Send it back with a reason —
 * in the same words as the website.
 */

/** Approve and Send back, in the website's words (lib/approvals.ts DECISION_WORDS). */
export const DECISION_WORDS = {
  waiting: 'Waiting for approval',
  approve: 'Approve',
  sendBack: 'Send back',
  cancel: 'Cancel',
  reasonLabel: 'Why are you sending it back?',
  reasonPlaceholder: 'For example: the pressure readings are missing.',
  reasonMissing: 'Write a reason first.',
};
/** The longest reason the server keeps (it becomes a comment). */
export const REASON_MAX = 2000;
/** A button's name when several tasks are listed: "Approve RIG-4", "Send RIG-4 back". */
export const approveLabel = (key) => `Approve ${key}`;
export const sendBackLabel = (key) => `Send ${key} back`;
/** The Send back dialog's title and note. */
export const sendBackTitle = (key) => `Send ${key} back?`;
export const sendBackNote = (title) => `${title} goes back to In progress. Your reason is added as a comment and sent to the people on it.`;
/** What is said once it is done. */
export const approvedNotice = (key) => `Approved ${key}.`;
export const sentBackNotice = (key) => `Sent ${key} back.`;

/** True while the task waits for approval (it is not done yet). */
export function isWaitingForApproval(t) {
  return Boolean(t && t.approvalRequestedAt);
}

/**
 * After a move asked for `askedColumnId`: what to tell the person when the task went to wait for
 * approval instead (it needs a project manager's OK) — null when it went where it was asked.
 */
export function approvalNotice(askedColumnId, after) {
  if (!after || !isWaitingForApproval(after) || after.columnId === askedColumnId) return null;
  return `${after.key} needs approval, so it’s waiting for a project manager.`;
}
