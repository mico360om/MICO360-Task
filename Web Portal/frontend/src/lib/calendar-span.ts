/**
 * Calendar scheduling (owner, 11 Nov 2026): a task across the calendar from its start to its due day —
 * one bar with ▶ at the start and ⚑ at the due day; a due-only task stays on its day; a task longer than
 * three weeks shows only its two marks. These sit BESIDE calendar-model.ts's buildItems (due day only),
 * which the Android app's drift tests compare with its own copy (call 5) — the app keeps due-only.
 * The server's copy of the rule is modules/calendar/calendar-span.ts.
 */
import type { ApiTask } from '../api/tasks';
import { dueDayKey } from './due-date';
import { zonedClock } from './working-days';
import { statusOf, type CalItem, type CalendarData } from './calendar-model';

/** Longest bar, in days from start to due; longer tasks show only their two marks. */
export const MAX_SPAN_DAYS = 21;

export type SpanMode = 'bar' | 'markers' | 'due' | 'start';

const daysApart = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/**
 * A start someone chose: a day (every form, the calendar and templates send days). The server fills a start
 * nobody chose with the moment the task was made (an instant) — that one draws nothing (ruling R11), so the
 * task shows on its due day, as before. The server's copy: modules/calendar/calendar-span.ts.
 */
export function chosenStart(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0 ? value : null;
}

/** A task's start and due days and how it is drawn (null: no dates at all). */
export function spanOf(task: Pick<ApiTask, 'startDate' | 'dueDate'>, timeZone: string): { start: string | null; due: string | null; mode: SpanMode } | null {
  const due = dueDayKey(task.dueDate, timeZone);
  const start = dueDayKey(chosenStart(task.startDate), timeZone);
  if (!due) return start ? { start, due: null, mode: 'start' } : null;
  if (!start || start >= due) return { start: null, due, mode: 'due' };
  return { start, due, mode: daysApart(start, due) > MAX_SPAN_DAYS ? 'markers' : 'bar' };
}

/** A calendar item with its span: `date` (as CalItem) is its due day, else its start day. */
export interface SpanItem extends CalItem {
  start: string | null;
  due: string | null;
  mode: SpanMode;
  /** A timed due date: its minutes after midnight (the calendar's zone) — its ⚑ sits at that time in Week and Day. */
  dueMinutes: number | null;
}

interface SpanContext {
  today: string;
  timeZone: string;
  projectStatus: (projectId: string) => string | undefined;
}

