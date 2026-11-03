import { MEETING_STATUS_LABELS, type Meeting, type MeetingStatus } from '../api/meetings';
import { shiftDayKey, todayKey, zonedDayKey } from './due-date';
import { formatClockTime } from './meetingFormat';
import { dayText } from './day-words';

/** Date presets for the meetings list (days are counted in the company's time zone). */
export type DateRange = 'any' | 'today' | 'next7' | 'last7' | 'month' | 'last30' | 'custom';

export const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: 'any', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: 'next7', label: 'Next 7 days' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range…' },
];

/**
 * The numbers above the list, each also a way to see just those meetings: still to come in the next
 * 7 days, with open action items, over without final minutes, and held this month.
 */
export type MeetingFocus = 'week' | 'actions' | 'minutes' | 'held';

export const FOCUSES: MeetingFocus[] = ['week', 'actions', 'minutes', 'held'];

/** What each number is called above the list… */
export const FOCUS_LABELS: Record<MeetingFocus, string> = {
  week: 'Next 7 days',
  actions: 'Open action items',
  minutes: 'Minutes to finish',
  held: 'Held this month',
};

/** …and the chip that says the list shows only those meetings. */
const FOCUS_CHIPS: Record<MeetingFocus, string> = {
  week: 'Next 7 days',
  actions: 'With open action items',
  minutes: 'Minutes to finish',
  held: 'Held this month',
};

export interface MeetingFilters {
  q: string;
  /** '' = every project, 'none' = standalone meetings only, else a project id. */
  projectId: string;
  status: MeetingStatus | 'ALL';
  range: DateRange;
  /** Custom range, 'YYYY-MM-DD' (either end may be open). */
  from?: string;
  to?: string;
  /** Only the meetings behind one of the numbers above the list. */
  focus?: MeetingFocus;
}

export const EMPTY_FILTERS: MeetingFilters = { q: '', projectId: '', status: 'ALL', range: 'any' };

export type MeetingSort = 'date' | 'title' | 'updated';

export const SORTS: { value: MeetingSort; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'updated', label: 'Recently updated' },
];

export interface ListContext {
  timeZone: string;
  now: Date;
  projectName: (projectId: string) => string | null;
  organizerName: (userId: string) => string | null;
}

export type GroupKey = 'today' | 'next7' | 'later' | 'drafts' | 'past';

export interface MeetingGroup {
  key: GroupKey;
  label: string;
  items: Meeting[];
}

export function hasActiveFilters(f: MeetingFilters): boolean {
  return f.q.trim() !== '' || f.projectId !== '' || f.status !== 'ALL' || f.range !== 'any' || f.focus !== undefined;
}

const dayOf = (m: Meeting, timeZone: string): string => zonedDayKey(new Date(m.startAt), timeZone);

function inRange(day: string, f: MeetingFilters, today: string): boolean {
  switch (f.range) {
    case 'today':
      return day === today;
    case 'next7':
      return day >= today && day <= shiftDayKey(today, 6);
    case 'last7':
      return day >= shiftDayKey(today, -6) && day <= today;
    case 'last30':
      return day >= shiftDayKey(today, -29) && day <= today;
    case 'month':
      return day.slice(0, 7) === today.slice(0, 7);
    case 'custom':
      return (!f.from || day >= f.from) && (!f.to || day <= f.to);
    default:
      return true;
  }
}

/** The meetings that match the search, project, status and date filters. */
export function filterMeetings(list: Meeting[], f: MeetingFilters, ctx: ListContext): Meeting[] {
  const q = f.q.trim().toLocaleLowerCase('en');
  const today = todayKey(ctx.timeZone, ctx.now);
  return list.filter((m) => {
    if (f.status !== 'ALL' && m.status !== f.status) return false;
    if (f.projectId === 'none' ? m.projectId !== null : f.projectId !== '' && m.projectId !== f.projectId) return false;
    if (f.range !== 'any' && !inRange(dayOf(m, ctx.timeZone), f, today)) return false;
    if (f.focus && !inFocus(m, f.focus, ctx, today)) return false;
    if (!q) return true;
    const haystack = [m.title, m.location, m.category, m.projectId ? ctx.projectName(m.projectId) : null, ctx.organizerName(m.organizerId)];
    return haystack.some((s) => s != null && s.toLocaleLowerCase('en').includes(q));
  });
}

const byStart = (a: Meeting, b: Meeting) => a.startAt.localeCompare(b.startAt, 'en');
const byTitle = (a: Meeting, b: Meeting) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
const byUpdated = (a: Meeting, b: Meeting) => b.updatedAt.localeCompare(a.updatedAt, 'en');

