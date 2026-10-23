/**
 * "New tasks are due today" (a project setting): the server gives a task created without a due date
 * today's date. A new-task form says so next to an empty due date, so people know what will happen
 * and can pick another day. Dates people pick are always kept.
 */
export const DUE_TODAY_NOTE = 'Due today (this project’s setting)';

/** Will this new task get today's date from its project? (Its due date is empty, the project has the setting.) */
export function willBeDueToday(project: { defaultDueToday?: boolean } | null | undefined, dueDate: string | null | undefined): boolean {
  return !!project?.defaultDueToday && !dueDate;
}
