import type { Meeting, MeetingStatus } from '../api/meetings';
import { shiftDayKey, todayKey, zonedDayKey } from './due-date';

/** Date presets for the meetings list (days are counted in the company's time zone). */
export type DateRange = 'any' | 'today' | 'next7' | 'last7' | 'month' | 'last30' | 'custom';

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

export interface ListContext {
  timeZone: string;
  now: Date;
  projectName: (projectId: string) => string | null;
  organizerName: (userId: string) => string | null;
}

export type GroupKey = 'today' | 'upcoming' | 'drafts' | 'past';

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
 * Today, Upcoming, Drafts and Past (empty groups left out). Drafts are kept together whatever their
 * date. By date, Today and Upcoming read soonest first and Past most recent first.
 */
export function groupMeetings(list: Meeting[], ctx: Pick<ListContext, 'timeZone' | 'now'>, sort: MeetingSort): MeetingGroup[] {
  const today = todayKey(ctx.timeZone, ctx.now);
  const buckets: Record<GroupKey, Meeting[]> = { today: [], upcoming: [], drafts: [], past: [] };
  for (const m of list) {
    if (m.status === 'DRAFT') buckets.drafts.push(m);
    else {
      const day = dayOf(m, ctx.timeZone);
      buckets[day === today ? 'today' : day > today ? 'upcoming' : 'past'].push(m);
    }
  }
  const order = (key: GroupKey, items: Meeting[]): Meeting[] => {
    if (sort === 'title') return [...items].sort(byTitle);
    if (sort === 'updated') return [...items].sort(byUpdated);
    return key === 'past' ? [...items].sort(byStart).reverse() : [...items].sort(byStart);
  };
  const labels: Record<GroupKey, string> = { today: 'Today', upcoming: 'Upcoming', drafts: 'Drafts', past: 'Past' };
  return (['today', 'upcoming', 'drafts', 'past'] as GroupKey[])
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, label: labels[k], items: order(k, buckets[k]) }));
}
