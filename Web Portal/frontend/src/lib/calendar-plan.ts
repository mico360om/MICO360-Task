/**
 * Calendar scheduling's drags as changes to save (beside calendar-reschedule.ts, whose due-only planMove /
 * planUndo the Android app's drift tests compare — call 5):
 *  - a task's bar moved: its start and due shift together (its length kept; a timed due keeps its time);
 *  - one end dragged: the start or the due date alone (never past the other) — a ⚑ dropped on an hour sets
 *    the due day (the server keeps due dates as days: ruling R12);
 *  - Undo: both dates (and the repeat) as they were;
 *  - work blocks and meetings moved (their length kept) or a block resized from its end.
 * A repeating task's newest copy asks "this occurrence / the series" as before (shiftRule).
 */
import type { ApiTask, RecurrenceRule } from '../api/tasks';
import { dueDayKey, shiftDayKey } from './due-date';
import { zonedClock, zonedInstant } from './working-days';
import { shiftRule, type MoveScope } from './calendar-reschedule';
import { chosenStart } from './calendar-span';

export interface DatesPayload {
  startDate?: string | null;
  dueDate?: string | null;
  expectedVersion?: number;
  recurrenceRule?: RecurrenceRule;
}

const isDateOnly = (iso: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return true;
  const d = new Date(iso);
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
};
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** A stored date on another day: a day stays a day; a timed one keeps its time of day (the calendar's zone). */
function onDay(value: string, day: string, timeZone: string): string {
  if (isDateOnly(value)) return day;
  return zonedInstant(day, hhmm(zonedClock(new Date(value), timeZone).minutes), timeZone).toISOString();
}

const versioned = (task: ApiTask): Pick<DatesPayload, 'expectedVersion'> => (task.version !== undefined ? { expectedVersion: task.version } : {});

/** The repeat's change when a newest copy's due day moves (as planMove). */
function ruleFor(task: ApiTask, fromDue: string | null, toDue: string | null, scope: MoveScope): Pick<DatesPayload, 'recurrenceRule'> {
  const rule = task.recurrenceRule;
  if (!rule || !fromDue || !toDue || fromDue === toDue) return {};
  return { recurrenceRule: scope === 'series' ? shiftRule(rule, fromDue, toDue) : { ...rule, resumeFrom: rule.resumeFrom ?? fromDue } };
}

/** The bar moved `byDays`: start and due together. */
export function planShift(task: ApiTask, byDays: number, scope: MoveScope, timeZone: string): DatesPayload {
  const due = dueDayKey(task.dueDate, timeZone);
  // Only a start someone chose moves with it (the automatic one — when the task was made — stays: R11).
  const chosen = chosenStart(task.startDate);
  const start = dueDayKey(chosen, timeZone);
  return {
    ...(chosen && start ? { startDate: onDay(chosen, shiftDayKey(start, byDays), timeZone) } : {}),
    ...(task.dueDate && due ? { dueDate: onDay(task.dueDate, shiftDayKey(due, byDays), timeZone) } : {}),
    ...versioned(task),
    ...ruleFor(task, due, due ? shiftDayKey(due, byDays) : null, scope),
  };
}

/** One end dragged to `toDay`: that date alone; null when the start would come after the due day. */
export function planEdge(task: ApiTask, edge: 'start' | 'due', toDay: string, timeZone: string, scope: MoveScope = 'occurrence'): DatesPayload | null {
  const due = dueDayKey(task.dueDate, timeZone);
  const start = dueDayKey(chosenStart(task.startDate), timeZone);
  if (edge === 'start') {
    if (due && toDay > due) return null;
    return { startDate: toDay, ...versioned(task) };
  }
  if (start && toDay < start) return null;
  return { dueDate: task.dueDate ? onDay(task.dueDate, toDay, timeZone) : toDay, ...versioned(task), ...ruleFor(task, due, toDay, scope) };
}

/** A stored date as it is sent back: a day as 'YYYY-MM-DD', an instant as it was. */
const asSent = (v: string | null | undefined) => (v ? (isDateOnly(v) ? v.slice(0, 10) : v) : null);

/**
 * Undo: what the move changed, back as it was — both dates, or only the one that moved (`forward`: the
 * change being undone; without it, both) — and the repeat as it was.
 */
export function planDatesUndo(original: ApiTask, version: number | undefined, forward?: DatesPayload): DatesPayload {
  const all = !forward;
  return {
    ...(all || forward!.startDate !== undefined ? { startDate: asSent(original.startDate) } : {}),
    ...(all || forward!.dueDate !== undefined ? { dueDate: asSent(original.dueDate) } : {}),
    ...(version !== undefined ? { expectedVersion: version } : {}),
    ...(original.recurrenceRule && (all || forward!.recurrenceRule) ? { recurrenceRule: original.recurrenceRule } : {}),
  };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Fri 20 Nov" (with the year when it isn't this year's). */
export function dayWords(day: string, today: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${day.slice(0, 4) !== today.slice(0, 4) ? ` ${day.slice(0, 4)}` : ''}`;
}

/**
 * Tasks scheduled for the future (call 6): a task nobody has started (a Backlog or To-do kind of column,
 * not done, not handed in for approval) whose start moves after today waits for that day — the move says so.
 */
export function waitWords(task: Pick<ApiTask, 'columnCategory' | 'completedAt' | 'approvalRequestedAt'>, newStart: string | null, today: string): string | null {
  const notStarted = !task.completedAt && !task.approvalRequestedAt && ['BACKLOG', 'TODO'].includes(task.columnCategory ?? 'TODO');
  if (!notStarted || !newStart || newStart <= today) return null;
  return `It will wait until ${dayWords(newStart, today)}.`;
}

// ── Work blocks and meetings ───────────────────────────────────────────────

const MIN = 60_000;

/** A block moved to start at `toStart`: its length kept. */
export function blockMovePlan(block: { startAt: string; endAt: string }, toStart: string): { startAt: string; endAt: string } {
  const length = Date.parse(block.endAt) - Date.parse(block.startAt);
  return { startAt: new Date(toStart).toISOString(), endAt: new Date(Date.parse(toStart) + length).toISOString() };
}

/** A block's end dragged to `toEnd` (at least 15 minutes long; null otherwise). */
export function blockResizePlan(block: { startAt: string; endAt: string }, toEnd: string): { startAt: string; endAt: string } | null {
  if (Date.parse(toEnd) - Date.parse(block.startAt) < 15 * MIN) return null;
  return { startAt: block.startAt, endAt: new Date(toEnd).toISOString() };
}

/** A meeting moved to start at `toStart`: its length kept (one without an end lasts an hour). */
export function meetingMovePlan(meeting: { startAt: string; endAt: string | null }, toStart: string): { startAt: string; endAt: string } {
  const length = meeting.endAt ? Date.parse(meeting.endAt) - Date.parse(meeting.startAt) : 60 * MIN;
  return { startAt: new Date(toStart).toISOString(), endAt: new Date(Date.parse(toStart) + length).toISOString() };
}

/** Only its organizer drags a meeting, and only one still to come that is going ahead. */
export function canDragMeeting(m: { organizerId: string; cancelled: boolean; status: string; startAt: string }, myId: string, now: Date = new Date()): boolean {
  return m.organizerId === myId && !m.cancelled && m.status !== 'CANCELLED' && m.status !== 'COMPLETED' && Date.parse(m.startAt) > now.getTime();
}
