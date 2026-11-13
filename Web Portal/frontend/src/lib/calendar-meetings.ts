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

/** A meeting from the list, with my own row and answer (the meetings list says them; older servers leave them out). */
export type ListedMeeting = Meeting & { myAttendeeId?: string | null; myResponse?: string | null };

/**
 * 1.23.29 — invited and not declined: the meeting reminders' rule (server meeting-reminders `reminderRecipients`:
 * the organiser, then each person on the meeting whose answer isn't DECLINED).
 */
export function invitedNotDeclined(m: Pick<ListedMeeting, 'myAttendeeId' | 'myResponse'>): boolean {
  return !!m.myAttendeeId && m.myResponse !== 'DECLINED';
}

/**
 * The meetings I'm invited to and haven't declined, for "My tasks" (filterCalendarMeetings' `invitedIds`). Kept
 * beside the items rather than in them: CalMeeting is the shape the Android app's and the extension's copies of
 * this file make (their drift tests compare it), and those copies don't change in this release.
 */
export function invitedMeetingIds(meetings: readonly ListedMeeting[]): Set<string> {
  return new Set(meetings.filter(invitedNotDeclined).map((m) => m.id));
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
}

export function meetingItems(meetings: ListedMeeting[], timeZone: string): CalMeeting[] {
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

/**
 * The calendar's filters, for meetings: task-only filters (status, priority, assignee) hide them. `invitedIds`
 * (1.23.29, invitedMeetingIds): the meetings I'm invited to and haven't declined, which "My tasks" keeps too.
 */
export function filterCalendarMeetings(items: CalMeeting[], f: CalendarFilters, ctx: { myId: string; invitedIds?: ReadonlySet<string> }): CalMeeting[] {
  if (!f.showMeetings || f.statuses.length || f.priorities.length || f.assigneeId) return [];
  const q = f.q.trim().toLocaleLowerCase('en');
  return items.filter((m) => {
    if (f.projectId && m.projectId !== f.projectId) return false;
    // "My tasks": meetings I organise, or am invited to and haven't declined (1.23.29).
    if (f.mine && m.organizerId !== ctx.myId && !ctx.invitedIds?.has(m.id)) return false;
    if (!f.showCompleted && m.status === 'COMPLETED') return false;
    if (q && !m.title.toLocaleLowerCase('en').includes(q)) return false;
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
