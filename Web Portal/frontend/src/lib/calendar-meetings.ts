/**
 * Meetings on the calendar: each on its day in company time, with its times, whether it repeats
 * and whether it's cancelled — filtered like the tasks where the filters mean something for it.
 */
import { seriesIdOf, type Meeting, type MeetingStatus } from '../api/meetings';
import { shiftDayKey, zonedDayKey, zonedStartOfDay } from './due-date';
import type { CalendarFilters } from './calendar-model';

export interface CalMeeting {
  key: string;
  id: string;
  title: string;
  /** 'YYYY-MM-DD' in company time. */
  date: string;
  /** '10:00 – 11:00' (or just '10:00'), company time. */
  time: string;
  startAt: string;
  status: MeetingStatus;
  projectId: string | null;
  organizerId: string;
  location: string | null;
  recurring: boolean;
  cancelled: boolean;
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
}

export function meetingItems(meetings: Meeting[], timeZone: string): CalMeeting[] {
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

/** The calendar's filters, for meetings: task-only filters (status, priority, assignee) hide them. */
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

/** The instants a range of days covers in company time: [start of `from`, start of the day after `to`). */
export function meetingRange(from: string, to: string, timeZone: string): { from: string; to: string } {
  return { from: zonedStartOfDay(from, timeZone).toISOString(), to: zonedStartOfDay(shiftDayKey(to, 1), timeZone).toISOString() };
}
