/**
 * Meetings in the app (read-only): which day and time each is in company time, where it is held,
 * whether it repeats, and the calendar's days with their tasks and meetings together.
 */
import type { ApiMeeting, ApiTask } from './types';
import { appTimeZone, dueDayKey, zonedDayKey } from './due-date';
import { dateFormat } from './intl-cache';

const DAY_MS = 86_400_000;

type Timed = Pick<ApiMeeting, 'startAt' | 'endAt'>;

/** The meeting's day ('YYYY-MM-DD') in company time. */
export function meetingDayKey(m: Pick<ApiMeeting, 'startAt'>, timeZone: string = appTimeZone()): string {
  return zonedDayKey(new Date(m.startAt), timeZone);
}

/** '10:05' — the 24-hour time of an instant in the zone given ('' for a bad date). */
export function clockTime(iso: string, timeZone: string = appTimeZone()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return dateFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(d);
}

/** '10:00 – 11:00' (or just '10:00' without an end), in company time. */
export function meetingTime(m: Timed, timeZone: string = appTimeZone()): string {
  return m.endAt ? `${clockTime(m.startAt, timeZone)} – ${clockTime(m.endAt, timeZone)}` : clockTime(m.startAt, timeZone);
}

/** Where it's held: the room, else "Online" for a meeting with a link, else null. */
export function meetingPlace(m: Pick<ApiMeeting, 'location' | 'onlineLink'>): string | null {
  const room = m.location?.trim();
  if (room) return room;
  return m.onlineLink?.trim() ? 'Online' : null;
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const UNSAFE_SCHEME = /^\s*(javascript|data|vbscript|file|about|blob|mailto|tel|ftp)\s*:/i;
/** scheme://[user@]host[:port][/path?query#fragment] — no spaces in the host. */
const WEB_URL = /^(https?):\/\/(?:([^\s/?#@]*)@)?([^\s/?#:@]+)(?::(\d*))?([/?#].*)?$/i;

/**
 * A safe address for a meeting's online link, as the website's safeMeetingHref gives it: trimmed,
 * `https://` added when no scheme was typed (`meet.google.com/abc` works), and only http(s) links
 * with a real host — null for anything else (`javascript:`, `intent:`, `tel:`…). Written without
 * `URL`, which React Native only partly has.
 */
export function safeMeetingHref(link: string | null | undefined): string | null {
  const raw = (link ?? '').trim();
  if (!raw || UNSAFE_SCHEME.test(raw) || raw.includes('\\')) return null;
  const candidate = HAS_SCHEME.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
  const m = WEB_URL.exec(candidate);
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  const host = m[3]!.toLowerCase();
  if (!host.includes('.') && host !== 'localhost') return null;
  let port = '';
  if (m[4]) {
    const n = Number(m[4]);
    if (n > 65535) return null;
    if (!((scheme === 'http' && n === 80) || (scheme === 'https' && n === 443))) port = `:${n}`;
  }
  const rest = m[5] ?? '';
  if (/[^\S ]/.test(rest)) return null; // tabs, new lines
  const path = (rest.startsWith('/') ? rest : `/${rest}`).replace(/ /g, '%20');
  return `${scheme}://${m[2] !== undefined ? `${m[2]}@` : ''}${host}${port}${path}`;
}

/**
 * What TalkBack reads for a meeting in a list (the calendar, a project): its day and time, title,
 * place, and whether it repeats or was cancelled. Tapping it opens the meeting, where its notes are.
 */
export function meetingRowLabel(
  m: Pick<ApiMeeting, 'title' | 'status' | 'startAt' | 'endAt' | 'location' | 'onlineLink' | 'recurrenceRule' | 'recurrenceParentId'>,
  opts: { showDate?: string; timeZone?: string } = {},
): string {
  return ['Meeting', opts.showDate, meetingTime(m, opts.timeZone), m.title, meetingPlace(m), isRepeating(m) ? 'repeats' : null, m.status === 'CANCELLED' ? 'cancelled' : null]
    .filter(Boolean)
    .join(', ');
}

/** The meeting's online link to open — web (http/https) links only, else null (safeMeetingHref). */
export function joinLink(m: Pick<ApiMeeting, 'onlineLink'>): string | null {
  return safeMeetingHref(m.onlineLink);
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
export function buildAgenda(tasks: ApiTask[], meetings: ApiMeeting[], timeZone: string = appTimeZone()): AgendaDay[] {
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
