/**
 * Task approvals (the server decides; these are the web's words — a copy of Web Portal/frontend/src/lib/
 * approvals.ts, kept in step by src/approvals.test.js). A task can "need approval": finished by someone
 * who can't approve it, the server puts it to wait (in its project's Review column, or where it was)
 * instead of making it done, and answers the move with the task where it waits.
 */

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
