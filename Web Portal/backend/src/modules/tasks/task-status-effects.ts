import { taskNoticeBody } from '../notifications/task-notice';
import type { TaskRecord } from './task-repository';

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
  notify: (n: { userId: string; type: string; title: string; body: string | null; entityType: string; entityId: string }) => Promise<unknown>;
  /** Write a line to the task's timeline. */
  record: (entry: { taskId: string; projectId: string; userId: string; action: string; meta: Record<string, unknown> }) => Promise<unknown>;
  /** A step that failed after the task changed (logged; the change stands). */
  onError?: (err: unknown, taskId: string) => void;
}

/**
 * What a task changing column does, wherever it changes: a card moved on the board, an edit, a
 * move to another project. Completing a repeating task makes its next copy (shown on open boards);
 * meeting action items follow it into and out of Done; the people following it are told "Task moved
 * to …"; and the timeline gets COMPLETED, REOPENED or MOVED with the columns it went between.
 * `notify: false` leaves out the notice — a move to another project sends its own single notice.
 */
export function createStatusChangeEffects(deps: StatusEffectsDeps) {
  return async function statusChanged(task: TaskRecord, prevColumnId: string, actorId?: string, opts: { notify?: boolean } = {}): Promise<void> {
    if (prevColumnId === task.columnId) return; // a reorder within a column: no status change
    const [toCol, fromCol] = await Promise.all([deps.column(task.columnId), deps.column(prevColumnId)]);
    const done = toCol?.category === 'DONE';
    const wasDone = fromCol?.category === 'DONE';

    if (task.recurrenceRule && done) {
      const next = await deps.nextCopy(task);
      if (next) await deps.announceCopy(next.id, task.projectId);
    }
    // Best effort: the change has happened, so a failure here is reported rather than undoing it.
    if (done !== wasDone) await deps.followActionItems(task.id, done).catch((err) => deps.onError?.(err, task.id));

    if (opts.notify !== false) {
      for (const userId of await deps.recipients(task.id, actorId)) {
        await deps.notify({ userId, type: 'TASK_STATUS', title: `Task moved to ${toCol?.name ?? 'a new stage'}`, body: taskNoticeBody(task), entityType: 'task', entityId: task.id });
      }
    }

    if (actorId) {
      const action = done ? 'COMPLETED' : wasDone ? 'REOPENED' : 'MOVED';
      await deps.record({ taskId: task.id, projectId: task.projectId, userId: actorId, action, meta: { from: fromCol?.name ?? null, to: toCol?.name ?? null } });
    }
  };
}

export type StatusChangeEffects = ReturnType<typeof createStatusChangeEffects>;
