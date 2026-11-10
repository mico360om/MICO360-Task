import { dayText } from './day-words';
import { todayKey } from './due-date';
import { isTaskDone } from './due-display';

/**
 * Tasks scheduled for the future (owner, 10 Nov 2026: "Waits until its start day"). The server puts a
 * new task whose Start date is later than today on its start day's board; until that day it waits —
 * under "Upcoming" in My Tasks and the project's list, off today's board, lists and counts. A task
 * waits while its board day is later than today (the company's day) and it isn't done.
 */

/** The day ('YYYY-MM-DD') a task waits for, or null when it is today's (or done). */
export function waitingDay(
  task: { boardDate?: string | null; completedAt?: string | null; columnCategory?: string | null },
  timeZone: string,
  now: Date = new Date(),
): string | null {
  if (!task.boardDate || isTaskDone(task)) return null;
  // Board days are stored at noon UTC: their UTC date is the day.
  const board = task.boardDate.slice(0, 10);
  return board > todayKey(timeZone, now) ? board : null;
}

const words = (day: string, today: string) => dayText(day, { year: day.slice(0, 4) !== today.slice(0, 4) });

/** Under the form's Start date: "Scheduled for 20 Nov — …" when it is later than today, else null. */
export function scheduledNote(start: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start <= today) return null;
  return `Scheduled for ${words(start, today)} — it waits under Upcoming until then.`;
}

/** "Starts 20 Nov" (the year when it isn't this one), on a waiting task. */
export function startsText(day: string, today: string): string {
  return `Starts ${words(day, today)}`;
}

/**
 * The board day a new task's form sends: the board's own day (the form opened from a board) — unless a
 * Start date later than today was picked; then none, so the server puts the task on its start day
 * (the most specific choice wins, and the form's "Scheduled for …" note stays true).
 */
export function formBoardDate(boardDate: string | undefined, start: string, today: string): string | undefined {
  if (!boardDate) return undefined;
  return start && start > today ? undefined : boardDate;
}
