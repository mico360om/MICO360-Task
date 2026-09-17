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
}

export interface IcsEvent {
  method: IcsMethod;
  uid: string;
  sequence?: number;
  start: Date;
  end?: Date | null;
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
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${event.prodId ?? '-//MICO360//Meetings//EN'}`,
    'CALSCALE:GREGORIAN',
    `METHOD:${event.method}`,
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `SEQUENCE:${event.sequence ?? 0}`,
    `DTSTAMP:${formatUtc(event.stamp ?? new Date())}`,
    `DTSTART:${formatUtc(event.start)}`,
  ];
  if (event.end) lines.push(`DTEND:${formatUtc(event.end)}`);
  lines.push(`SUMMARY:${escapeText(event.summary)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push(person('ORGANIZER', event.organizer));
  for (const a of event.attendees ?? []) lines.push(person('ATTENDEE', a));
  if (event.recurrence) lines.push(`RRULE:${recurrenceToRrule(event.recurrence)}`);
  lines.push(`STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
