/**
 * The calendar's range as the phone keeps it (5a): the server's answer to GET /calendar, the
 * offline copy of the last range seen fitted to another range, a move shown at once, and the moves
 * still waiting on this phone laid over what the server (or the copy) says.
 */
import type { CalendarOccurrence, CalendarTask } from './calendar-model';
import type { ApiMeeting, ApiTask } from './types';
import type { RecurrenceRule } from './recurrence';
import type { QueuedMutation } from './sync-queue';
import { dueDayKey } from './due-date';
import { withoutOldDone } from './offline-copy';

/** GET /calendar?from&to: the tasks due in the range (projects you can see) and the days repeating ones will be copied to. */
export interface CalendarRange {
  /** 'YYYY-MM-DD', as asked. */
  from: string;
  to: string;
  /** The company's time zone, which the server placed the due days in. */
  timeZone: string;
  tasks: CalendarTask[];
  /** Days repeating tasks will be copied to (computed by the server, not stored). */
  occurrences: CalendarOccurrence[];
  /** The newest copy of each series the occurrences come from. */
  series: CalendarTask[];
}

/** Does a kept range hold every day of [from, to]? */
export function copyCovers(saved: Pick<CalendarRange, 'from' | 'to'>, from: string, to: string): boolean {
  return saved.from <= from && saved.to >= to;
}

/**
 * The kept range answering [from, to]: as it is when it's that range, otherwise only the days the
 * two share (tasks on their company-time day, as the server chose them; the occurrences in it and
 * their series).
 */
export function fitRange(saved: CalendarRange, from: string, to: string): CalendarRange {
  if (saved.from === from && saved.to === to) return saved;
  const inside = (day: string | null) => day !== null && day >= from && day <= to;
  const tasks = saved.tasks.filter((t) => inside(dueDayKey(t.dueDate, saved.timeZone)));
  const occurrences = saved.occurrences.filter((o) => inside(o.date));
  const heads = new Set(occurrences.map((o) => o.taskId));
  return { ...saved, from, to, tasks, occurrences, series: saved.series.filter((s) => heads.has(s.id)) };
}

/** The meetings starting in [from, to) (ISO instants), for a kept list of another range. */
export function meetingsInRange<T extends Pick<ApiMeeting, 'startAt'>>(meetings: T[], from: string, to: string): T[] {
  const a = Date.parse(from);
  const b = Date.parse(to);
  return meetings.filter((m) => {
    const t = Date.parse(m.startAt);
    return t >= a && t < b;
  });
}

/** A copy too long to keep whole leaves out tasks finished long ago (offline-copy). */
export function slimRange(now: number): (range: CalendarRange) => CalendarRange {
  const keep = withoutOldDone(now) as unknown as (tasks: CalendarTask[]) => CalendarTask[];
  return (range) => ({ ...range, tasks: keep(range.tasks) });
}

export interface DuePatch {
  /** 'YYYY-MM-DD' (a calendar day, stored as that day's UTC midnight), a whole ISO instant, or null for none. */
  dueDate?: string | null;
  recurrenceRule?: RecurrenceRule | null;
}

/** A list of tasks with one on its new day (and with its new repeat) — the same list when it isn't in it. */
export function movedInList<T extends Pick<ApiTask, 'id' | 'dueDate'> & { recurrenceRule?: RecurrenceRule | null }>(list: T[], taskId: string, patch: DuePatch): T[] {
  if (!list.some((t) => t.id === taskId)) return list;
  return list.map((t) => {
    if (t.id !== taskId) return t;
    const next = { ...t };
    // A day is stored as its UTC midnight; a whole instant (putting a timed due date back) as it is.
    if ('dueDate' in patch) next.dueDate = patch.dueDate ? (patch.dueDate.length === 10 ? `${patch.dueDate}T00:00:00.000Z` : patch.dueDate) : null;
    if ('recurrenceRule' in patch) next.recurrenceRule = patch.recurrenceRule ?? null;
    return next;
  });
}

