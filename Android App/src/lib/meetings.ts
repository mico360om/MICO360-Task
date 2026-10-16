/**
 * Meetings in the app (read-only): which day and time each is in company time, where it is held,
 * whether it repeats, and the calendar's days with their tasks and meetings together.
 */
import type { ApiMeeting, ApiTask } from './types';
import { COMPANY_TIMEZONE, dueDayKey, zonedDayKey } from './due-date';

const DAY_MS = 86_400_000;

type Timed = Pick<ApiMeeting, 'startAt' | 'endAt'>;

/** The meeting's day ('YYYY-MM-DD') in company time. */
export function meetingDayKey(m: Pick<ApiMeeting, 'startAt'>, timeZone: string = COMPANY_TIMEZONE): string {
  return zonedDayKey(new Date(m.startAt), timeZone);
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
}

/** '10:00 – 11:00' (or just '10:00' without an end), in company time. */
export function meetingTime(m: Timed, timeZone: string = COMPANY_TIMEZONE): string {
  return m.endAt ? `${clock(m.startAt, timeZone)} – ${clock(m.endAt, timeZone)}` : clock(m.startAt, timeZone);
}

/** Where it's held: the room, else "Online" for a meeting with a link, else null. */
export function meetingPlace(m: Pick<ApiMeeting, 'location' | 'onlineLink'>): string | null {
  const room = m.location?.trim();
  if (room) return room;
  return m.onlineLink?.trim() ? 'Online' : null;
}

/** The meeting's online link to open — web (http/https) links only, else null. */
export function joinLink(m: Pick<ApiMeeting, 'onlineLink'>): string | null {
  const link = m.onlineLink?.trim();
  return link && /^https?:\/\/[^\s]+$/i.test(link) ? link : null;
}

/** Part of a repeating series (its first meeting holds the rule; the others point at it). */
export function isRepeating(m: Pick<ApiMeeting, 'recurrenceRule' | 'recurrenceParentId'>): boolean {
  return !!(m.recurrenceRule || m.recurrenceParentId);
}

/** The calendar's meetings: a week back and two months ahead of now. */
export function meetingWindow(now: Date = new Date()): { from: string; to: string } {
  return { from: new Date(now.getTime() - 7 * DAY_MS).toISOString(), to: new Date(now.getTime() + 60 * DAY_MS).toISOString() };
}

export interface AgendaDay {
  /** 'YYYY-MM-DD'. */
  date: string;
  tasks: ApiTask[];
  meetings: ApiMeeting[];
}

/** The calendar's days: tasks on their due day and meetings on their company-time day, earliest first. */
export function buildAgenda(tasks: ApiTask[], meetings: ApiMeeting[], timeZone: string = COMPANY_TIMEZONE): AgendaDay[] {
  const days = new Map<string, AgendaDay>();
  const dayOf = (date: string) => {
    let day = days.get(date);
    if (!day) days.set(date, (day = { date, tasks: [], meetings: [] }));
    return day;
  };
  for (const t of tasks) {
    const key = dueDayKey(t.dueDate, timeZone);
    if (key) dayOf(key).tasks.push(t);
  }
  for (const m of meetings) dayOf(meetingDayKey(m, timeZone)).meetings.push(m);
  return [...days.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((d) => ({
      ...d,
      tasks: d.tasks.sort((a, b) => Date.parse(a.dueDate as string) - Date.parse(b.dueDate as string)),
      meetings: d.meetings.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
    }));
}
