/**
 * Meetings on the calendar (5a), as on the website (Web Portal/frontend/src/lib/calendar-meetings.ts;
 * calendar-meetings.test.ts checks they agree): each on its day in the calendar's time zone, with
 * its times, whether it repeats and whether it's cancelled — filtered like the tasks where the
 * filters mean something for it. Meetings aren't moved from the calendar (the website doesn't).
 */
import type { ApiMeeting, MeetingStatus } from './types';
import type { CalendarFilters } from './calendar-model';
import { zonedDayKey } from './due-date';
import { meetingTime } from './meetings';
import { fromWallClock, seriesIdOf } from './meeting-form';
import { shiftDayKey } from './calendar';

export interface CalMeeting {
  key: string;
  id: string;
  title: string;
  /** 'YYYY-MM-DD' in the calendar's zone. */
  date: string;
  /** '10:00 – 11:00' (or just '10:00'). */
  time: string;
  startAt: string;
  status: MeetingStatus;
  projectId: string | null;
  organizerId: string;
  location: string | null;
  recurring: boolean;
  cancelled: boolean;
  /** The meeting itself (its row on the calendar, and its screen at once when tapped). */
  meeting: ApiMeeting;
}

export function meetingItems(meetings: ApiMeeting[], timeZone: string): CalMeeting[] {
  return [...meetings]
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .map((m) => ({
      key: `mtg:${m.id}`,
      id: m.id,
      title: m.title,
      date: zonedDayKey(new Date(m.startAt), timeZone),
      time: meetingTime(m, timeZone),
      startAt: m.startAt,
      status: m.status,
      projectId: m.projectId,
      organizerId: m.organizerId,
      location: m.location,
      recurring: !!seriesIdOf(m),
      cancelled: m.status === 'CANCELLED',
      meeting: m,
    }));
}

/** The calendar's filters, for meetings: task-only filters (status, priority, person) hide them. */
export function filterCalendarMeetings(items: CalMeeting[], f: CalendarFilters, ctx: { myId: string }): CalMeeting[] {
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

/** Meetings by day, earliest first. */
export function groupMeetingsByDay(items: CalMeeting[]): Map<string, CalMeeting[]> {
  const days = new Map<string, CalMeeting[]>();
  for (const m of items) days.set(m.date, [...(days.get(m.date) ?? []), m]);
  for (const list of days.values()) list.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  return days;
}

/** The start of a day in a zone; when this phone can't tell the zone's offset, a day early (never too late). */
function startOfDay(key: string, timeZone: string): string {
  return fromWallClock(key, '00:00', timeZone) ?? `${shiftDayKey(key, -1)}T00:00:00.000Z`;
}

/** The instants a range of days covers in the calendar's zone: [start of `from`, start of the day after `to`). */
export function meetingRange(from: string, to: string, timeZone: string): { from: string; to: string } {
  const end = fromWallClock(shiftDayKey(to, 1), '00:00', timeZone) ?? `${shiftDayKey(to, 2)}T00:00:00.000Z`;
  return { from: startOfDay(from, timeZone), to: end };
}
