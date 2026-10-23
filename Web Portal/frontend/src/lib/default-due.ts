/**
 * "New tasks are due today" (a project setting): the server gives a task created without a due date
 * the board day it is added to, when that day is later than today, else today (company time) — so a
 * new task never starts overdue, nor is overdue before its day comes. Dates people pick are kept.
 * A new-task form says which day next to an empty due date, so people know what will happen and can
 * pick another day.
 */

/**
 * The day ('YYYY-MM-DD') a new task will be due by its project's setting, or null when the setting
 * doesn't apply (the project hasn't got it, or a date is picked). Mirrors the server's rule.
 */
export function defaultDueDay(
  project: { defaultDueToday?: boolean } | null | undefined,
  dueDate: string | null | undefined,
  boardDate: string | null | undefined,
  today: string,
): string | null {
  if (!project?.defaultDueToday || dueDate) return null;
  return boardDate && boardDate > today ? boardDate : today;
}

/** "Due today (this project’s setting)", or the day when it isn't today: "Due Tue 27 Oct (this project’s setting)". */
export function defaultDueNote(day: string, today: string): string {
  if (day === today) return 'Due today (this project’s setting)';
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  const words = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' })
    .format(new Date(`${day}T12:00:00Z`))
    .replace(',', '');
  return `Due ${words} (this project’s setting)`;
}
