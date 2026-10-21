/**
 * The Meetings tab's list, as on the website (Web Portal/frontend/src/lib/meeting-list.ts; the
 * tests check both behave alike): the search, the project / status / date filters and their chips,
 * the groups (Today, Next 7 days, Later, Drafts, Past), the meeting shown as "Up next", and the rows
 * the list draws. Days are the company's (appTimeZone). A custom date range needs a date picker,
 * which the app doesn't have yet, so the phone offers the presets only.
 */
import type { ApiMeeting, MeetingStatus } from './types';
import { appTimeZone, zonedDayKey } from './due-date';
import { dateFormat } from './intl-cache';
import { clockTime, isRepeating, meetingPlace } from './meetings';
import { MEETING_STATUS_LABELS, meetingWhen, minutesBadge } from './meeting-detail';

export type DateRange = 'any' | 'today' | 'next7' | 'last7' | 'month' | 'last30';

export const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: 'any', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: 'next7', label: 'Next 7 days' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'last30', label: 'Last 30 days' },
];

export interface MeetingFilters {
  q: string;
  /** '' = every project, 'none' = standalone meetings only, else a project id. */
  projectId: string;
  status: MeetingStatus | 'ALL';
  range: DateRange;
}

export const EMPTY_FILTERS: MeetingFilters = { q: '', projectId: '', status: 'ALL', range: 'any' };

export type MeetingSort = 'date' | 'title' | 'updated';

export const SORTS: { value: MeetingSort; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'updated', label: 'Recently updated' },
];

/** The statuses offered in the filter, in the website's order. */
export const STATUS_CHOICES: MeetingStatus[] = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'DRAFT', 'CANCELLED'];

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
  items: ApiMeeting[];
}

/** Shift a 'YYYY-MM-DD' key by whole days (noon-UTC arithmetic avoids DST edges). */
function shiftDayKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dayOf = (m: Pick<ApiMeeting, 'startAt'>, timeZone: string): string => zonedDayKey(new Date(m.startAt), timeZone);

export function hasActiveFilters(f: MeetingFilters): boolean {
  return f.q.trim() !== '' || f.projectId !== '' || f.status !== 'ALL' || f.range !== 'any';
}

function inRange(day: string, range: DateRange, today: string): boolean {
  switch (range) {
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
    default:
      return true;
  }
}

/** The meetings that match the search, project, status and date filters. */
export function filterMeetings(list: ApiMeeting[], f: MeetingFilters, ctx: ListContext): ApiMeeting[] {
  const q = f.q.trim().toLocaleLowerCase();
  const today = zonedDayKey(ctx.now, ctx.timeZone);
  return list.filter((m) => {
    if (f.status !== 'ALL' && m.status !== f.status) return false;
    if (f.projectId === 'none' ? m.projectId !== null : f.projectId !== '' && m.projectId !== f.projectId) return false;
    if (f.range !== 'any' && !inRange(dayOf(m, ctx.timeZone), f.range, today)) return false;
    if (!q) return true;
    const haystack = [m.title, m.location, m.category, m.projectId ? ctx.projectName(m.projectId) : null, ctx.organizerName(m.organizerId)];
    return haystack.some((s) => s != null && s.toLocaleLowerCase().includes(q));
  });
}

/** ISO instants sort as text; a plain comparison (localeCompare is slow on the phone). */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byStart = (a: ApiMeeting, b: ApiMeeting) => compare(a.startAt, b.startAt);
const byTitle = (a: ApiMeeting, b: ApiMeeting) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
const byUpdated = (a: ApiMeeting, b: ApiMeeting) => compare(b.updatedAt ?? '', a.updatedAt ?? '');

const GROUP_LABELS: Record<GroupKey, string> = { today: 'Today', next7: 'Next 7 days', later: 'Later', drafts: 'Drafts', past: 'Past' };

/**
 * Today, Next 7 days, Later, Drafts and Past (empty groups left out). Drafts are kept together
 * whatever their date. By date, the days to come read soonest first and Past most recent first.
 */
export function groupMeetings(list: ApiMeeting[], ctx: Pick<ListContext, 'timeZone' | 'now'>, sort: MeetingSort): MeetingGroup[] {
  const today = zonedDayKey(ctx.now, ctx.timeZone);
  const weekEnd = shiftDayKey(today, 7);
  const buckets: Record<GroupKey, ApiMeeting[]> = { today: [], next7: [], later: [], drafts: [], past: [] };
  for (const m of list) {
    if (m.status === 'DRAFT') buckets.drafts.push(m);
    else {
      const day = dayOf(m, ctx.timeZone);
      buckets[day === today ? 'today' : day < today ? 'past' : day <= weekEnd ? 'next7' : 'later'].push(m);
    }
  }
  const order = (key: GroupKey, items: ApiMeeting[]): ApiMeeting[] => {
    if (sort === 'title') return [...items].sort(byTitle);
    if (sort === 'updated') return [...items].sort(byUpdated);
    return key === 'past' ? [...items].sort(byStart).reverse() : [...items].sort(byStart);
  };
  return (['today', 'next7', 'later', 'drafts', 'past'] as GroupKey[])
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, label: GROUP_LABELS[k], items: order(k, buckets[k]) }));
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** Is the meeting under way? Started and not yet ended (a meeting without an end lasts an hour). */
export function isUnderWay(m: Pick<ApiMeeting, 'status' | 'startAt' | 'endAt'>, now: Date): boolean {
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
export function nextUpMeeting(list: ApiMeeting[], now: Date): ApiMeeting | null {
  const live = list.filter((m) => isUnderWay(m, now)).sort(byStart);
  if (live[0]) return live[0];
  return list.filter((m) => m.status === 'SCHEDULED' && new Date(m.startAt).getTime() > now.getTime()).sort(byStart)[0] ?? null;
}

const dayWords = (key: string, opts: Intl.DateTimeFormatOptions) => dateFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));