/** The range with one task on its new day (and with its new repeat) — the same range when it isn't in it. */
export function withMovedTask<R extends CalendarRange>(range: R, taskId: string, patch: DuePatch): R {
  const tasks = movedInList(range.tasks, taskId, patch);
  const series = movedInList(range.series, taskId, patch);
  return tasks === range.tasks && series === range.series ? range : { ...range, tasks, series };
}

/**
 * A move shown at once in a cached calendar answer, whatever it holds: a range, or a list of tasks
 * (the overdue ones). Anything else is left as it is.
 */
export function movedInCached(data: unknown, taskId: string, patch: DuePatch): unknown {
  if (Array.isArray(data)) return movedInList(data as CalendarTask[], taskId, patch);
  if (data && typeof data === 'object' && Array.isArray((data as CalendarRange).tasks) && Array.isArray((data as CalendarRange).series)) {
    return withMovedTask(data as CalendarRange, taskId, patch);
  }
  return data;
}

/** The due-day part of a queued task edit, or null when it doesn't change the day or the repeat. */
function duePart(m: Pick<QueuedMutation, 'kind' | 'payload'>): { id: string; patch: DuePatch } | null {
  if (m.kind !== 'task.update') return null;
  const p = (m.payload ?? {}) as { id?: unknown; patch?: Record<string, unknown> | null };
  if (typeof p.id !== 'string' || !p.patch || typeof p.patch !== 'object') return null;
  const patch: DuePatch = {};
  if ('dueDate' in p.patch) patch.dueDate = typeof p.patch.dueDate === 'string' ? p.patch.dueDate.slice(0, 10) : null;
  if ('recurrenceRule' in p.patch) patch.recurrenceRule = (p.patch.recurrenceRule as RecurrenceRule | null) ?? null;
  return 'dueDate' in patch || 'recurrenceRule' in patch ? { id: p.id, patch } : null;
}

/**
 * The range with this user's due-day changes still waiting to be sent laid over it (oldest first,
 * so the newest wins). Neither the server nor the offline copy has them yet; without this a
 * refresh would put a task moved offline back on its old day although the move is still queued.
 */
export function withPendingDueDates<R extends CalendarRange>(range: R, pending: readonly Pick<QueuedMutation, 'kind' | 'payload'>[]): R {
  let next = range;
  for (const m of pending) {
    const part = duePart(m);
    if (part) next = withMovedTask(next, part.id, part.patch);
  }
  return next;
}

/** A list of tasks (the overdue ones) with the due-day changes still waiting laid over it. */
export function listWithPendingDueDates<T extends Pick<ApiTask, 'id' | 'dueDate'> & { recurrenceRule?: RecurrenceRule | null }>(
  list: T[],
  pending: readonly Pick<QueuedMutation, 'kind' | 'payload'>[],
): T[] {
  let next = list;
  for (const m of pending) {
    const part = duePart(m);
    if (part) next = movedInList(next, part.id, part.patch);
  }
  return next;
}

/** What the calendar shows for a range: which days the offline copy holds when it answered (null: the server did). */
export interface RangeView extends CalendarRange {
  savedCopy: { from: string; to: string; covers: boolean } | null;
}

/**
 * The range the screen gets: the server's answer, or — offline — the copy of the last range seen,
 * fitted to the range asked (and saying which days it holds); either way with this user's due-day
 * changes still waiting laid over it.
 */
export function rangeView(
  answer: CalendarRange,
  from: string,
  to: string,
  opts: { fromCopy: boolean; pending: readonly Pick<QueuedMutation, 'kind' | 'payload'>[] },
): RangeView {
  const base = opts.fromCopy ? fitRange(answer, from, to) : answer;
  const savedCopy = opts.fromCopy ? { from: answer.from, to: answer.to, covers: copyCovers(answer, from, to) } : null;
  return withPendingDueDates({ ...base, savedCopy }, opts.pending);
}
