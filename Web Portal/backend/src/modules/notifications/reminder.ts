import type { CreateNotificationData } from './notification-repository';

/** A task considered for deadline reminders. */
export interface ReminderTask {
  id: string;
  title: string;
  dueDate: Date | null;
  /** The task's current column category — DONE tasks are never reminded. */
  columnCategory?: string | null;
  /** Users to remind (its assignees). */
  assigneeIds: string[];
}

export const DEFAULT_SOON_WINDOW_MS = 24 * 60 * 60 * 1000; // "due soon" = within 24h

export interface PlanRemindersOptions {
  now?: Date;
  /** Fallback "due soon" window when a user has no reminder-lead preference. */
  defaultSoonWindowMs?: number;
  /** Per-user reminder lead time in minutes (from their notification preferences). */
  leadMinutesFor?: (userId: string) => number | undefined;
}

/**
 * Decide which reminder notifications to create for a set of tasks. Emits a TASK_OVERDUE reminder
 * for each assignee of a past-due, not-done task, and a TASK_DUE_SOON reminder for each assignee
 * whose task falls within THEIR reminder lead time (or the default window). Pure + deterministic so
 * it can be unit-tested; the caller handles de-duplication.
 */
export function planReminders(tasks: ReminderTask[], opts: PlanRemindersOptions = {}): CreateNotificationData[] {
  const now = opts.now ?? new Date();
  const defaultWindow = opts.defaultSoonWindowMs ?? DEFAULT_SOON_WINDOW_MS;
  const nowMs = now.getTime();
  const out: CreateNotificationData[] = [];

  for (const task of tasks) {
    if (!task.dueDate) continue;
    if (task.columnCategory === 'DONE') continue;

    const dueMs = new Date(task.dueDate).getTime();
    const overdue = dueMs < nowMs;

    for (const userId of task.assigneeIds) {
      if (overdue) {
        out.push({ userId, type: 'TASK_OVERDUE', title: 'A task is overdue', body: task.title, entityType: 'task', entityId: task.id });
        continue;
      }
      // Due-soon threshold is per-user: their lead time (minutes) or the default window.
      const leadMin = opts.leadMinutesFor?.(userId);
      const windowMs = leadMin != null ? leadMin * 60_000 : defaultWindow;
      if (dueMs - nowMs <= windowMs) {
        out.push({ userId, type: 'TASK_DUE_SOON', title: 'A task is due soon', body: task.title, entityType: 'task', entityId: task.id });
      }
    }
  }
  return out;
}

/** A stable key for de-duplicating a reminder within a period (e.g. per day). */
export function reminderKey(n: CreateNotificationData, period: string): string {
  return `${n.type}:${n.entityId}:${n.userId}:${period}`;
}
