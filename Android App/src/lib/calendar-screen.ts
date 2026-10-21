/**
 * The calendar screen's own small rules (5a), free of React: which day the month opens on, the
 * agenda's days, where a new task goes, what the screen says, and the view and filters it keeps
 * while the app is open.
 */
import { DEFAULT_FILTERS, type CalendarFilters, type CalItem } from './calendar-model';
import type { CalMeeting } from './calendar-meetings';
import { dayLabel, rangeLabel, shiftDayKey, type CalendarView, type WeekStart } from './calendar';

/** Overdue tasks listed before "Show all" in the agenda (the website's number). */
export const OVERDUE_PREVIEW = 8;

/**
 * The day chosen in the month: the one you tapped while it is in the month shown, else today when
 * the month holds it, else the month's first day (the website's phone month).
 */
export function chosenDay(cursor: string, today: string, selected: string | null): string {
  const month = cursor.slice(0, 7);
  if (selected && selected.slice(0, 7) === month) return selected;
  return today.slice(0, 7) === month ? today : `${month}-01`;
}

/** The day "+" adds a task on: the chosen day in the month, otherwise the day the calendar shows. */
export function createDay(view: CalendarView, cursor: string, chosen: string): string {
  return view === 'month' ? chosen : cursor;
}

/**
 * The agenda's days with something on them, in order: from today when the range holds it (the
 * earlier ones behind "Show earlier days"), else all of them.
 */
export function agendaDays(keys: Iterable<string>, opts: { from: string; to: string; today: string; showEarlier: boolean }): { earlier: string[]; listed: string[] } {
  const days = [...new Set(keys)].filter((d) => d >= opts.from && d <= opts.to).sort();
  const hasToday = opts.today >= opts.from && opts.today <= opts.to;
  const earlier = hasToday ? days.filter((d) => d < opts.today) : [];
  const listed = hasToday && !opts.showEarlier ? days.filter((d) => d >= opts.today) : days;
  return { earlier, listed };
}

export type CalendarRow =
  | { key: string; type: 'meeting'; meeting: CalMeeting }
  | { key: string; type: 'task'; item: CalItem }
  | { key: string; type: 'empty'; text: string }
  | { key: string; type: 'more'; text: string };

export interface CalendarSection {
  key: string;
  /** The day the section is (none for Overdue). */
  day?: string;
  title: string;
  today: boolean;
  data: CalendarRow[];
}

export interface SectionInput {
  view: CalendarView;
  from: string;
  to: string;
  today: string;
  /** The month's chosen day. */
  chosen: string;
  weekStart: WeekStart;
  byDay: Map<string, CalItem[]>;
  meetingsByDay: Map<string, CalMeeting[]>;
  /** The agenda's overdue tasks (already filtered). */
  overdue: CalItem[];
  showEarlier: boolean;
  allOverdue: boolean;
  filtered: boolean;
}

/**
 * What the list under the calendar shows: the month's chosen day; the week's seven days; or the
 * agenda — overdue work first (eight, then "Show all"), then the days with something on them from
 * today (`earlier` counts the days before it, behind a button). Each day lists its meetings first.
 */
export function calendarSections(p: SectionInput): { sections: CalendarSection[]; earlier: number } {
  const day = (d: string): CalendarSection => {
    const rows: CalendarRow[] = [
      ...(p.meetingsByDay.get(d) ?? []).map((m): CalendarRow => ({ key: m.key, type: 'meeting', meeting: m })),
      ...(p.byDay.get(d) ?? []).map((item): CalendarRow => ({ key: item.key, type: 'task', item })),
    ];
    if (rows.length === 0) rows.push({ key: `empty:${d}`, type: 'empty', text: p.filtered ? 'Nothing due with these filters.' : 'Nothing due.' });
    return { key: `day:${d}`, day: d, title: dayLabel(d, { weekday: 'long', day: true, month: 'long' }), today: d === p.today, data: rows };
  };
  if (p.view === 'month') return { sections: [day(p.chosen)], earlier: 0 };
  if (p.view === 'week') {
    const days: string[] = [];
    for (let d = p.from; d <= p.to && days.length < 7; d = shiftDayKey(d, 1)) days.push(d);
    return { sections: days.map(day), earlier: 0 };
  }
  const { earlier, listed } = agendaDays([...p.byDay.keys(), ...p.meetingsByDay.keys()], { from: p.from, to: p.to, today: p.today, showEarlier: p.showEarlier });
  const sections: CalendarSection[] = [];
  if (p.overdue.length > 0) {
    const shown = p.allOverdue ? p.overdue : p.overdue.slice(0, OVERDUE_PREVIEW);
    const rows: CalendarRow[] = shown.map((item) => ({ key: `overdue:${item.key}`, type: 'task', item }));
    if (p.overdue.length > OVERDUE_PREVIEW) rows.push({ key: 'more-overdue', type: 'more', text: p.allOverdue ? 'Show fewer' : `Show all ${p.overdue.length} overdue tasks` });
    sections.push({ key: 'overdue', title: `Overdue · ${p.overdue.length}`, today: false, data: rows });
  }
  sections.push(...listed.map(day));
  return { sections, earlier: earlier.length };
}

type ProjectLike = { id: string; status: string };

const open = (p: ProjectLike) => p.status !== 'ARCHIVED' && p.status !== 'COMPLETED';

/** A task can be added from the calendar while one of your projects is still open. */
export function canCreateIn(projects: ProjectLike[]): boolean {
  return projects.some(open);
}

/** The project a new task starts in: the one the calendar is filtered to, while it is open; null = pick one. */
export function newTaskProject(filterProjectId: string, projects: ProjectLike[]): string | null {
  const p = filterProjectId ? projects.find((x) => x.id === filterProjectId) : undefined;
  return p && open(p) ? p.id : null;
}

/** "Nothing is due in October 2026." (or, filtered, that nothing matches). */
export function nothingText(period: string, filtered: boolean): string {
  return filtered ? `No tasks match these filters in ${period}.` : `Nothing is due in ${period}.`;
}

/** Offline, which days the phone's copy holds (null when the server answered). */
export function offlineNote(saved: { from: string; to: string; covers: boolean } | null): string | null {
  if (!saved) return null;
  return saved.covers ? 'You’re offline — showing what this phone saved.' : `You’re offline — this phone has only ${rangeLabel(saved.from, saved.to)} saved.`;
}

/** Which zone the days are in (the website's legend). */
export function timeZoneNote(company: string, own: string | null): string {
  return own ? `Dates in ${own} (your setting)` : `Dates in ${company} (company time)`;
}

export interface CalendarPlace {
  view: CalendarView;
  /** The day shown ('YYYY-MM-DD'); null = today. */
  date: string | null;
  filters: CalendarFilters;
}

const START: CalendarPlace = { view: 'month', date: null, filters: DEFAULT_FILTERS };

/**
 * The view, day and filters the calendar was left at, kept while the app is open (the website
 * keeps them in its address) — for the person who left them only.
 */
export function createPlaceMemory() {
  let kept: { userId: string; place: CalendarPlace } | null = null;
  return {
    get(userId: string | null | undefined): CalendarPlace {
      return userId && kept?.userId === userId ? kept.place : START;
    },
    set(userId: string | null | undefined, place: CalendarPlace): void {
      kept = userId ? { userId, place } : null;
    },
  };
}

/** The app's one memory of where the calendar was. */
export const calendarPlace = createPlaceMemory();
