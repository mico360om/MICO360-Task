import type { CreateNotificationData } from './notification-repository';
import { daysUntilDue } from '../../lib/due-date';
import { defaultCompanyTimeZone, isTaskDone } from '../tasks/task-status';

/** A task considered for deadline reminders. */
export interface ReminderTask {
  id: string;
  title: string;
  dueDate: Date | null;
  /** The task's current column category — DONE tasks are never reminded. */
  columnCategory?: string | null;
  /** A completed task is never reminded, whatever column it sits in. */
  completedAt?: Date | null;
  /** Users to remind (its assignees). */
  assigneeIds: string[];
}

export const DEFAULT_SOON_WINDOW_MS = 24 * 60 * 60 * 1000; // "due soon" = due today or tomorrow

export interface PlanRemindersOptions {
  now?: Date;
  /** Fallback "due soon" window when a user has no reminder-lead preference. */
  defaultSoonWindowMs?: number;
  /** Per-user reminder lead time in minutes (from their notification preferences). */
  leadMinutesFor?: (userId: string) => number | undefined;
  /** Company time zone that defines "today" (defaults to COMPANY_TIMEZONE). */
  timeZone?: string;
}

const DAY_MS = 86_400_000;
/** A lead time as whole calendar days ahead of the due day (due dates carry no time of day). */
const leadDays = (ms: number): number => Math.max(0, Math.ceil(ms / DAY_MS));

/**
 * Decide which reminder notifications to create for a set of tasks. Due dates are calendar days
 * in the company time zone: a task is overdue only once its due day is before today, and "due
 * soon" once the due day is within the user's lead time (in whole days; the default is due today
 * or tomorrow). Pure + deterministic so it can be unit-tested; the caller handles de-duplication.
 */
export function planReminders(tasks: ReminderTask[], opts: PlanRemindersOptions = {}): CreateNotificationData[] {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? defaultCompanyTimeZone();
  const defaultDays = leadDays(opts.defaultSoonWindowMs ?? DEFAULT_SOON_WINDOW_MS);
  const out: CreateNotificationData[] = [];

  for (const task of tasks) {
    if (isTaskDone(task)) continue;
    const days = daysUntilDue(task.dueDate, timeZone, now);
    if (days === null) continue;

    for (const userId of task.assigneeIds) {
      if (days < 0) {
        out.push({ userId, type: 'TASK_OVERDUE', title: 'A task is overdue', body: task.title, entityType: 'task', entityId: task.id });
        continue;
      }
      // Due-soon threshold is per-user: their lead time or the default window, in days.
      const leadMin = opts.leadMinutesFor?.(userId);
      const window = leadMin != null ? leadDays(leadMin * 60_000) : defaultDays;
      if (days <= window) {
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