/**
 * Today, Next 7 days, Later, Drafts and Past (empty groups left out). Drafts are kept together
 * whatever their date. By date, the days to come read soonest first and Past most recent first.
 */
export function groupMeetings(list: Meeting[], ctx: Pick<ListContext, 'timeZone' | 'now'>, sort: MeetingSort): MeetingGroup[] {
  const today = todayKey(ctx.timeZone, ctx.now);
  const weekEnd = shiftDayKey(today, 7);
  const buckets: Record<GroupKey, Meeting[]> = { today: [], next7: [], later: [], drafts: [], past: [] };
  for (const m of list) {
    if (m.status === 'DRAFT') buckets.drafts.push(m);
    else {
      const day = dayOf(m, ctx.timeZone);
      buckets[day === today ? 'today' : day < today ? 'past' : day <= weekEnd ? 'next7' : 'later'].push(m);
    }
  }
  const order = (key: GroupKey, items: Meeting[]): Meeting[] => {
    if (sort === 'title') return [...items].sort(byTitle);
    if (sort === 'updated') return [...items].sort(byUpdated);
    return key === 'past' ? [...items].sort(byStart).reverse() : [...items].sort(byStart);
  };
  const labels: Record<GroupKey, string> = { today: 'Today', next7: 'Next 7 days', later: 'Later', drafts: 'Drafts', past: 'Past' };
  return (['today', 'next7', 'later', 'drafts', 'past'] as GroupKey[])
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, label: labels[k], items: order(k, buckets[k]) }));
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** Is the meeting under way? Started and not yet ended (a meeting without an end lasts an hour). */
export function isUnderWay(m: Pick<Meeting, 'status' | 'startAt' | 'endAt'>, now: Date): boolean {
  if (m.status === 'IN_PROGRESS') return true;
  if (m.status !== 'SCHEDULED') return false;
  const start = new Date(m.startAt).getTime();
  const end = m.endAt ? new Date(m.endAt).getTime() : start + HOUR;
  return start <= now.getTime() && now.getTime() < end;
}

/**
 * Is the meeting over? Finished, or scheduled and past its end (an hour after its start when it has
 * none). A meeting under way, a draft or a cancelled one is not.
 */
export function hasEnded(m: Pick<Meeting, 'status' | 'startAt' | 'endAt'>, now: Date): boolean {
  if (m.status === 'COMPLETED') return true;
  if (m.status !== 'SCHEDULED') return false;
  const start = new Date(m.startAt).getTime();
  const end = m.endAt ? new Date(m.endAt).getTime() : start + HOUR;
  return end <= now.getTime();
}

/** Does the meeting count towards one of the numbers above the list? */
function inFocus(m: Meeting, focus: MeetingFocus, ctx: Pick<ListContext, 'timeZone' | 'now'>, today: string): boolean {
  switch (focus) {
    case 'week':
      // Still to come (or under way), from today to the sixth day after: the "Next 7 days" date filter's days.
      return (m.status === 'SCHEDULED' || m.status === 'IN_PROGRESS') && !hasEnded(m, ctx.now) && dayOf(m, ctx.timeZone) <= shiftDayKey(today, 6);
    case 'actions':
      return (m.openActionItemCount ?? 0) > 0;
    case 'minutes':
      return hasEnded(m, ctx.now) && m.minutes !== undefined && m.minutes !== 'FINAL';
    case 'held':
      return hasEnded(m, ctx.now) && dayOf(m, ctx.timeZone).slice(0, 7) === today.slice(0, 7);
  }
}

export interface MeetingSummary {
  /** Meetings still to come in the next 7 days. */
  week: number;
  /** Open action items, all told… */
  actions: number;
  /** …and how many meetings they are in. */
  actionMeetings: number;
  /** Meetings that are over without final minutes. */
  minutes: number;
  /** Meetings held this month. */
  held: number;
}

/** The numbers above the list, from the meetings it already has (each matches its focus filter). */
export function meetingSummary(list: Meeting[], ctx: Pick<ListContext, 'timeZone' | 'now'>): MeetingSummary {
  const today = todayKey(ctx.timeZone, ctx.now);
  const count = (focus: MeetingFocus) => list.filter((m) => inFocus(m, focus, ctx, today)).length;
  return {
    week: count('week'),
    actions: list.reduce((sum, m) => sum + (m.openActionItemCount ?? 0), 0),
    actionMeetings: count('actions'),
    minutes: count('minutes'),
    held: count('held'),
  };
}

