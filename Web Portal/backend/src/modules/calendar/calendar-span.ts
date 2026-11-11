import { dueDayKey } from '../../lib/due-date';

/**
 * Calendar scheduling (owner, 11 Nov 2026): a task shows as one bar from its start day to its due day,
 * ▶ at the start and ⚑ at the due day. A due-only task stays on its due day; a very long task (over three
 * weeks) shows only its start and due marks. Days are company days (a date-only value is its own day).
 * The website draws it (lib/calendar-span.ts); the server only needs to know which tasks a range shows.
 */

/** Longest bar, in days from start to due; longer tasks show only their two marks. */
export const MAX_SPAN_DAYS = 21;

export type SpanMode = 'bar' | 'markers' | 'due' | 'start';

export interface SpanDates {
  startDate: Date | string | null | undefined;
  dueDate: Date | string | null | undefined;
}

const daysApart = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** A task's start and due days and how it is drawn (null: no dates at all). */
export function spanOf(task: SpanDates, timeZone: string): { start: string | null; due: string | null; mode: SpanMode } | null {
  const due = dueDayKey(task.dueDate ?? null, timeZone);
  const start = dueDayKey(task.startDate ?? null, timeZone);
  if (!due) return start ? { start, due: null, mode: 'start' } : null;
  // A start on (or, by a slip, after) the due day adds nothing: the task sits on its due day.
  if (!start || start >= due) return { start: null, due, mode: 'due' };
  return { start, due, mode: daysApart(start, due) > MAX_SPAN_DAYS ? 'markers' : 'bar' };
}

/**
 * Shown in [from, to] by its start or its bar — while NOT due in it (those come with the range's due
 * tasks): its start mark inside the range, or a bar (three weeks at most) crossing into it.
 */
export function shownBySpan(task: SpanDates, range: { from: string; to: string }, timeZone: string): boolean {
  const s = spanOf(task, timeZone);
  if (!s) return false;
  const inRange = (k: string | null) => k !== null && k >= range.from && k <= range.to;
  if (inRange(s.due)) return false;
  if (inRange(s.start)) return true;
  return s.mode === 'bar' && s.start! < range.from && s.due! > range.to;
}
