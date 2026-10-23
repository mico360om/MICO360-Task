/**
 * The calendar's rules, as the website's (Web Portal/frontend/src/lib/calendar.ts, calendar-model.ts,
 * calendar-meetings.ts, components/calendar/calendar-ui.tsx and pages/CalendarPage.tsx): the days a
 * view shows and asks GET /calendar for, each task's status on its day (red is for overdue only), the
 * copies repeating tasks will make, the meetings in those days, the filters, and the words a screen
 * reader hears. src/calendar.test.js runs these and the web's over the same inputs. Pure (no DOM).
 */
import { dueDayKey, zonedDayKey, zonedStartOfDay, shiftDayKey } from './due-date.js';

// ---- days -----------------------------------------------------------------------------------

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The seven weekday names in the order the week starts (0 Sunday, 1 Monday, 6 Saturday). */
export function weekdayLabels(weekStart = 0) {
  return Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT[(weekStart + i) % 7]);
}

/** A 6-week grid for the month (0 = January), starting on `weekStart`, with the days around it. */
export function monthGrid(year, month0, weekStart = 0) {
  const first = new Date(Date.UTC(year, month0, 1));
  const cur = new Date(first);
  cur.setUTCDate(1 - ((first.getUTCDay() - weekStart + 7) % 7));
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const week = [];
    for (let d = 0; d < 7; d += 1) {
      week.push({ key: cur.toISOString().slice(0, 10), day: cur.getUTCDate(), inMonth: cur.getUTCMonth() === month0 });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Only the weeks that touch the month (4 to 6). */
export function monthWeeks(year, month0, weekStart = 0) {
  return monthGrid(year, month0, weekStart).filter((week) => week.some((c) => c.inMonth));
}

/** The 7 days of the week holding `dateKey`, starting on `weekStart`. */
export function weekDays(dateKey, weekStart = 0) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - weekStart + 7) % 7));
  return Array.from({ length: 7 }, () => {
    const key = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
    return key;
  });
}

/** The first day of the month `months` away from the month holding `dateKey`. */
export function shiftMonth(dateKey, months) {
  const [y, m] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}

export function monthOf(dateKey) {
  const [y, m] = dateKey.split('-').map(Number);
  return { year: y, month0: m - 1 };
}

export const VIEWS = ['month', 'week', 'agenda'];

/** The days a view shows — and asks the server for: the month's weeks, the week, or the month as a list. */
export function visibleRange(view, cursor, weekStart = 0) {
  if (view === 'week') {
    const days = weekDays(cursor, weekStart);
    return { from: days[0], to: days[6] };
  }
  const { year, month0 } = monthOf(cursor);
  if (view === 'agenda') {
    const last = new Date(Date.UTC(year, month0 + 1, 0)).toISOString().slice(0, 10);
    return { from: `${cursor.slice(0, 7)}-01`, to: last };
  }
  const flat = monthWeeks(year, month0, weekStart).flat();
  return { from: flat[0].key, to: flat[flat.length - 1].key };
}

/** 'Sat 10 Oct' for a day (the parts asked for, in the order weekday, day, month, year). */
export function dayLabel(key, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const parts = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).formatToParts(new Date(`${key}T12:00:00.000Z`));
  const part = (type) => (parts.find((p) => p.type === type) || {}).value;
  return ['weekday', 'day', 'month', 'year'].map(part).filter(Boolean).join(' ');
}

