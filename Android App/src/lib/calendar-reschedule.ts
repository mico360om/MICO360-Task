/**
 * Moving a task to another day from the calendar (5a), as on the website
 * (Web Portal/frontend/src/lib/calendar-reschedule.ts; calendar-reschedule.test.ts checks they agree).
 * A repeating task's newest copy carries the series' rule, and the next copy is worked out from its
 * date — so moving it asks first:
 *  - "This occurrence": only this copy moves; the rule notes the day it replaced (`resumeFrom`), so
 *    the copies after it stay on their days.
 *  - "This and future occurrences": the schedule moves too (its weekday / day of the month).
 * An earlier copy of a series is history-like: moving it changes nothing else. A projected copy
 * isn't a task yet and can't be moved; nor can a finished task or one of an archived project.
 * Also here: what the screen says about a move.
 */
import type { RecurrenceRule } from './recurrence';
import type { CalendarTask, CalItem, CalStatus } from './calendar-model';
import { ApiError, isNetworkError } from './api-client';
import { dayLabel, shiftDayKey } from './calendar';
import { dueDayKey } from './due-date';
import { keptOnPhoneText } from './write-order';

export type MoveScope = 'occurrence' | 'series';

export interface MovePayload {
  dueDate: string;
  expectedVersion?: number;
  recurrenceRule?: RecurrenceRule;
}

type Movable = Pick<CalendarTask, 'recurrenceRule' | 'version'>;

export function canReschedule(item: { kind: 'task' | 'projected'; status: CalStatus; projectArchived: boolean }): boolean {
  return item.kind === 'task' && item.status !== 'done' && !item.projectArchived;
}

/**
 * The Move button on a calendar row, where the task can be moved (null where it can't): a visible
 * way in besides the long-press, which TalkBack users had alone (5a review). A repeating task's
 * sheet asks whether to move this occurrence or the whole series, and the name says so.
 */
export function moveButton(item: Pick<CalItem, 'kind' | 'status' | 'projectArchived' | 'recurring' | 'task'>): { label: string; a11y: string } | null {
  if (!canReschedule(item)) return null;
  return { label: 'Move', a11y: `Move ${item.task.key} to another day${item.recurring ? ': this occurrence or the whole series' : ''}` };
}

/** Why an item can't be moved (null when it can). */
export function moveBlockReason(item: Pick<CalItem, 'kind' | 'status' | 'projectArchived'>): string | null {
  if (item.kind === 'projected') return 'This copy isn’t a task yet, so it can’t be moved. Open the current copy to change the series.';
  if (item.status === 'done') return 'A finished task stays on the day it was due.';
  if (item.projectArchived) return 'Tasks of an archived project can’t be moved.';
  return null;
}

/** Only the newest copy of a series (the one carrying the rule) affects the copies after it. */
export function needsSeriesChoice(task: Pick<CalendarTask, 'recurrenceRule'>): boolean {
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

export function planMove(task: Movable, from: string, to: string, scope: MoveScope): MovePayload {
  const payload: MovePayload = { dueDate: to, ...(task.version !== undefined ? { expectedVersion: task.version } : {}) };
  const rule = task.recurrenceRule;
  if (!rule) return payload;
  payload.recurrenceRule = scope === 'series' ? shiftRule(rule, from, to) : { ...rule, resumeFrom: rule.resumeFrom ?? from };
  return payload;
}

/** Back to the day — and rule — as they were before the move. */
export function planUndo(original: Movable, from: string, version: number | undefined): MovePayload {
  return {
    dueDate: from,
    ...(version !== undefined ? { expectedVersion: version } : {}),
    ...(original.recurrenceRule ? { recurrenceRule: original.recurrenceRule } : {}),
  };
}

/**
 * The edit, and the version the calendar read the task at. The app's task writes send it against
 * the newest version this phone knows (lib/task-writes), so a quick second move isn't refused as
 * someone else's.
 */
export function splitVersion(payload: MovePayload): { patch: Omit<MovePayload, 'expectedVersion'>; version: number | undefined } {
  const { expectedVersion, ...patch } = payload;
  return { patch, version: expectedVersion };
}

/** Why a move was refused, in a few words (the server's own reason where it gave one). */
function reasonOf(err: unknown): string {
  if (err instanceof ApiError && err.message && !/^Request failed/.test(err.message)) return err.message.replace(/\.$/, '');
  if (isNetworkError(err)) return 'the server couldn’t be reached';
  return 'the server had a problem';
}

export function movedText(task: Pick<CalendarTask, 'key' | 'recurrenceRule'>, to: string, scope: MoveScope): string {
  const which = task.recurrenceRule ? (scope === 'series' ? ' (and the occurrences after it)' : ' (this occurrence only)') : '';
  return `Moved ${task.key} to ${dayLabel(to)}${which}.`;
}

export function undoneText(task: Pick<CalendarTask, 'key'>, from: string): string {
  return `${task.key} is back on ${dayLabel(from)}.`;
}

/**
 * A move that is kept on this phone to be sent later: the day it moves to, then why it was kept in
 * the app's one wording (write-order keptOnPhoneText) — offline, behind an earlier change of the
 * task still waiting, or no answer in time (the person may well be online).
 */
export function queuedMoveText(task: Pick<CalendarTask, 'key'>, to: string, err: unknown): string {
  return `Moving ${task.key} to ${dayLabel(to)}. ${keptOnPhoneText(err)}`;
}

/**
 * A refused move. The app loads the server's copy at once, so a change by someone else — maybe to
 * another day — is what shows next: that one names no day and asks for no reload (5a review).
 */
export function moveFailedText(task: Pick<CalendarTask, 'key'>, from: string, err: unknown): string {
  if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
    return `Couldn’t move ${task.key} — it was changed by someone else. Their changes are shown now; try again if you still need to.`;
  }
  return `Couldn’t move ${task.key} — ${reasonOf(err)}. It’s back on ${dayLabel(from)}.`;
}

/** A projected copy explained (the website's words): when it will be made, and when the current copy is due. */
export function projectedNote(item: Pick<CalItem, 'task' | 'date'>, timeZone: string): string {
  const t = item.task;
  const when = t.recurrenceRule?.createNext === 'ON_SCHEDULE' ? `on ${dayLabel(item.date)}` : 'when the current one is completed';
  const due = dueDayKey(t.dueDate, timeZone);
  return `This copy will be created ${when} — it isn’t a task yet. The current copy is due ${due ? dayLabel(due) : 'without a date'}.`;
}

/** Days offered with one tap in "Move to another day": today, tomorrow, and a week after the task's day. */
export function quickDays(today: string, from: string): { label: string; day: string }[] {
  return [
    { label: 'Today', day: today },
    { label: 'Tomorrow', day: shiftDayKey(today, 1) },
    { label: 'A week later', day: shiftDayKey(from, 7) },
  ];
}
