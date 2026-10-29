/**
 * Task approvals: some tasks need the OK of whoever runs their project (admins, its owner, its named
 * manager, MANAGER members — `canManageProject`) before they count as done.
 *
 * A task that needs approval and is finished by someone who can't approve WAITS instead: it goes to
 * its project's first Review column (else stays where it is) with `approvalRequestedAt` set — never
 * in a Done column and never with `completedAt`, so every count, report, email, calendar and client
 * page already treats it as not done. An approver approves it (it then completes) or sends it back.
 * Every path that changes a task's column comes through `approvalOnEntry`.
 */

/** The approval fields a task carries (all optional in a patch). */
export interface ApprovalFields {
  needsApproval?: boolean;
  /** Set while it waits for approval. */
  approvalRequestedAt?: Date | null;
  /** Who finished it (asked for approval). */
  approvalRequestedById?: string | null;
  /** Its last approval; cleared when it is re-opened. */
  approvedAt?: Date | null;
  approvedById?: string | null;
}

/**
 * What happened about approval, for the task's history and notices:
 * REQUESTED (finished by someone who can't approve: waiting), APPROVED (a waiting task approved),
 * APPROVED_ON_FINISH (an approver finished it: done at once), WITHDRAWN (a waiting task moved back by
 * hand), SENT_BACK (an approver sent it back with a reason), SWITCHED_OFF (an approver turned
 * approval off while it waited: it completes normally).
 */
export type ApprovalEvent = 'REQUESTED' | 'APPROVED' | 'APPROVED_ON_FINISH' | 'WITHDRAWN' | 'SENT_BACK' | 'SWITCHED_OFF';

/** The column categories a waiting task goes to, in order of preference. */
export const WAIT_CATEGORIES = ['REVIEW'];
/** Where a task sent back goes: the first of these the project has. */
export const SEND_BACK_CATEGORIES = ['IN_PROGRESS', 'TODO', 'BACKLOG'];
/** The longest reason for sending a task back (it becomes a comment). */
export const SEND_BACK_REASON_MAX = 2000;

/** True while the task waits for approval. */
export function isAwaitingApproval(t: { approvalRequestedAt?: Date | string | null }): boolean {
  return t.approvalRequestedAt !== null && t.approvalRequestedAt !== undefined;
}

export interface ApprovalTask {
  columnId: string;
  columnCategory?: string | null;
  completedAt: Date | null;
  needsApproval?: boolean;
  approvalRequestedAt?: Date | string | null;
  approvedAt?: Date | string | null;
}

export interface EntryDecision {
  /** The column the task really goes to: the one asked for, or where it waits. */
  columnId: string;
  /** That column's category: completion follows it. */
  category: string;
  /** Approval fields to write with the move. */
  patch: ApprovalFields;
  event: ApprovalEvent | null;
  /** It already waits and someone who can't approve finished it again: nothing at all changes. */
  unchanged: boolean;
}

const CLEAR_REQUEST = { approvalRequestedAt: null, approvalRequestedById: null } as const;

/**
 * What entering `target` does about approval (the completion itself follows the returned category):
 * - into Done, not ticked: completes as usual;
 * - into Done, ticked, by an approver: completes, approved by them (APPROVED for a waiting task,
 *   APPROVED_ON_FINISH otherwise) — no self-approval round trip;
 * - into Done, ticked, by anyone else (or no one named): waits in `waitColumn` (else where it is),
 *   REQUESTED — or, when it already waits, nothing changes;
 * - into another open column from where it waits: the request is withdrawn (WITHDRAWN);
 * - out of Done: its approval is cleared, so it must be approved again when finished again.
 */
export function approvalOnEntry(
  task: ApprovalTask,
  target: { columnId: string; category: string },
  ctx: { canApprove: boolean; actorId?: string | null; at: Date; waitColumn: { id: string; category: string } | null },
): EntryDecision {
  const waiting = isAwaitingApproval(task);
  const go = (patch: ApprovalFields = {}, event: ApprovalEvent | null = null): EntryDecision => ({ columnId: target.columnId, category: target.category, patch, event, unchanged: false });

  if (target.category === 'DONE') {
    if (task.completedAt) return go();
    if (!task.needsApproval) return go(waiting ? { ...CLEAR_REQUEST } : {});
    if (ctx.canApprove && ctx.actorId) {
      return go({ approvedAt: ctx.at, approvedById: ctx.actorId, ...CLEAR_REQUEST }, waiting ? 'APPROVED' : 'APPROVED_ON_FINISH');
    }
    const here = { id: task.columnId, category: task.columnCategory ?? 'TODO' };
    if (waiting) return { columnId: here.id, category: here.category, patch: {}, event: null, unchanged: true };
    const wait = ctx.waitColumn ?? here;
    return { columnId: wait.id, category: wait.category, patch: { approvalRequestedAt: ctx.at, approvalRequestedById: ctx.actorId ?? null }, event: 'REQUESTED', unchanged: false };
  }

  const patch: ApprovalFields = {};
  if (task.completedAt && task.approvedAt) Object.assign(patch, { approvedAt: null, approvedById: null });
  if (waiting && target.columnId !== task.columnId) return go({ ...patch, ...CLEAR_REQUEST }, 'WITHDRAWN');
  return go(patch);
}
