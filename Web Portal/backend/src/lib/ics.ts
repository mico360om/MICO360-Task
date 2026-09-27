/**
 * Dependency-free iCalendar (RFC 5545) builder for meeting invites, updates and
 * cancellations. Produces a single VEVENT suitable for attaching to an email so
 * calendar clients (Outlook, Google, Apple) can add/update/remove the event.
 */

export type IcsMethod = 'REQUEST' | 'CANCEL';

export interface IcsPerson {
  name?: string | null;
  email: string;
  /** REQUIRED (default) or OPTIONAL — maps to REQ-PARTICIPANT / OPT-PARTICIPANT. */
  role?: 'REQUIRED' | 'OPTIONAL';
}

export interface IcsRecurrence {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  interval: number;
  count?: number | null;
  until?: string | null; // ISO
  /** 0=Sunday … 6=Saturday. */
  weekdays?: number[];
  dayOfMonth?: number;
  /** A paused series is sent as a single occurrence (no RRULE). */
  paused?: boolean;
}

export interface IcsEvent {
  method: IcsMethod;
  uid: string;
  sequence?: number;
  start: Date;
  end?: Date | null;
  /**
   * IANA zone the meeting is scheduled in. Recurring events are anchored in it
   * (DTSTART;TZID=… plus a VTIMEZONE) so BYDAY weekdays follow local time, not UTC.
   */
  timeZone?: string | null;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  organizer: IcsPerson;
  attendees?: IcsPerson[];
  recurrence?: IcsRecurrence | null;
  /** Overrides DTSTAMP (defaults to now) — injectable for deterministic tests. */
  stamp?: Date;
  prodId?: string;
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** iCalendar UTC timestamp: YYYYMMDDTHHMMSSZ. */
function formatUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Escape a TEXT value per RFC 5545 §3.3.11 (backslash, semicolon, comma, newline). */
function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line to <=75 octets, continuation lines start with a space (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  // First line takes 75 octets; continuations take 74 (a leading space costs one octet).
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split a multi-byte UTF-8 sequence: back up while the next byte is a continuation byte.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    const chunk = bytes.subarray(start, end).toString('utf8');
    out.push(start === 0 ? chunk : ` ${chunk}`);
    start = end;
    limit = 74;
  }
  return out.join('\r\n');
}

function recurrenceToRrule(r: IcsRecurrence): string {
  const parts: string[] = [];
  if (r.freq === 'QUARTERLY') {
    parts.push('FREQ=MONTHLY', `INTERVAL=${Math.max(1, r.interval) * 3}`);
  } else {
    parts.push(`FREQ=${r.freq}`, `INTERVAL=${Math.max(1, r.interval)}`);
  }
  if (r.weekdays && r.weekdays.length) {
    parts.push(`BYDAY=${r.weekdays.map((d) => BYDAY[((d % 7) + 7) % 7]).join(',')}`);
  }
  if (r.dayOfMonth) parts.push(`BYMONTHDAY=${r.dayOfMonth}`);
  if (r.count != null) parts.push(`COUNT=${r.count}`);
  else if (r.until) {
    const u = new Date(r.until);
    if (!Number.isNaN(u.getTime())) parts.push(`UNTIL=${formatUtc(u)}`);
  }
  return parts.join(';');
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Offset of a time zone from UTC at an instant, in minutes (throws for an unknown zone). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / MINUTE_MS);
}

/** Wall-clock time of an instant at a fixed offset: YYYYMMDDTHHMMSS (no Z). */
function formatLocal(instant: Date, offsetMin: number): string {
  return formatUtc(new Date(instant.getTime() + offsetMin * MINUTE_MS)).replace(/Z$/, '');
}

function formatOffset(min: number): string {
  const a = Math.abs(min);
  return `${min < 0 ? '-' : '+'}${pad2(Math.floor(a / 60))}${pad2(a % 60)}`;
}

/** UTC-offset changes of a zone during one calendar year (to the minute). */
function transitionsInYear(timeZone: string, year: number): { at: Date; from: number; to: number }[] {
  const out: { at: Date; from: number; to: number }[] = [];
  const end = Date.UTC(year + 1, 0, 1);
  let prev = offsetMinutes(new Date(Date.UTC(year, 0, 1)), timeZone);
  for (let t = Date.UTC(year, 0, 1) + DAY_MS; t <= end; t += DAY_MS) {
    const off = offsetMinutes(new Date(t), timeZone);
    if (off === prev) continue;
    let lo = t - DAY_MS;
    let hi = t;
    while (hi - lo > MINUTE_MS) {
      const mid = lo + Math.floor((hi - lo) / (2 * MINUTE_MS)) * MINUTE_MS;
      if (offsetMinutes(new Date(mid), timeZone) === prev) lo = mid;
      else hi = mid;
    }
    out.push({ at: new Date(hi), from: prev, to: off });
    prev = off;
  }
  return out;
}

