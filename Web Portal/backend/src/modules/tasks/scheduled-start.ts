import type { Prisma } from '@prisma/client';
import { dueDayKey, shiftDayKey, todayKey } from '../../lib/due-date';
import { formatDay } from '../../lib/export-format';
import { boardDateFromKey, boardDateKey } from './board-date';

/**
 * Tasks scheduled for the future (owner, 10 Nov 2026: "Waits until its start day").
 *
 * A task's board day (per-date boards) says when it shows up. A new task whose Start date is later
 * than today — and that wasn't given a board day — goes on its start day's board and WAITS there:
 * until that day it is out of today's board, today's lists and counts, priorities and reminders, and
 * shown under "Upcoming" and in the planning views (calendar, timeline, workload, the daily email's
 * "Coming up"). On its start day it is like any task. One rule, here, for every way a task is made
 * and edited; "today" and every day are the company's (its time zone).
 */

/** Column kinds of a task nobody has started: only these wait for a start day. */
const NOT_STARTED_KINDS = new Set(['BACKLOG', 'TODO']);

/** The task as the edit rule reads it. */
export interface StartEditSubject {
  boardDate: Date | null;
  columnCategory?: string | null;
  completedAt?: Date | null;
  approvalRequestedAt?: Date | null;
}

/** Not started: still in a Backlog or To-do kind of column, not done, not handed in for approval. */
export function isNotStarted(task: Omit<StartEditSubject, 'boardDate'>): boolean {
  return !task.completedAt && !task.approvalRequestedAt && NOT_STARTED_KINDS.has(task.columnCategory ?? 'TODO');
}

/** A start date's calendar day (a date-only value is its own day; an instant is read in company time). */
export function startDayKey(start: Date | null | undefined, timeZone: string): string | null {
  return start ? dueDayKey(start, timeZone) : null;
}

/**
 * The board day a new task lands on: the one asked for (it still wins); else its start day when that
 * is later than today (it waits); else today.
 */
export function newTaskBoardDay(input: { boardDate?: Date | null; startDate?: Date | null }, timeZone: string, now: Date): Date {
  if (input.boardDate) return input.boardDate;
  const today = todayKey(timeZone, now);
  const start = startDayKey(input.startDate, timeZone);
  return boardDateFromKey(start && start > today ? start : today);
}

/**
 * The edit rule, once a task's start day changed: the board day it moves to, or null to stay.
 * - Not started, start now later than today: that day's board (it waits again).
 * - Not started and waiting, start now today or earlier (or cleared): today's board.
 * - Under way (In progress / Review / Blocked kinds), done or handed in for approval: it stays.
 * A task already on today's (or a past) board stays when its start moves to today or earlier — the
 * nightly carry-forward looks after past days, as for any task.
 */
export function boardDayAfterStartEdit(task: StartEditSubject, nextStart: Date | null, timeZone: string, now: Date): Date | null {
  if (!isNotStarted(task)) return null;
  const today = todayKey(timeZone, now);
  const start = startDayKey(nextStart, timeZone);
  const current = task.boardDate ? boardDateKey(task.boardDate, timeZone) : null;
  if (start && start > today) return current === start ? null : boardDateFromKey(start);
  return current && current > today ? boardDateFromKey(today) : null;
}

/** The day ('YYYY-MM-DD') a task waits for — its board day while that is later than today — else null. */
export function waitingDayKey(task: { boardDate?: Date | string | null; completedAt?: Date | string | null }, timeZone: string, now: Date): string | null {
  if (!task.boardDate || task.completedAt) return null;
  const board = boardDateKey(new Date(task.boardDate), timeZone);
  return board > todayKey(timeZone, now) ? board : null;
}

export function isWaitingTask(task: { boardDate?: Date | string | null; completedAt?: Date | string | null }, timeZone: string, now: Date): boolean {
  return waitingDayKey(task, timeZone, now) !== null;
}

/**
 * The database side of "not waiting": no board day, or one up to today. Board days are stored at noon
 * UTC of their day, so "before tomorrow's UTC midnight" is today and earlier in every realistic zone.
 */
export function notWaitingWhere(timeZone: string, now: Date): Prisma.TaskWhereInput {
  const tomorrow = shiftDayKey(todayKey(timeZone, now), 1);
  return { OR: [{ boardDate: null }, { boardDate: { lt: new Date(`${tomorrow}T00:00:00.000Z`) } }] };
}

/** "starts 20 Nov" (with the year when it isn't this year's), as notices say it. */
export function startsOnWords(dayKey: string, now: Date, timeZone: string): string {
  const sameYear = dayKey.slice(0, 4) === todayKey(timeZone, now).slice(0, 4);
  return `starts ${formatDay(dayKey, { year: !sameYear })}`;
}
