import { completedOnTime, daysUntilDue, dueDayKey, isOverdue, zonedDayKey } from '../../lib/due-date';
import { isTaskDone } from '../tasks/task-status';

/**
 * Scheduled inspections: what a "check" is and what state it is in — the ONE place these rules live.
 * The Inspections tab (due checks, schedules), the finished-inspections list and the Management
 * dashboard all use these, so they never disagree. Keep the names and signatures stable.
 *
 * Definitions:
 * - check     = a live (not deleted) task that carries an inspection form (`inspectionFormId` set).
 * - schedule  = a check that carries the repeat rule: the newest copy of a repeating series with a form
 *               (only the newest copy of a series carries `recurrenceRule`).
 * - done      = the task is completed: in a Done-category column, or `completedAt` set.
 * - done late = finished after the end of its due day in the company time zone — exactly
 *               `completedOnTime(due, completedAt, tz) === false` (lib/due-date).
 * - late      = (open) not done, and `isOverdue(due, tz, now)` — its due day is before today.
 * - closed without a report = done, but no finished inspection is linked to the task.
 *
 * Exports:
 * - type CheckState = 'DUE' | 'LATE' | 'DONE' | 'DONE_LATE'; CHECK_STATES (that list)
 * - interface CheckTask — the task facts the rules read (a TaskRecord or a Prisma row fits)
 * - isCheck(task), isSchedule(task), isCheckDone(task)
 * - checkState(task, timeZone, now?) → CheckState
 * - daysLate(task, timeZone, now?) → whole days: an open check's days past its due day, a done
 *   check's days from its due day to the day it was finished (0 when on time or undated)
 * - closedWithoutReport(task, hasFinishedInspection) → boolean
 * - compareOpenChecks(timeZone) → a sort comparator by due day, earliest first: the late ones come first
 *   (the most overdue first), then due today, then upcoming by due day, then undated
 */

export type CheckState = 'DUE' | 'LATE' | 'DONE' | 'DONE_LATE';
export const CHECK_STATES: readonly CheckState[] = ['DUE', 'LATE', 'DONE', 'DONE_LATE'];

type When = Date | string | null | undefined;

export interface CheckTask {
  dueDate: When;
  completedAt: When;
  /** Its column's stage: a Done column counts as done even without a completion time (older rows). */
  columnCategory?: string | null;
  inspectionFormId?: string | null;
  /** Set on the newest copy of a repeating series only. */
  recurrenceRule?: unknown;
  deletedAt?: When;
}

export function isCheck(t: CheckTask): boolean {
  return !t.deletedAt && !!t.inspectionFormId;
}

export function isSchedule(t: CheckTask): boolean {
  return isCheck(t) && t.recurrenceRule !== null && t.recurrenceRule !== undefined;
}

export function isCheckDone(t: CheckTask): boolean {
  return isTaskDone({ columnCategory: t.columnCategory ?? null, completedAt: t.completedAt ?? null });
}

export function checkState(t: CheckTask, timeZone: string, now: Date = new Date()): CheckState {
  if (isCheckDone(t)) return completedOnTime(t.dueDate, t.completedAt, timeZone) === false ? 'DONE_LATE' : 'DONE';
  return isOverdue(t.dueDate, timeZone, now) ? 'LATE' : 'DUE';
}

const noon = (key: string) => Date.parse(`${key}T12:00:00Z`);

export function daysLate(t: CheckTask, timeZone: string, now: Date = new Date()): number {
  if (isCheckDone(t)) {
    if (completedOnTime(t.dueDate, t.completedAt, timeZone) !== false) return 0;
    const due = dueDayKey(t.dueDate, timeZone)!;
    const doneDay = zonedDayKey(new Date(t.completedAt as Date | string), timeZone);
    return Math.round((noon(doneDay) - noon(due)) / 86_400_000);
  }
  const days = daysUntilDue(t.dueDate, timeZone, now);
  return days !== null && days < 0 ? -days : 0;
}

export function closedWithoutReport(t: CheckTask, hasFinishedInspection: boolean): boolean {
  return isCheck(t) && isCheckDone(t) && !hasFinishedInspection;
}

export function compareOpenChecks(timeZone: string): (a: CheckTask, b: CheckTask) => number {
  // By due day: the late ones (the earliest days) come first, then today, then upcoming.
  return (a, b) => {
    const ka = dueDayKey(a.dueDate, timeZone);
    const kb = dueDayKey(b.dueDate, timeZone);
    if (ka === kb) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return ka < kb ? -1 : 1;
  };
}
