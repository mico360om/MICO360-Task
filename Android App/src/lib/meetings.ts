/**
 * Meetings in the app: which day and time each is in company time, where it is held and whether
 * it repeats. (The calendar's days are in lib/calendar*, 5a.)
 */
import type { ApiMeeting } from './types';
import { appTimeZone, zonedDayKey } from './due-date';
import { dateFormat } from './intl-cache';

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

/**
 * Open a meeting's online link with `open` (the phone's Linking.openURL) — checked here again, so
 * only a web (http/https) link is ever opened, whoever hands it over. False when it isn't one or the
 * phone couldn't open it (the caller says so).
 */
export async function openMeetingLink(href: string | null | undefined, open: (url: string) => Promise<unknown>): Promise<boolean> {
  const safe = safeMeetingHref(href);
  if (!safe) return false;
  try {
    await open(safe);
    return true;
  } catch {
    return false;
  }
}

/** The meeting's online link to open — web (http/https) links only, else null (safeMeetingHref). */
export function joinLink(m: Pick<ApiMeeting, 'onlineLink'>): string | null {
  return safeMeetingHref(m.onlineLink);
}

/** Part of a repeating series (its first meeting holds the rule; the others point at it). */
export function isRepeating(m: Pick<ApiMeeting, 'recurrenceRule' | 'recurrenceParentId'>): boolean {
  return !!(m.recurrenceRule || m.recurrenceParentId);
}