/** When the meeting starts, from now: "Happening now", "in 25 min", "Tomorrow at 10:00", "Tue 20 Oct at 10:00". */
export function startsLabel(m: Pick<ApiMeeting, 'status' | 'startAt' | 'endAt'>, now: Date, timeZone: string = appTimeZone()): string {
  if (isUnderWay(m, now)) return 'Happening now';
  const ms = new Date(m.startAt).getTime() - now.getTime();
  if (ms < MINUTE) return 'Starting now';
  if (ms < HOUR) return `in ${Math.floor(ms / MINUTE)} min`;
  const today = zonedDayKey(now, timeZone);
  const day = zonedDayKey(new Date(m.startAt), timeZone);
  const time = clockTime(m.startAt, timeZone);
  if (day === today) return `Today at ${time}`;
  if (day === shiftDayKey(today, 1)) return `Tomorrow at ${time}`;
  if (day > today && day <= shiftDayKey(today, 6)) return `${dayWords(day, { weekday: 'long' })} at ${time}`;
  return `${dayWords(day, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')} at ${time}`;
}

export interface FilterChip {
  key: 'project' | 'date' | 'status' | 'sort';
  label: string;
}

/** Each filter in use as a short label (and a sort other than by date), to show and remove one by one. */
export function filterChips(f: MeetingFilters, sort: MeetingSort, ctx: Pick<ListContext, 'projectName'>): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.projectId === 'none') chips.push({ key: 'project', label: 'Standalone meetings only' });
  else if (f.projectId) chips.push({ key: 'project', label: `Project: ${ctx.projectName(f.projectId) ?? 'a project'}` });
  if (f.range !== 'any') chips.push({ key: 'date', label: `Date: ${DATE_RANGES.find((r) => r.value === f.range)?.label ?? f.range}` });
  if (f.status !== 'ALL') chips.push({ key: 'status', label: `Status: ${MEETING_STATUS_LABELS[f.status]}` });
  if (sort === 'title') chips.push({ key: 'sort', label: 'Sorted by title' });
  if (sort === 'updated') chips.push({ key: 'sort', label: 'Recently updated first' });
  return chips;
}

/** "No attendees yet", "1 person", "4 people". */
export function peopleText(m: Pick<ApiMeeting, 'attendeeCount' | 'attendees'>): string {
  const n = m.attendeeCount ?? m.attendees?.length ?? 0;
  if (!n) return 'No attendees yet';
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

/**
 * What TalkBack reads for a meeting's card: its title, day, time and place, the project (or
 * standalone) and organizer, who is coming, its status when it isn't simply scheduled (or "Under
 * way"), how far the minutes are, decisions, open action items, and whether it repeats.
 */
export function meetingCardLabel(m: ApiMeeting, ctx: ListContext, locale?: string, statusShown = true): string {
  const when = meetingWhen(m, ctx.timeZone, locale);
  const organizer = ctx.organizerName(m.organizerId);
  const decisions = m.decisionCount ?? 0;
  const open = m.openActionItemCount ?? 0;
  const status = isUnderWay(m, ctx.now) ? 'Under way' : m.status !== 'SCHEDULED' && statusShown ? MEETING_STATUS_LABELS[m.status] : null;
  return [
    m.title,
    when.day,
    when.time,
    meetingPlace(m),
    m.projectId ? ctx.projectName(m.projectId) ?? 'A project' : 'Standalone',
    organizer ? `organized by ${organizer}` : null,
    peopleText(m),
    status,
    minutesBadge(m.minutes)?.label,
    decisions ? `${decisions} ${decisions === 1 ? 'decision' : 'decisions'}` : null,
    open ? `${open} open action ${open === 1 ? 'item' : 'items'}` : null,
    isRepeating(m) ? 'repeats' : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** One row of the Meetings list: a group's heading, or a meeting. */
export type MeetingListRow =
  | { kind: 'group'; key: string; group: GroupKey; label: string; count: number }
  /** `statusShown` is false where the heading already says it (a draft among Drafts). */
  | { kind: 'meeting'; key: string; group: GroupKey; meeting: ApiMeeting; statusShown: boolean };

/** The groups as the rows of one list (a FlatList): each heading, then its meetings. */
export function meetingListRows(groups: MeetingGroup[]): MeetingListRow[] {
  return groups.flatMap((g): MeetingListRow[] => [
    { kind: 'group', key: `group:${g.key}`, group: g.key, label: g.label, count: g.items.length },
    ...g.items.map((m): MeetingListRow => ({ kind: 'meeting', key: `${g.key}:${m.id}`, group: g.key, meeting: m, statusShown: g.key !== 'drafts' })),
  ]);
}

/** How far back a slimmed offline copy of the list keeps meetings that are over. */
export const PAST_KEPT_DAYS = 90;

/** The list without meetings that started more than PAST_KEPT_DAYS ago (for an offline copy too long to keep whole). */
export function withoutOldMeetings(now: number): (list: ApiMeeting[]) => ApiMeeting[] {
  const since = now - PAST_KEPT_DAYS * 86_400_000;
  return (list) =>
    list.filter((m) => {
      const at = Date.parse(m.startAt);
      return Number.isNaN(at) || at >= since;
    });
}
