import { MEETING_STATUS_LABELS, type Meeting, type MeetingStatus } from '../api/meetings';
import { shiftDayKey, todayKey, zonedDayKey } from './due-date';
import { formatClockTime } from './meetingFormat';

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

export interface MeetingFilters {
  q: string;
  /** '' = every project, 'none' = standalone meetings only, else a project id. */
  projectId: string;
  status: MeetingStatus | 'ALL';
  range: DateRange;
  /** Custom range, 'YYYY-MM-DD' (either end may be open). */
  from?: string;
  to?: string;
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
  return f.q.trim() !== '' || f.projectId !== '' || f.status !== 'ALL' || f.range !== 'any';
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
  const q = f.q.trim().toLocaleLowerCase();
  const today = todayKey(ctx.timeZone, ctx.now);
  return list.filter((m) => {
    if (f.status !== 'ALL' && m.status !== f.status) return false;
    if (f.projectId === 'none' ? m.projectId !== null : f.projectId !== '' && m.projectId !== f.projectId) return false;
    if (f.range !== 'any' && !inRange(dayOf(m, ctx.timeZone), f, today)) return false;
    if (!q) return true;
    const haystack = [m.title, m.location, m.category, m.projectId ? ctx.projectName(m.projectId) : null, ctx.organizerName(m.organizerId)];
    return haystack.some((s) => s != null && s.toLocaleLowerCase().includes(q));
  });
}

const byStart = (a: Meeting, b: Meeting) => a.startAt.localeCompare(b.startAt);
const byTitle = (a: Meeting, b: Meeting) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
const byUpdated = (a: Meeting, b: Meeting) => b.updatedAt.localeCompare(a.updatedAt);

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
 * The meeting to feature as "Up next": one under way (the earliest to start), else the soonest
 * scheduled one still to come. Never a draft, a cancelled or a completed meeting.
 */
export function nextUpMeeting(list: Meeting[], now: Date): Meeting | null {
  const byStart = (a: Meeting, b: Meeting) => a.startAt.localeCompare(b.startAt);
  const live = list.filter((m) => isUnderWay(m, now)).sort(byStart);
  if (live[0]) return live[0];
  return list.filter((m) => m.status === 'SCHEDULED' && new Date(m.startAt).getTime() > now.getTime()).sort(byStart)[0] ?? null;
}

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
  return `${dayWords(day, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')} at ${time}`;
}

export interface FilterChip {
  key: 'project' | 'date' | 'status' | 'sort';
  label: string;
}

const longDay = (key: string) => dayWords(key, { day: 'numeric', month: 'short', year: 'numeric' });

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
  if (sort === 'title') chips.push({ key: 'sort', label: 'Sorted by title' });
  if (sort === 'updated') chips.push({ key: 'sort', label: 'Recently updated first' });
  return chips;
}
