import type { BadgeTone } from '../components/ui/Badge';
import type { MeetingStatus, AttendanceStatus, MeetingNoteType, ActionItemStatus } from '../api/meetings';
import { dueDayKey, isOverdue } from './due-date';

export function actionStatusTone(status: ActionItemStatus): BadgeTone {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'IN_PROGRESS':
      return 'brand';
    case 'PENDING':
      return 'warning';
    case 'CANCELLED':
      return 'neutral';
    case 'OPEN':
    default:
      return 'info';
  }
}

/**
 * Short due-date label, e.g. "Oct 5" (or '' when missing). Due dates are calendar days, so the
 * label is built from the stored day itself and never shifted by the viewer's time zone.
 */
export function formatDueDate(iso: string | null, timeZone = 'Asia/Muscat'): string {
  if (!iso) return '';
  const key = dueDayKey(iso, timeZone);
  if (!key) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}T00:00:00Z`));
}

/** An action item is overdue once its due day is before today in the company time zone, while still open. */
export function isActionItemOverdue(
  item: { dueDate: string | null; status: ActionItemStatus },
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (item.status === 'COMPLETED' || item.status === 'CANCELLED') return false;
  return isOverdue(item.dueDate, timeZone, now);
}

export function noteTypeTone(type: MeetingNoteType): BadgeTone {
  switch (type) {
    case 'DECISION':
      return 'success';
    case 'ACTION':
      return 'brand';
    case 'ISSUE':
      return 'danger';
    case 'QUESTION':
      return 'warning';
    case 'INFORMATION':
      return 'info';
    case 'DISCUSSION':
    default:
      return 'neutral';
  }
}

export function meetingStatusTone(status: MeetingStatus): BadgeTone {
  switch (status) {
    case 'DRAFT':
      return 'neutral';
    case 'SCHEDULED':
      return 'info';
    case 'IN_PROGRESS':
      return 'brand';
    case 'COMPLETED':
      return 'success';
    case 'CANCELLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function attendanceTone(status: AttendanceStatus): BadgeTone {
  switch (status) {
    case 'PRESENT':
      return 'success';
    case 'LATE':
      return 'warning';
    case 'ABSENT':
      return 'danger';
    case 'EXCUSED':
      return 'info';
    case 'INVITED':
    default:
      return 'neutral';
  }
}

// ── Date/time in the company time zone ──────────────────────────────────────

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(kind: 'date' | 'time' | 'day', timeZone?: string): Intl.DateTimeFormat {
  const cacheKey = `${kind}|${timeZone ?? ''}`;
  let f = fmtCache.get(cacheKey);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions =
      kind === 'date'
        ? { weekday: 'short', month: 'short', day: 'numeric' }
        : kind === 'time'
          ? { hour: 'numeric', minute: '2-digit' }
          : { year: 'numeric', month: '2-digit', day: '2-digit' };
    try {
      f = new Intl.DateTimeFormat(kind === 'day' ? 'en-CA' : undefined, timeZone ? { ...opts, timeZone } : opts);
    } catch {
      f = new Intl.DateTimeFormat(kind === 'day' ? 'en-CA' : undefined, opts); // unknown zone → device zone
    }
    fmtCache.set(cacheKey, f);
  }
  return f;
}

/**
 * "Tue, Oct 1 · 9:00 AM – 10:30 AM" (or without end time), shown in `timeZone` — pass the company
 * zone so everyone sees the same wall-clock time. Falls back gracefully on bad input.
 */
export function formatMeetingRange(startAt: string, endAt: string | null, timeZone?: string): string {
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return '';
  const day = fmt('date', timeZone).format(start);
  const startTime = fmt('time', timeZone).format(start);
  if (!endAt) return `${day} · ${startTime}`;
  const end = new Date(endAt);
  if (Number.isNaN(end.getTime())) return `${day} · ${startTime}`;
  const sameDay = fmt('day', timeZone).format(start) === fmt('day', timeZone).format(end);
  const endTime = fmt('time', timeZone).format(end);
  return sameDay ? `${day} · ${startTime} – ${endTime}` : `${day} ${startTime} – ${fmt('date', timeZone).format(end)} ${endTime}`;
}

/** Short clock time for a note/event timestamp, e.g. "9:14 AM", in `timeZone` when given. */
export function formatClockTime(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : fmt('time', timeZone).format(d);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Offset (ms) of `timeZone` from UTC at `instant`. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Value for a datetime-local input from an ISO instant. With `timeZone` the wall-clock time is
 * shown in that zone (the company zone), otherwise in the device's zone.
 */
export function toLocalInputValue(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (!timeZone) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const shifted = new Date(d.getTime() + zoneOffsetMs(d.getTime(), timeZone));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/**
 * ISO instant from a datetime-local input value. With `timeZone` the value is read as wall-clock
 * time in that zone (so 10:00 means 10:00 in Muscat whatever the device's zone), otherwise as
 * device-local time.
 */
export function fromLocalInputValue(value: string, timeZone?: string): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return null;
  if (!timeZone) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const [, y, mo, d, h, mi, s] = m;
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  if (Number.isNaN(wall)) return null;
  // Two passes settle the offset across DST transitions.
  let instant = wall - zoneOffsetMs(wall, timeZone);
  instant = wall - zoneOffsetMs(instant, timeZone);
  return new Date(instant).toISOString();
}

/** A sensible default start: the next full hour, as a datetime-local value in `timeZone`. */
export function nextHourInputValue(timeZone?: string, now: Date = new Date()): string {
  const value = toLocalInputValue(new Date(now.getTime() + 60 * 60_000).toISOString(), timeZone);
  return value ? `${value.slice(0, 14)}00` : '';
}

// ── Online meeting links ─────────────────────────────────────────────────────

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const UNSAFE_SCHEME = /^\s*(javascript|data|vbscript|file|about|blob|mailto|tel|ftp)\s*:/i;

/**
 * Normalise what someone typed as a meeting's online link: trims it, adds `https://` when no
 * scheme was given (so `meet.google.com/abc` becomes a working link), and accepts only http(s)
 * URLs with a real host. Returns `null` for an empty value and `undefined` when it's not a valid
 * web link (e.g. `javascript:` or `data:`).
 */
export function normalizeMeetingLink(input: string | null | undefined): string | null | undefined {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  if (UNSAFE_SCHEME.test(raw)) return undefined;
  const candidate = HAS_SCHEME.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  const host = url.hostname;
  if (!host || (!host.includes('.') && host !== 'localhost')) return undefined;
  return url.href;
}

/** A safe href for a stored online link — normalised, and `null` for anything that isn't http(s). */
export function safeMeetingHref(link: string | null | undefined): string | null {
  return normalizeMeetingLink(link) ?? null;
}