/**
 * VTIMEZONE for a zone, derived from its offsets in the event's year: a single STANDARD
 * block for fixed-offset zones (e.g. Asia/Muscat), yearly STANDARD/DAYLIGHT rules for DST zones.
 */
function vtimezone(timeZone: string, around: Date): string[] {
  const year = new Date(around.getTime() + offsetMinutes(around, timeZone) * MINUTE_MS).getUTCFullYear();
  const changes = transitionsInYear(timeZone, year);
  const lines = ['BEGIN:VTIMEZONE', `TZID:${timeZone}`];
  if (changes.length === 0) {
    const off = formatOffset(offsetMinutes(around, timeZone));
    lines.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${off}`, `TZOFFSETTO:${off}`, 'END:STANDARD');
  } else {
    for (const c of changes) {
      const kind = c.to > c.from ? 'DAYLIGHT' : 'STANDARD';
      const local = new Date(c.at.getTime() + c.from * MINUTE_MS); // wall clock just before the change
      lines.push(`BEGIN:${kind}`, `DTSTART:${formatLocal(c.at, c.from)}`, `TZOFFSETFROM:${formatOffset(c.from)}`, `TZOFFSETTO:${formatOffset(c.to)}`);
      // Two changes a year follow a weekday rule ("last Sunday of October"); anything else is listed as-is.
      if (changes.length === 2) {
        const dom = local.getUTCDate();
        const daysInMonth = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
        const nth = dom + 7 > daysInMonth ? -1 : Math.ceil(dom / 7);
        lines.push(`RRULE:FREQ=YEARLY;BYMONTH=${local.getUTCMonth() + 1};BYDAY=${nth}${BYDAY[local.getUTCDay()]}`);
      }
      lines.push(`END:${kind}`);
    }
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

/** The zone to anchor a recurring event in, or null to keep plain UTC times. */
function anchorZone(event: IcsEvent): string | null {
  const tz = event.timeZone;
  if (!tz || !event.recurrence || event.recurrence.paused || /^(Etc\/)?(UTC|GMT)$/i.test(tz)) return null;
  try {
    offsetMinutes(event.start, tz);
    return tz;
  } catch {
    return null; // unknown zone: fall back to UTC rather than emit a broken calendar
  }
}

function person(prop: 'ORGANIZER' | 'ATTENDEE', p: IcsPerson): string {
  const params: string[] = [];
  if (p.name) params.push(`CN=${p.name.replace(/[;:,]/g, ' ')}`);
  if (prop === 'ATTENDEE') {
    params.push(`ROLE=${p.role === 'OPTIONAL' ? 'OPT-PARTICIPANT' : 'REQ-PARTICIPANT'}`);
    params.push('RSVP=TRUE');
  }
  return `${prop}${params.length ? `;${params.join(';')}` : ''}:mailto:${p.email}`;
}

/** Build a complete iCalendar document (VCALENDAR with one VEVENT). */
export function buildIcs(event: IcsEvent): string {
  const cancel = event.method === 'CANCEL';
  const tz = anchorZone(event);
  const when = (prop: 'DTSTART' | 'DTEND', d: Date) =>
    tz ? `${prop};TZID=${tz}:${formatLocal(d, offsetMinutes(d, tz))}` : `${prop}:${formatUtc(d)}`;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${event.prodId ?? '-//MICO360//Meetings//EN'}`,
    'CALSCALE:GREGORIAN',
    `METHOD:${event.method}`,
    ...(tz ? vtimezone(tz, event.start) : []),
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `SEQUENCE:${event.sequence ?? 0}`,
    `DTSTAMP:${formatUtc(event.stamp ?? new Date())}`,
    when('DTSTART', event.start),
  ];
  if (event.end) lines.push(when('DTEND', event.end));
  lines.push(`SUMMARY:${escapeText(event.summary)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push(person('ORGANIZER', event.organizer));
  for (const a of event.attendees ?? []) lines.push(person('ATTENDEE', a));
  if (event.recurrence && !event.recurrence.paused) lines.push(`RRULE:${recurrenceToRrule(event.recurrence)}`);
  lines.push(`STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