const isTimed = (iso: string | null | undefined) => {
  if (!iso || /^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && !(d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0);
};

/**
 * Each task once — those due in the range and those shown by their span — then the projected copies of
 * repeating ones (on their day, as today). Status as everywhere: overdue by the due day; a task with a
 * start and no due day is never overdue.
 */
export function buildSpanItems(data: CalendarData & { spanning?: ApiTask[] }, ctx: SpanContext): SpanItem[] {
  const items: SpanItem[] = [];
  const seen = new Set<string>();
  for (const t of [...data.tasks, ...(data.spanning ?? [])]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const s = spanOf(t, ctx.timeZone);
    if (!s) continue;
    items.push({
      key: t.id,
      kind: 'task',
      task: t,
      date: (s.due ?? s.start)!,
      status: statusOf(t, s.due ?? '9999-12-31', ctx.today),
      projectArchived: ctx.projectStatus(t.projectId) === 'ARCHIVED',
      recurring: !!(t.recurrenceRule || t.recurrenceParentId),
      start: s.start,
      due: s.due,
      mode: s.mode,
      dueMinutes: s.due && isTimed(t.dueDate) ? zonedClock(new Date(t.dueDate!), ctx.timeZone).minutes : null,
    });
  }
  const heads = new Map(data.series.map((h) => [h.id, h]));
  for (const o of data.occurrences) {
    const head = heads.get(o.taskId);
    const status = head ? ctx.projectStatus(head.projectId) : undefined;
    if (!head || status === 'ARCHIVED' || status === 'COMPLETED') continue;
    items.push({ key: `proj:${head.id}:${o.date}`, kind: 'projected', task: head, date: o.date, status: 'projected', projectArchived: false, recurring: true, start: null, due: o.date, mode: 'due', dueMinutes: null });
  }
  return items;
}

/** How a task shows on one day: its bar's start ▶, its due day ⚑, a day in between, or a one-day item. */
export function roleOnDay(item: SpanItem, day: string): 'start' | 'due' | 'middle' | 'single' | null {
  if (item.mode === 'bar') {
    if (day === item.start) return 'start';
    if (day === item.due) return 'due';
    return day > item.start! && day < item.due! ? 'middle' : null;
  }
  if (item.mode === 'markers') return day === item.start ? 'start' : day === item.due ? 'due' : null;
  if (item.mode === 'start') return day === item.start ? 'start' : null;
  return day === item.due ? 'single' : null;
}

// ── Month weeks: segments in lanes ───────────────────────────────────────────

export type SegRole = 'bar' | 'start' | 'due' | 'single';

export interface WeekSegment<T = SpanItem> {
  item: T;
  startCol: number;
  endCol: number;
  role: SegRole;
  /** Its ▶ shows here (the task really starts in this week). */
  startsHere: boolean;
  /** Its ⚑ shows here (the task is really due in this week). */
  endsHere: boolean;
}

/** The week's segments of each item: a bar cut to the week, a long task's marks and one-day items as one-day segments. */
export function weekSegments(week: readonly string[], items: readonly SpanItem[]): WeekSegment[] {
  const first = week[0]!;
  const last = week[week.length - 1]!;
  const col = (d: string) => week.indexOf(d);
  const inWeek = (d: string | null): d is string => d !== null && d >= first && d <= last;
  const out: WeekSegment[] = [];
  for (const item of items) {
    if (item.mode === 'bar') {
      if (item.start! > last || item.due! < first) continue;
      out.push({ item, startCol: inWeek(item.start) ? col(item.start) : 0, endCol: inWeek(item.due) ? col(item.due) : week.length - 1, role: 'bar', startsHere: inWeek(item.start), endsHere: inWeek(item.due) });
    } else if (item.mode === 'markers') {
      if (inWeek(item.start)) out.push({ item, startCol: col(item.start), endCol: col(item.start), role: 'start', startsHere: true, endsHere: false });
      if (inWeek(item.due)) out.push({ item, startCol: col(item.due), endCol: col(item.due), role: 'due', startsHere: false, endsHere: true });
    } else if (item.mode === 'start') {
      if (inWeek(item.start)) out.push({ item, startCol: col(item.start), endCol: col(item.start), role: 'start', startsHere: true, endsHere: false });
    } else if (inWeek(item.due)) {
      out.push({ item, startCol: col(item.due), endCol: col(item.due), role: 'single', startsHere: false, endsHere: true });
    }
  }
  return out;
}

/** Lanes: the longest first, then by start, then `order`, each in the lowest lane free over its days. */
export function packLanes<S extends { startCol: number; endCol: number; order: number }>(segments: readonly S[]): (S & { lane: number })[] {
  const sorted = [...segments].sort((a, b) => b.endCol - b.startCol - (a.endCol - a.startCol) || a.startCol - b.startCol || a.order - b.order);
  const used: boolean[][] = [];
  return sorted.map((s) => {
    let lane = 0;
    for (; ; lane++) {
      const row = (used[lane] ??= []);
      let free = true;
      for (let c = s.startCol; c <= s.endCol; c++) if (row[c]) free = false;
      if (free) {
        for (let c = s.startCol; c <= s.endCol; c++) row[c] = true;
        break;
      }
    }
    return { ...s, lane };
  });
}

/**
 * How many lanes a week shows in `rows` rows: all when they fit (or the height isn't known); else all but
 * the last row, which says "+N more" on each day with more.
 */
export function laneView(placed: readonly { startCol: number; endCol: number; lane: number }[], rows: number | undefined, days = 7): { lanes: number; more: number[] } {
  const total = placed.reduce((n, p) => Math.max(n, p.lane + 1), 0);
  const more = Array.from({ length: days }, () => 0);
  if (rows === undefined || total <= rows) return { lanes: total, more };
  const lanes = Math.max(0, rows - 1);
  for (const p of placed) if (p.lane >= lanes) for (let c = p.startCol; c <= p.endCol; c++) more[c]! += 1;
  return { lanes, more };
}