/** The most recent meeting that is over (none when nothing has happened yet). */
export function lastMeeting(list: Meeting[], now: Date): Meeting | null {
  return list.filter((m) => hasEnded(m, now)).sort((a, b) => b.startAt.localeCompare(a.startAt, 'en'))[0] ?? null;
}

/** When a past meeting was, from today: "earlier today", "yesterday", "on Monday", "on Sat 3 Oct", "on 1 Dec 2025". */
export function whenItWas(iso: string, now: Date, timeZone: string): string {
  const today = todayKey(timeZone, now);
  const day = zonedDayKey(new Date(iso), timeZone);
  if (day >= today) return 'earlier today';
  if (day === shiftDayKey(today, -1)) return 'yesterday';
  if (day >= shiftDayKey(today, -6)) return `on ${dayWords(day, { weekday: 'long' })}`;
  if (day.slice(0, 4) === today.slice(0, 4)) return `on ${dayText(day, { weekday: 'short', year: false })}`;
  return `on ${dayText(day)}`;
}

/**
 * The meeting to feature as "Up next": one under way (the earliest to start), else the soonest
 * scheduled one still to come. Never a draft, a cancelled or a completed meeting.
 */
export function nextUpMeeting(list: Meeting[], now: Date): Meeting | null {
  const byStart = (a: Meeting, b: Meeting) => a.startAt.localeCompare(b.startAt, 'en');
  const live = list.filter((m) => isUnderWay(m, now)).sort(byStart);
  if (live[0]) return live[0];
  return list.filter((m) => m.status === 'SCHEDULED' && new Date(m.startAt).getTime() > now.getTime()).sort(byStart)[0] ?? null;
}

/** A weekday's full name ("Monday") for a 'YYYY-MM-DD' day; other day words come from lib/day-words ("Sep", never "Sept"). */
const dayWords = (key: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));

/** When the meeting starts, from now: "Happening now", "in 25 min", "Tomorrow at 10:00", "Tue 20 Oct at 10:00". */
export function startsLabel(m: Pick<Meeting, 'status' | 'startAt' | 'endAt'>, now: Date, timeZone: string): string {
  if (isUnderWay(m, now)) return 'Happening now';
  const ms = new Date(m.startAt).getTime() - now.getTime();
  if (ms < MINUTE) return 'Starting now';
  if (ms < HOUR) return `in ${Math.floor(ms / MINUTE)} min`;
  const today = todayKey(timeZone, now);
  const day = zonedDayKey(new Date(m.startAt), timeZone);
  const time = formatClockTime(m.startAt, timeZone);
  if (day === today) return `Today at ${time}`;
  if (day === shiftDayKey(today, 1)) return `Tomorrow at ${time}`;
  if (day > today && day <= shiftDayKey(today, 6)) return `${dayWords(day, { weekday: 'long' })} at ${time}`;
  return `${dayText(day, { weekday: 'short', year: false })} at ${time}`;
}

export interface FilterChip {
  key: 'project' | 'date' | 'status' | 'sort' | 'focus';
  label: string;
}

const longDay = (key: string) => dayText(key);

/** Each filter in use as a short label (and a sort other than by date), to show and remove one by one. */
export function filterChips(f: MeetingFilters, sort: MeetingSort, ctx: Pick<ListContext, 'projectName'>): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.projectId === 'none') chips.push({ key: 'project', label: 'Standalone meetings only' });
  else if (f.projectId) chips.push({ key: 'project', label: `Project: ${ctx.projectName(f.projectId) ?? 'a project'}` });
  if (f.range === 'custom') {
    const span = f.from && f.to ? `${longDay(f.from)} – ${longDay(f.to)}` : f.from ? `from ${longDay(f.from)}` : f.to ? `until ${longDay(f.to)}` : 'any';
    chips.push({ key: 'date', label: `Date: ${span}` });
  } else if (f.range !== 'any') chips.push({ key: 'date', label: `Date: ${DATE_RANGES.find((r) => r.value === f.range)?.label ?? f.range}` });
  if (f.status !== 'ALL') chips.push({ key: 'status', label: `Status: ${MEETING_STATUS_LABELS[f.status]}` });
  if (f.focus) chips.push({ key: 'focus', label: FOCUS_CHIPS[f.focus] });
  if (sort === 'title') chips.push({ key: 'sort', label: 'Sorted by title' });
  if (sort === 'updated') chips.push({ key: 'sort', label: 'Recently updated first' });
  return chips;
}
