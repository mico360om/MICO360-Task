import { dueDayKey, todayKey, zonedDayKey } from '../../lib/due-date';

/** A project's settings for its tasks (the "Tasks" section of the project form). */
export interface ProjectTaskSettings {
  /**
   * Each night, unfinished tasks on past board days move to today's board. The company-wide switch
   * (system setting `carryForward.enabled`) comes first: when that is off, nothing carries.
   */
  carryForward: boolean;
  /** A task added to the project without a due date gets today's date. Dates people choose are kept. */
  defaultDueToday: boolean;
}

/** What every project starts with — and what every project had before the settings existed. */
export const PROJECT_TASK_DEFAULTS: ProjectTaskSettings = { carryForward: true, defaultDueToday: false };

/**
 * The one rule for "New tasks are due today": the due date a task gets as it enters a project —
 * created in it (or, should tasks ever move between projects, moved into it). A date someone chose
 * is always kept. Without one, a project with `defaultDueToday` gives it, in this order:
 * - the board day it is added to (`boardDate`, e.g. added from next Tuesday's board), when that day
 *   is later than today — so it isn't overdue before its day comes;
 * - otherwise today, the company's calendar day (a past board day gives today too: a new task never
 *   starts overdue).
 * The day is stored the way due dates are (UTC midnight of that day). A task that only starts after
 * that day can't be due on it, so it keeps no date.
 *
 * Only entering a project counts: clearing the date later, within the same project, leaves it clear.
 */
export function dueDateOnEntry(
  task: { dueDate?: Date | null; startDate?: Date | null; boardDate?: Date | null },
  project: Pick<ProjectTaskSettings, 'defaultDueToday'> | null | undefined,
  timeZone: string,
  now: Date = new Date(),
): Date | null | undefined {
  if (task.dueDate || !project?.defaultDueToday) return task.dueDate;
  const today = todayKey(timeZone, now);
  const boardDay = task.boardDate ? zonedDayKey(task.boardDate, timeZone) : null;
  const day = boardDay && boardDay > today ? boardDay : today;
  const startDay = task.startDate ? dueDayKey(task.startDate, timeZone) : null;
  if (startDay && startDay > day) return task.dueDate;
  return new Date(`${day}T00:00:00.000Z`);
}