/** The period a view shows: "October 2026", or "4 – 10 Oct 2026" for a week. */
export function periodLabel(view, cursor, weekStart = 0) {
  if (view !== 'week') return dayLabel(cursor, { month: 'long', year: 'numeric' });
  const days = weekDays(cursor, weekStart);
  const [a, b] = [days[0], days[6]];
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  const sameMonth = sameYear && a.slice(0, 7) === b.slice(0, 7);
  const start = dayLabel(a, sameMonth ? { day: 'numeric' } : sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return `${start} – ${dayLabel(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

// ---- your date settings ---------------------------------------------------------------------

function validZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Your date settings (Settings → Calendar on the website, `GET /users/me/preferences`): your own
 * time zone when you chose one, else the company's; the week from Sunday unless you chose Monday or
 * Saturday. As the web's useDateSettings.
 */
export function dateSettings(prefs, companyTimeZone) {
  const own = prefs && validZone(prefs.timeZone) ? prefs.timeZone : null;
  const ws = prefs && (prefs.weekStart === 1 || prefs.weekStart === 6) ? prefs.weekStart : 0;
  return { timeZone: own || companyTimeZone, ownTimeZone: own, companyTimeZone, weekStart: ws };
}

/** Which zone the dates are in, in the web's words. */
export function timeNote(settings) {
  return settings.ownTimeZone ? `Dates in ${settings.ownTimeZone} (your setting)` : `Dates in ${settings.timeZone} (company time)`;
}

// ---- what a range shows ---------------------------------------------------------------------

const isTaskDone = (t) => t.columnCategory === 'DONE' || !!t.completedAt;

/** A task's status on its day: done; overdue (red only for this); blocked; in progress; to do. */
export function statusOf(task, day, today) {
  if (isTaskDone(task)) return 'done';
  if (day < today) return 'overdue';
  if (task.columnCategory === 'BLOCKED') return 'blocked';
  if (task.columnCategory === 'IN_PROGRESS' || task.columnCategory === 'REVIEW') return 'in-progress';
  return 'todo';
}

/**
 * The items of GET /calendar's answer: each task on its due day, and each copy a repeating task will
 * make (`kind: 'projected'`, `task` its newest copy) — none in an archived or completed project.
 */
export function buildItems(data, ctx) {
  const items = [];
  for (const t of data.tasks || []) {
    const date = dueDayKey(t.dueDate, ctx.timeZone);
    if (!date) continue;
    items.push({
      key: t.id, kind: 'task', task: t, date, status: statusOf(t, date, ctx.today),
      projectArchived: ctx.projectStatus(t.projectId) === 'ARCHIVED', recurring: !!(t.recurrenceRule || t.recurrenceParentId),
    });
  }
  const heads = new Map((data.series || []).map((s) => [s.id, s]));
  for (const o of data.occurrences || []) {
    const head = heads.get(o.taskId);
    const status = head ? ctx.projectStatus(head.projectId) : undefined;
    if (!head || status === 'ARCHIVED' || status === 'COMPLETED') continue;
    items.push({ key: `proj:${head.id}:${o.date}`, kind: 'projected', task: head, date: o.date, status: 'projected', projectArchived: false, recurring: true });
  }
  return items;
}

/** The web's filters (the extension offers Only mine, Done, Repeats and Meetings). */
export const DEFAULT_FILTERS = {
  projectId: '', assigneeId: '', mine: false, q: '', statuses: [], priorities: [],
  showCompleted: true, showArchived: false, showProjected: true, showMeetings: true,
};

export function applyFilters(items, f, ctx) {
  const q = f.q.trim().toLocaleLowerCase();
  return items.filter((i) => {
    const t = i.task;
    if (!f.showArchived && i.projectArchived) return false;
    if (!f.showCompleted && i.status === 'done') return false;
    if (!f.showProjected && i.kind === 'projected') return false;
    if (f.projectId && t.projectId !== f.projectId) return false;
    if (f.assigneeId && !(t.assignees || []).some((a) => a.id === f.assigneeId)) return false;
    if (f.mine && !(t.assignees || []).some((a) => a.id === ctx.myId)) return false;
    if (f.statuses.length && !f.statuses.includes(i.status === 'projected' ? 'todo' : i.status)) return false;
    if (f.priorities.length && !f.priorities.includes(t.priority)) return false;
    if (q && !t.title.toLocaleLowerCase().includes(q) && !t.key.toLocaleLowerCase().includes(q)) return false;
    return true;
  });
}

/** The filters in the address, with the web's names — only what differs from the default. */
export function filtersToQuery(f) {
  const out = {};
  if (f.mine) out.mine = '1';
  if (!f.showCompleted) out.done = '0';
  if (!f.showProjected) out.repeats = '0';
  if (!f.showMeetings) out.meetings = '0';
  return out;
}

export function filtersFromQuery(q = {}) {
  return {
    ...DEFAULT_FILTERS,
    mine: q.mine === '1',
    showCompleted: q.done !== '0',
    showProjected: q.repeats !== '0',
    showMeetings: q.meetings !== '0',
  };
}

const ORDER = { overdue: 0, blocked: 1, 'in-progress': 2, todo: 3, projected: 4, done: 5 };
const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** Items by day, each day's most urgent first (status, then priority, then title). */
export function groupByDay(items) {
  const days = new Map();
  for (const i of items) days.set(i.date, [...(days.get(i.date) || []), i]);
  for (const list of days.values()) {
    list.sort((a, b) => ORDER[a.status] - ORDER[b.status] || PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] || a.task.title.localeCompare(b.task.title));
  }
  return days;
}

/** Each status in words (never colour alone), as the web's legend. */
export const STATUS_LABEL = {
  overdue: 'Overdue', blocked: 'Blocked', 'in-progress': 'In progress', todo: 'To do', done: 'Done', projected: 'Repeats (not created yet)',
};
const PRIORITY_WORD = { URGENT: 'urgent', HIGH: 'high' };

/** What a screen reader hears for a task on the calendar. */
export function itemName(item) {
  const t = item.task;
  const parts = [t.title];
  if (item.kind === 'projected') parts.push(`repeat, not created yet, ${dayLabel(item.date)}`);
  else parts.push(STATUS_LABEL[item.status].toLowerCase());
  if (item.kind === 'task' && item.recurring) parts.push('repeats');
  if (PRIORITY_WORD[t.priority]) parts.push(`${PRIORITY_WORD[t.priority]} priority`);
  return parts.join(', ');
}

// ---- meetings -------------------------------------------------------------------------------

/** The first meeting of a meeting's series (its own id for the first), or null for a one-off. */
export function seriesIdOf(m) {
  return m.recurrenceParentId || (m.recurrenceRule ? m.id : null);
}

function clock(iso, timeZone) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
}

/** Meetings on the calendar, earliest first: each on its day in `timeZone`, with its times. */
export function meetingItems(meetings, timeZone) {
  return [...meetings]
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .map((m) => ({
      key: `mtg:${m.id}`,
      id: m.id,
      title: m.title,
      date: zonedDayKey(new Date(m.startAt), timeZone),
      time: m.endAt ? `${clock(m.startAt, timeZone)} – ${clock(m.endAt, timeZone)}` : clock(m.startAt, timeZone),
      startAt: m.startAt,
      status: m.status,
      projectId: m.projectId,
      organizerId: m.organizerId,
      location: m.location,
      recurring: !!seriesIdOf(m),
      cancelled: m.status === 'CANCELLED',
    }));
}

/** The filters, for meetings: "Only mine" keeps the ones you organize (as on the web). */
export function filterCalendarMeetings(items, f, ctx) {
  if (!f.showMeetings || f.statuses.length || f.priorities.length || f.assigneeId) return [];
  const q = f.q.trim().toLocaleLowerCase();
  return items.filter((m) => {
    if (f.projectId && m.projectId !== f.projectId) return false;
    if (f.mine && m.organizerId !== ctx.myId) return false;
    if (!f.showCompleted && m.status === 'COMPLETED') return false;
    if (q && !m.title.toLocaleLowerCase().includes(q)) return false;
    return true;
  });
}

export function groupMeetingsByDay(items) {
  const days = new Map();
  for (const m of items) days.set(m.date, [...(days.get(m.date) || []), m]);
  for (const list of days.values()) list.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  return days;
}

/** The instants the days `from`–`to` cover in `timeZone`: [start of `from`, start of the day after `to`). */
export function meetingRange(from, to, timeZone) {
  return { from: zonedStartOfDay(from, timeZone).toISOString(), to: zonedStartOfDay(shiftDayKey(to, 1), timeZone).toISOString() };
}

/** What a screen reader hears for a meeting on the calendar. */
export function meetingName(m) {
  return [m.title, `meeting, ${m.time}`, m.cancelled ? 'cancelled' : null, m.recurring ? 'repeats' : null].filter(Boolean).join(', ');
}
