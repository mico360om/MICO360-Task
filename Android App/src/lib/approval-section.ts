/**
 * A task's Approval section (the website's components/approvals/TaskApproval.tsx): what it shows the
 * signed-in person — who finished it and Approve / Send back for those who run its project, whose
 * approval it waits for for everyone else, who approved it once it is done — and the "Needs approval"
 * switch, which anyone may turn on and only the project's managers (and administrators) may turn off.
 * The server decides all of it; these are its rules and the website's words. Pure.
 */
import { APPROVAL_HINT, APPROVAL_LOCKED, DECISION_WORDS, REASON_MAX, isWaitingForApproval, waitingForText } from './approvals';
import { relativeTime } from './relative-time';
import type { ApiTask } from './types';

/** The section's words, as the website's TaskApproval.tsx writes them. */
export const APPROVAL_SECTION_TEXT = {
  title: 'Approval',
  tick: 'Needs approval',
  offTitle: 'Turn off approval?',
  offBody: 'It is waiting for approval. Turning approval off marks it done now.',
  offConfirm: 'Turn off and mark done',
  offKeep: 'Keep waiting',
  setFailed: 'Couldn’t change it. Please try again.',
  approveFailed: 'Couldn’t approve it. Please try again.',
  sendBackFailed: 'Couldn’t send it back. Please try again.',
} as const;

/** The server's words for a reason over its limit (task-service.ts APPROVAL_WORDS.longReason). */
export const SEND_BACK_TOO_LONG = `Keep the reason under ${REASON_MAX} characters.`;

/** A Send back reason, as it will be sent (trimmed), or why it can't be sent yet. */
export function sendBackCheck(reason: string): { ok: true; reason: string } | { ok: false; message: string } {
  const text = reason.trim();
  if (!text) return { ok: false, message: DECISION_WORDS.reasonMissing };
  if (text.length > REASON_MAX) return { ok: false, message: SEND_BACK_TOO_LONG };
  return { ok: true, reason: text };
}

export interface ApprovalView {
  /** It waits for approval (finished, not done yet). */
  waiting: boolean;
  /** "Finished by Sara Ali · 2h ago" while it waits (null when the server doesn't name them). */
  finishedLine: string | null;
  /** The signed-in person may Approve it or Send it back (they run its project, or are an administrator). */
  decide: boolean;
  /** "Waiting for Aisha Khan’s approval" while it waits, for everyone who can't decide. */
  waitingFor: string | null;
  /** "Approved by Aisha Khan · 1d ago" once it is done (null otherwise). */
  approvedLine: string | null;
  tick: {
    on: boolean;
    /** On, for someone who doesn't run the project: it stays on (the server refuses to turn it off). */
    locked: boolean;
    lockNote: string | null;
    hint: string;
  };
}

type ApprovalFields = Pick<ApiTask, 'needsApproval' | 'approvalRequestedAt' | 'approvedAt' | 'completedAt' | 'columnCategory' | 'approval'>;

/** The Approval section as the signed-in person sees it (`now` and `timeZone` for "2h ago"). */
export function approvalView(task: Partial<ApprovalFields>, now: number, timeZone: string): ApprovalView {
  const waiting = isWaitingForApproval(task);
  const info = task.approval;
  const decide = waiting && info?.canApprove === true;
  const when = (iso: string | null | undefined) => (iso ? ` · ${relativeTime(iso, now, timeZone)}` : '');
  const on = !!task.needsApproval;
  const locked = on && info?.canApprove !== true;
  return {
    waiting,
    finishedLine: waiting && info?.requestedBy ? `Finished by ${info.requestedBy.name}${when(task.approvalRequestedAt)}` : null,
    decide,
    waitingFor: waiting && !decide ? waitingForText(info?.approverName ?? null) : null,
    // As the website's: once it is done (completed) and the server names who approved it.
    approvedLine: !waiting && task.completedAt && info?.approvedBy ? `Approved by ${info.approvedBy.name}${when(task.approvedAt)}` : null,
    tick: { on, locked, lockNote: locked ? APPROVAL_LOCKED : null, hint: APPROVAL_HINT },
  };
}
