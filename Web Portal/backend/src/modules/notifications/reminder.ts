import type { CreateNotificationData } from './notification-repository';
import { daysUntilDue } from '../../lib/due-date';
import { defaultCompanyTimeZone, isTaskDone } from '../tasks/task-status';
import { taskNoticeBody } from './task-notice';

/** A task considered for deadline reminders. */
export interface ReminderTask {
  id: string;
  /** The task's number (1.22.3): the notice reads "MICO-142 · Title", like every other task notice. */
  key?: string;
  title: string;
  dueDate: Date | null;
  /** The task's current column category — DONE tasks are never reminded. */
  columnCategory?: string | null;
  /** A completed task is never reminded, whatever column it sits in. */
  completedAt?: Date | null;
  /** Waiting for approval since (task approvals): no deadline reminders meanwhile (owner, 30 Oct). */
  approvalRequestedAt?: Date | null;
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
 * or tomorrow). A task waiting for approval gets neither: the work is handed in and its approver sees
 * it under To approve; sent back, the reminders start again (owner, 30 Oct). Pure + deterministic so
 * it can be unit-tested; the caller handles de-duplication.
 */
export function planReminders(tasks: ReminderTask[], opts: PlanRemindersOptions = {}): CreateNotificationData[] {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? defaultCompanyTimeZone();
  const defaultDays = leadDays(opts.defaultSoonWindowMs ?? DEFAULT_SOON_WINDOW_MS);
  const out: CreateNotificationData[] = [];

  for (const task of tasks) {
    if (isTaskDone(task) || task.approvalRequestedAt) continue;
    const days = daysUntilDue(task.dueDate, timeZone, now);
    if (days === null) continue;
    const body = (task.key ? taskNoticeBody({ key: task.key, title: task.title }) : null) ?? task.title;

    for (const userId of task.assigneeIds) {
      if (days < 0) {
        out.push({ userId, type: 'TASK_OVERDUE', title: 'A task is overdue', body, entityType: 'task', entityId: task.id });
        continue;
      }
      // Due-soon threshold is per-user: their lead time or the default window, in days.
      const leadMin = opts.leadMinutesFor?.(userId);
      const window = leadMin != null ? leadDays(leadMin * 60_000) : defaultDays;
      if (days <= window) {
        out.push({ userId, type: 'TASK_DUE_SOON', title: 'A task is due soon', body, entityType: 'task', entityId: task.id });
      }
    }
  }
  return out;
}

/** A planned reminder; `dedupeId` (a checklist item's) replaces the task in its de-duplication key. */
export type PlannedReminder = CreateNotificationData & { dedupeId?: string };

/** A stable key for de-duplicating a reminder within a period (e.g. per day). */
export function reminderKey(n: PlannedReminder, period: string): string {
  return `${n.type}:${n.dedupeId ?? n.entityId}:${n.userId}:${period}`;
}

/** An open dated checklist item of an open task (1.23.3), with its task's assignees. */
export interface ReminderChecklistItem {
  id: string;
  text: string;
  dueDate: Date;
  assigneeId: string | null;
  taskId: string;
  taskKey: string;
  /** Who an unassigned item reminds: the task's assignees (already only people who may see it). */
  taskAssigneeIds: string[];
}

/**
 * 1.23.3 (design call 4): due-soon and overdue reminders for checklist items — same timing as a task's
 * (each person's lead time, the company's days). An item given to someone reminds that person only; an
 * unassigned one reminds the task's assignees. The notice opens the task ("MICO-142 · Label circuits")
 * and keeps the task reminders' types, so people's settings for them apply; it is de-duplicated by item,
 * person and day (`dedupeId`), never with the task's own reminder. Callers pass only items of open tasks
 * not waiting for approval.
 */
export function planChecklistReminders(items: ReminderChecklistItem[], opts: PlanRemindersOptions = {}): PlannedReminder[] {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? defaultCompanyTimeZone();
  const defaultDays = leadDays(opts.defaultSoonWindowMs ?? DEFAULT_SOON_WINDOW_MS);
  const out: PlannedReminder[] = [];
  for (const item of items) {
    const days = daysUntilDue(item.dueDate, timeZone, now);
    if (days === null) continue;
    const body = taskNoticeBody({ key: item.taskKey, title: item.text }) ?? item.text;
    const people = item.assigneeId ? [item.assigneeId] : [...new Set(item.taskAssigneeIds)];
    for (const userId of people) {
      const base = { userId, body, entityType: 'task', entityId: item.taskId, dedupeId: `item:${item.id}` };
      if (days < 0) {
        out.push({ ...base, type: 'TASK_OVERDUE', title: 'A checklist item is overdue' });
        continue;
      }
      const leadMin = opts.leadMinutesFor?.(userId);
      if (days <= (leadMin != null ? leadDays(leadMin * 60_000) : defaultDays)) out.push({ ...base, type: 'TASK_DUE_SOON', title: 'A checklist item is due soon' });
    }
  }
  return out;
}
