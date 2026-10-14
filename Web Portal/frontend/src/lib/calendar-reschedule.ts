/**
 * Moving a task to another day from the calendar. A repeating task's newest copy carries the
 * series' rule, and the next copy is worked out from its date — so moving it asks first:
 *  - "This occurrence": only this copy moves; the rule notes the day it replaced (`resumeFrom`), so
 *    the copies after it stay on their days.
 *  - "This and future occurrences": the schedule moves too (its weekday / day of the month).
 * An earlier copy of a series is history-like: moving it changes nothing else.
 */
import type { ApiTask, RecurrenceRule } from '../api/tasks';
import type { CalStatus } from './calendar-model';

export type MoveScope = 'occurrence' | 'series';

export interface MovePayload {
  dueDate: string;
  expectedVersion?: number;
  recurrenceRule?: RecurrenceRule;
}

export function canReschedule(item: { kind: 'task' | 'projected'; status: CalStatus; projectArchived: boolean }): boolean {
  return item.kind === 'task' && item.status !== 'done' && !item.projectArchived;
}

/** Only the newest copy of a series (the one carrying the rule) affects the copies after it. */
export function needsSeriesChoice(task: ApiTask): boolean {
  return !!task.recurrenceRule;
}

const dow = (key: string) => new Date(`${key}T00:00:00.000Z`).getUTCDay();
const dom = (key: string) => Number(key.slice(8, 10));
const daysInMonth = (key: string) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).getUTCDate();

/** The rule with its schedule moved from `from` to `to` (the moved-occurrence note dropped). */
export function shiftRule(rule: RecurrenceRule, from: string, to: string): RecurrenceRule {
  const next: RecurrenceRule = { ...rule };
  delete next.resumeFrom;
  if (rule.freq === 'WEEKLY' && rule.weekdays?.length) {
    const days = new Set(rule.weekdays.map((d) => (d === dow(from) ? dow(to) : d)));
    next.weekdays = [...days].sort((a, b) => a - b);
  }
  if (rule.freq === 'MONTHLY' || rule.freq === 'QUARTERLY') {
    if (rule.dayOfMonth != null) next.dayOfMonth = dom(to);
    if (rule.nthWeekday) {
      const last = dom(to) + 7 > daysInMonth(to);
      next.nthWeekday = { week: rule.nthWeekday.week === -1 && last ? -1 : (Math.min(4, Math.ceil(dom(to) / 7)) as 1 | 2 | 3 | 4), day: dow(to) };
    }
  }
  if (rule.anchorDay != null) next.anchorDay = dom(to);
  return next;
}

export function planMove(task: ApiTask, from: string, to: string, scope: MoveScope): MovePayload {
  const payload: MovePayload = { dueDate: to, ...(task.version !== undefined ? { expectedVersion: task.version } : {}) };
  const rule = task.recurrenceRule;
  if (!rule) return payload;
  payload.recurrenceRule = scope === 'series' ? shiftRule(rule, from, to) : { ...rule, resumeFrom: rule.resumeFrom ?? from };
  return payload;
}

/** Back to the day — and rule — as they were before the move. */
export function planUndo(original: ApiTask, from: string, version: number | undefined): MovePayload {
  return {
    dueDate: from,
    ...(version !== undefined ? { expectedVersion: version } : {}),
    ...(original.recurrenceRule ? { recurrenceRule: original.recurrenceRule } : {}),
  };
}
