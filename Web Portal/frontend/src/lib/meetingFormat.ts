import type { BadgeTone } from '../components/ui/Badge';
import type { MeetingStatus, AttendanceStatus, MeetingNoteType, ActionItemStatus } from '../api/meetings';

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

/** Short due-date label, e.g. "Oct 5" or "—". */
export function formatDueDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
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

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** "Tue, Oct 1 · 9:00 AM – 10:30 AM" (or without end time). Falls back gracefully on bad input. */
export function formatMeetingRange(startAt: string, endAt: string | null): string {
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return '';
  const day = dateFmt.format(start);
  const startTime = timeFmt.format(start);
  if (!endAt) return `${day} · ${startTime}`;
  const end = new Date(endAt);
  if (Number.isNaN(end.getTime())) return `${day} · ${startTime}`;
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${day} · ${startTime} – ${timeFmt.format(end)}`
    : `${day} ${startTime} – ${dateFmt.format(end)} ${timeFmt.format(end)}`;
}

/** Short clock time for a note/event timestamp, e.g. "9:14 AM". */
export function formatClockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : timeFmt.format(d);
}

/** Value for a datetime-local input (local time, no timezone), from an ISO string. */
export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO string from a datetime-local input value (interpreted as local time). */
export function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
