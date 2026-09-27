import { DEFAULT_TIME_ZONE } from './config.js';
import { daysUntilDue, dueDayKey, todayKey, zonedDayKey } from './due-date.js';

/**
 * "Done" must match the backend/report definition (a DONE column OR a completedAt), otherwise the
 * extension's counts disagree with the web dashboard for the same tasks. Done tasks are never overdue.
 */
export const isDone = (t) => t.columnCategory === 'DONE' || t.completedAt != null;

/**
 * Split tasks into Overdue / Due today / Upcoming / No due date / Completed by calendar day in the
 * company time zone (XP-03). Upcoming is sorted soonest first.
 */
export function groupTasksByDue(tasks, { timeZone = DEFAULT_TIME_ZONE, now = Date.now() } = {}) {
  const at = new Date(now);
  const groups = { overdue: [], dueToday: [], upcoming: [], noDue: [], completed: [] };
  for (const t of tasks || []) {
    if (isDone(t)) {
      groups.completed.push(t);
      continue;
    }
    const days = daysUntilDue(t.dueDate, timeZone, at);
    if (days === null) groups.noDue.push(t);
    else if (days < 0) groups.overdue.push(t);
    else if (days === 0) groups.dueToday.push(t);
    else groups.upcoming.push(t);
  }
  const key = (t) => dueDayKey(t.dueDate, timeZone) || '';
  groups.upcoming.sort((a, b) => key(a).localeCompare(key(b)) || new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  groups.overdue.sort((a, b) => key(a).localeCompare(key(b)));
  return groups;
}

/**
 * Summarize a list of tasks for the dashboard: today/overdue/in-progress/completed-today counts and
 * up to 5 upcoming tasks. "Today" is the calendar day in the company time zone.
 */
export function summarizeTasks(tasks, now = Date.now(), timeZone = DEFAULT_TIME_ZONE) {
  const g = groupTasksByDue(tasks, { timeZone, now });
  const today = todayKey(timeZone, new Date(now));
  const completedToday = g.completed.filter((t) => t.completedAt && zonedDayKey(new Date(t.completedAt), timeZone) === today).length;
  const open = [...g.overdue, ...g.dueToday, ...g.upcoming, ...g.noDue];
  return {
    dueToday: g.dueToday.length,
    overdue: g.overdue.length,
    inProgress: open.filter((t) => t.columnCategory === 'IN_PROGRESS').length,
    completedToday,
    upcoming: g.upcoming.slice(0, 5),
  };
}
