/**
 * Inspection checks — the definitions the Management page and the weekly summary count by. They are
 * the scheduled-inspections rules (its design, "Definitions"), built on the same helpers of
 * lib/due-date.ts, so both features agree on every check:
 *
 * - a **check** is a non-deleted task with `inspectionFormId` set;
 * - **done**: the task is finished (a Done column or a completion time — `isTaskDone`);
 * - **done late**: done, and `completedOnTime(due, completedAt, tz) === false`;
 * - **missing** (late, open): not done and `isOverdue(due, tz, now)`;
 * - **closed without a report**: done, with no finished inspection linked to the task.
 *
 * At integration with the scheduled-inspections branch this is the one place to point at its
 * shared module (inspections/inspection-checks.ts) instead.
 */
import { completedOnTime, dueDayKey, isOverdue } from '../../lib/due-date';
import { isTaskDone } from '../tasks/task-status';

export type CheckState = 'DUE' | 'LATE' | 'DONE' | 'DONE_LATE';

export interface CheckTask {
  dueDate: Date | null;
  completedAt: Date | null;
  columnCategory: string | null;
}

export function checkState(t: CheckTask, timeZone: string, now: Date): CheckState {
  if (isTaskDone(t)) return completedOnTime(t.dueDate, t.completedAt, timeZone) === false ? 'DONE_LATE' : 'DONE';
  return isOverdue(t.dueDate, timeZone, now) ? 'LATE' : 'DUE';
}

/** A check as the Management page reads it: the task's dates and whether a finished inspection is linked. */
export interface CheckRow extends CheckTask {
  id: string;
  projectId: string;
  /** A finished (not deleted) inspection is linked to the task. */
  hasReport: boolean;
}

export interface CheckCounts {
  /** Due in the period (its due day from the period's first day to today). */
  due: number;
  /** Of those, done. */
  done: number;
  /** Of those, done late. */
  doneLate: number;
  /** Of those done, closed without a report. */
  noReport: number;
  /** Open and past its due day — right now, whenever it was due. */
  missing: number;
}

const empty = (): CheckCounts => ({ due: 0, done: 0, doneLate: 0, noReport: 0, missing: 0 });

/** Is the check's due day in [from, today] ('YYYY-MM-DD', company time)? */
export function dueInPeriod(row: CheckTask, from: string, today: string, timeZone: string): boolean {
  const due = dueDayKey(row.dueDate, timeZone);
  return due !== null && due >= from && due <= today;
}

/** The period's figures per project and in all. */
export function summarizeChecks(
  rows: readonly CheckRow[],
  p: { from: string; today: string; timeZone: string; now: Date },
): { total: CheckCounts; byProject: Map<string, CheckCounts> } {
  const total = empty();
  const byProject = new Map<string, CheckCounts>();
  for (const r of rows) {
    const c = byProject.get(r.projectId) ?? empty();
    const add = (key: keyof CheckCounts) => {
      c[key] += 1;
      total[key] += 1;
    };
    const state = checkState(r, p.timeZone, p.now);
    if (state === 'LATE') add('missing');
    if (dueInPeriod(r, p.from, p.today, p.timeZone)) {
      add('due');
      if (state === 'DONE' || state === 'DONE_LATE') {
        add('done');
        if (state === 'DONE_LATE') add('doneLate');
        if (!r.hasReport) add('noReport');
      }
    }
    byProject.set(r.projectId, c);
  }
  return { total, byProject };
}

/** Checks finished in [from, to) after their due day (the weekly summary's "done late last week"). */
export function doneLateBetween<T extends CheckRow>(rows: readonly T[], from: Date, to: Date, timeZone: string): T[] {
  return rows.filter((r) => r.completedAt && r.completedAt >= from && r.completedAt < to && completedOnTime(r.dueDate, r.completedAt, timeZone) === false);
}
