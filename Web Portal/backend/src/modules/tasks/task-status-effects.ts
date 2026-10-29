import { taskNoticeBody } from '../notifications/task-notice';
import type { TaskRecord } from './task-repository';
import type { ApprovalEvent } from './task-approval';

export interface StatusEffectsDeps {
  /** A column's name and stage, or null when it is gone. */
  column: (columnId: string) => Promise<{ name: string; category: string } | null>;
  /** Make the next copy of a repeating task that was just completed (null: none is due). */
  nextCopy: (task: TaskRecord) => Promise<{ id: string } | null>;
  /** Show a new copy on open boards. */
  announceCopy: (copyId: string, projectId: string) => Promise<void>;
  /** Meeting action items tracked as the task follow it into (and out of) Done. */
  followActionItems: (taskId: string, done: boolean) => Promise<void>;
  /** Who hears about the task (its assignees and watchers who can open it), never `actorId`. */
  recipients: (taskId: string, actorId?: string) => Promise<string[]>;
  /** Who is told a task waits for approval: the people who run its project (else the admins), never `actorId`. */
  approvers?: (task: TaskRecord, actorId?: string) => Promise<string[]>;
  /** Who is told it was approved or sent back: its assignees and whoever finished it, never `actorId`. */
  approvalAudience?: (task: TaskRecord, actorId?: string, requestedById?: string | null) => Promise<string[]>;
  /** The reason a task was sent back, as the approver's comment on it. */
  sentBackComment?: (task: TaskRecord, actorId: string, reason: string) => Promise<unknown>;
  /** A next copy made when approval was turned off on a waiting task: it still needs approval (that was for this one only). */
  keepApprovalOnCopy?: (copyId: string) => Promise<unknown>;
  notify: (n: { userId: string; type: string; title: string; body: string | null; entityType: string; entityId: string }) => Promise<unknown>;
  /** Write a line to the task's timeline. */
  record: (entry: { taskId: string; projectId: string; userId: string; action: string; meta: Record<string, unknown> }) => Promise<unknown>;
  /** A step that failed after the task changed (logged; the change stands). */
  onError?: (err: unknown, taskId: string) => void;
}

export interface StatusChangeOptions {
  /** False: no notices (a move to another project sends its own single notice). */
  notify?: boolean;
  /** An approval step that came with (or without) the column change (task-approval). */
  approval?: ApprovalEvent;
  /** SENT_BACK: why. */
  reason?: string;
  /** APPROVED / SENT_BACK: who finished it (asked for approval) — told too. */
  requestedById?: string | null;
}

/** The notice type of every approval step (one row in Settings → notifications). */
export const APPROVAL_NOTICE = 'TASK_APPROVAL';
const TITLE_MAX = 140;
const cut = (s: string) => (s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 1).trimEnd()}…` : s);

/** The timeline line of a status change: its action, and what it adds to the columns it went between. */
function lineOf(approval: ApprovalEvent | undefined, done: boolean, wasDone: boolean, reason?: string): { action: string; meta: Record<string, unknown> } {
  switch (approval) {
    case 'REQUESTED':
      return { action: 'APPROVAL_REQUESTED', meta: {} };
    case 'APPROVED':
      return { action: 'APPROVED', meta: {} };
    case 'APPROVED_ON_FINISH':
      return { action: 'COMPLETED', meta: { approved: true } };
    case 'WITHDRAWN':
      return { action: 'APPROVAL_WITHDRAWN', meta: {} };
    case 'SENT_BACK':
      return { action: 'SENT_BACK', meta: { reason: reason ?? '' } };
    default:
      return { action: done ? 'COMPLETED' : wasDone ? 'REOPENED' : 'MOVED', meta: {} };
  }
}

/**
 * What a task changing column does, wherever it changes: a card moved on the board, an edit, a
 * move to another project. Completing a repeating task makes its next copy (shown on open boards);
 * meeting action items follow it into and out of Done; the people following it are told "Task moved
 * to …"; and the timeline gets COMPLETED, REOPENED or MOVED with the columns it went between.
 * `notify: false` leaves out the notice — a move to another project sends its own single notice.
 *
 * Approval steps (task-approval) have their own lines and notices: a task starting to wait tells the
 * people who can approve it (not "moved to Review"); approved and sent back tell its assignees and
 * whoever finished it (a send-back's reason also becomes the approver's comment). They can happen
 * without a column change (a task waits where it is when its project has no Review column).
 */
export function createStatusChangeEffects(deps: StatusEffectsDeps) {
  return async function statusChanged(task: TaskRecord, prevColumnId: string, actorId?: string, opts: StatusChangeOptions = {}): Promise<void> {
    const { approval } = opts;
    if (prevColumnId === task.columnId && !approval) return; // a reorder within a column: no status change
    const [toCol, fromCol] = await Promise.all([deps.column(task.columnId), deps.column(prevColumnId)]);
    const done = toCol?.category === 'DONE';
    const wasDone = fromCol?.category === 'DONE';

    // The timeline line first: the change has happened, so a later step that fails can't lose it.
    if (actorId) {
      const line = lineOf(approval, done, wasDone, opts.reason);
      await deps.record({ taskId: task.id, projectId: task.projectId, userId: actorId, action: line.action, meta: { from: fromCol?.name ?? null, to: toCol?.name ?? null, ...line.meta } });
    }

    if (task.recurrenceRule && done) {
      const next = await deps.nextCopy(task);
      // Approval turned off on this waiting task only: the series' next copy still needs it.
      if (next && approval === 'SWITCHED_OFF') await deps.keepApprovalOnCopy?.(next.id);
      if (next) await deps.announceCopy(next.id, task.projectId);
    }
    // Best effort: the change has happened, so a failure here is reported rather than undoing it.
    if (done !== wasDone) await deps.followActionItems(task.id, done).catch((err) => deps.onError?.(err, task.id));
    if (approval === 'SENT_BACK' && actorId && opts.reason) {
      await Promise.resolve(deps.sentBackComment?.(task, actorId, opts.reason)).catch((err) => deps.onError?.(err, task.id));
    }

    if (opts.notify === false) return;
    const tell = async (userIds: string[], type: string, title: string) => {
      for (const userId of userIds) await deps.notify({ userId, type, title, body: taskNoticeBody(task), entityType: 'task', entityId: task.id });
    };
    switch (approval) {
      case 'REQUESTED':
        return tell((await deps.approvers?.(task, actorId)) ?? [], APPROVAL_NOTICE, 'Waiting for your approval');
      case 'APPROVED':
        return tell((await deps.approvalAudience?.(task, actorId, opts.requestedById)) ?? [], APPROVAL_NOTICE, 'Your task was approved');
      case 'SENT_BACK':
        return tell((await deps.approvalAudience?.(task, actorId, opts.requestedById)) ?? [], APPROVAL_NOTICE, cut(`Sent back: ${opts.reason ?? ''}`));
      default:
        if (prevColumnId === task.columnId) return;
        return tell(await deps.recipients(task.id, actorId), 'TASK_STATUS', `Task moved to ${toCol?.name ?? 'a new stage'}`);
    }
  };
}

export type StatusChangeEffects = ReturnType<typeof createStatusChangeEffects>;
