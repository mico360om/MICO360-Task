/**
 * Task approvals (the server decides; these are its words on the web). A task can "need approval":
 * the person who runs its project (or an administrator) must approve it before it counts as done.
 * Finished by anyone else, it waits — in its project's Review column, or where it was — until it is
 * approved (then it is done) or sent back with a reason (then it is in progress again).
 */

/** The tick's one-line hint (task form and task panel). */
export const APPROVAL_HINT = 'A project manager must approve it before it counts as done.';

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
