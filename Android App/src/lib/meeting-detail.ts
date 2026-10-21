/**
 * Pure helpers behind the meeting screens (read-only, apart from answering your own invitation):
 * the labels and tones the website uses, your invitation and its answer, the people, agenda,
 * action items and minutes in words. Times are in the zone given (the company's by default).
 */
import { ApiError, isNetworkError } from './api-client';
import { appTimeZone, companyTodayKey, dueDayKey, formatDueDay } from './due-date';
import { clockTime } from './meetings';
import { dateFormat } from './intl-cache';
import type { Tone } from './tone';
import type {
  ActionItemStatus,
  ApiActionItem,
  ApiFinalMinutes,
  ApiMeeting,
  ApiMeetingAttendee,
  ApiMeetingNote,
  AttendanceStatus,
  InvitationResponse,
  MeetingNoteType,
  MeetingStatus,
  MinutesState,
} from './types';

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const RESPONSE_LABELS: Record<InvitationResponse, string> = {
  PENDING: 'No response',
  ACCEPTED: 'Accepted',
  TENTATIVE: 'Maybe',
  DECLINED: 'Declined',
};

/** Attendance on the day. INVITED is simply "not recorded yet". */
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  INVITED: 'Not recorded',
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  EXCUSED: 'Excused',
};

export const ACTION_STATUS_LABELS: Record<ActionItemStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const NOTE_TYPE_LABELS: Record<MeetingNoteType, string> = {
  DISCUSSION: 'Discussion',
  DECISION: 'Decision',
  ACTION: 'Action Item',
  ISSUE: 'Issue',
  QUESTION: 'Question',
  INFORMATION: 'Information',
};

const STATUS_TONE: Record<MeetingStatus, Tone> = { DRAFT: 'neutral', SCHEDULED: 'info', IN_PROGRESS: 'brand', COMPLETED: 'success', CANCELLED: 'danger' };
const RESPONSE_TONE: Record<InvitationResponse, Tone> = { ACCEPTED: 'success', TENTATIVE: 'warning', DECLINED: 'danger', PENDING: 'neutral' };
const ACTION_TONE: Record<ActionItemStatus, Tone> = { OPEN: 'info', IN_PROGRESS: 'brand', PENDING: 'warning', COMPLETED: 'success', CANCELLED: 'neutral' };
const NOTE_TONE: Record<MeetingNoteType, Tone> = { DISCUSSION: 'neutral', DECISION: 'success', ACTION: 'brand', ISSUE: 'danger', QUESTION: 'warning', INFORMATION: 'info' };

export const meetingStatusTone = (s: MeetingStatus): Tone => STATUS_TONE[s] ?? 'neutral';
export const responseTone = (r: InvitationResponse | undefined): Tone => RESPONSE_TONE[r ?? 'PENDING'] ?? 'neutral';
export const actionStatusTone = (s: ActionItemStatus): Tone => ACTION_TONE[s] ?? 'info';
export const noteTypeTone = (t: MeetingNoteType): Tone => NOTE_TONE[t] ?? 'neutral';

/** A code this version doesn't know, in plain words: "ON_HOLD" → "On hold" ('' for none). */
function plainWords(code: unknown): string {
  if (typeof code !== 'string' || !code) return '';
  const words = code.replace(/_/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The words for what the server sends. A newer server may send a value this version doesn't know:
// it is shown in plain words rather than breaking the screen.
export const meetingStatusLabel = (s: MeetingStatus): string => MEETING_STATUS_LABELS[s] ?? plainWords(s);
export const responseLabel = (r: InvitationResponse | undefined): string => RESPONSE_LABELS[r ?? 'PENDING'] ?? plainWords(r);
export const attendanceLabel = (a: AttendanceStatus): string => ATTENDANCE_LABELS[a] ?? plainWords(a);
export const actionStatusLabel = (s: ActionItemStatus): string => ACTION_STATUS_LABELS[s] ?? plainWords(s);
export const noteTypeLabel = (t: MeetingNoteType): string => NOTE_TYPE_LABELS[t] ?? plainWords(t);

/** How far a meeting's minutes are, as a badge (null when nothing was taken). */
export function minutesBadge(state: MinutesState | undefined): { label: string; tone: Tone } | null {
  switch (state) {
    case 'FINAL':
      return { label: 'Final minutes', tone: 'success' };
    case 'DRAFT':
      return { label: 'Minutes drafted', tone: 'info' };
    case 'NOTES':
      return { label: 'Notes taken', tone: 'neutral' };
    default:
      return null;
  }
}

// ── Your invitation ─────────────────────────────────────────────────────────

/** Your own row on the meeting (a team member's row with your id), or null when you aren't on it. */
export function myInvitation(attendees: ApiMeetingAttendee[], userId: string | null | undefined): ApiMeetingAttendee | null {
  if (!userId) return null;
  return attendees.find((a) => a.userId === userId) ?? null;
}

/** An invitation can be answered until the meeting is over or cancelled (as on the website). */
export function canAnswer(m: Pick<ApiMeeting, 'status'>): boolean {
  return m.status !== 'CANCELLED' && m.status !== 'COMPLETED';
}

/** The three answers, in the website's order and words. */
export const ANSWERS: { value: Exclude<InvitationResponse, 'PENDING'>; label: string }[] = [
  { value: 'ACCEPTED', label: 'Accept' },
  { value: 'TENTATIVE', label: 'Maybe' },
  { value: 'DECLINED', label: 'Decline' },
];

/** Tapping an answer gives it; tapping the answer already given takes it back (no response). */
export function answerAfterTap(current: InvitationResponse | undefined, tapped: InvitationResponse): InvitationResponse {
  return (current ?? 'PENDING') === tapped ? 'PENDING' : tapped;
}

/** The people with one row's answer changed (shown at once, before the server confirms it). */
export function withAnswer(attendees: ApiMeetingAttendee[], attendeeId: string, response: InvitationResponse, now: Date = new Date()): ApiMeetingAttendee[] {
  return attendees.map((a) => (a.id === attendeeId ? { ...a, response, respondedAt: response === 'PENDING' ? null : now.toISOString() } : a));
}

/** Your answer, in words. */
export function myAnswerText(response: InvitationResponse | undefined): string {
  switch (response) {
    case 'ACCEPTED':
      return 'You’re going.';
    case 'TENTATIVE':
      return 'You might go.';
    case 'DECLINED':
      return 'You’re not going.';
    default:
      return 'You haven’t answered yet.';
  }
}

// ── The people ──────────────────────────────────────────────────────────────

/** How many people gave each answer (older rows without one count as no response). */
export function responseSummary(attendees: { response?: InvitationResponse }[]): Record<InvitationResponse, number> {
  const out: Record<InvitationResponse, number> = { ACCEPTED: 0, TENTATIVE: 0, DECLINED: 0, PENDING: 0 };
  for (const a of attendees) out[a.response ?? 'PENDING'] += 1;
  return out;
}

export function responseLine(s: Record<InvitationResponse, number>): string {
  return `${s.ACCEPTED} accepted · ${s.TENTATIVE} maybe · ${s.DECLINED} declined · ${s.PENDING} no response`;
}

/** A team member by their name in the directory, a guest by the name they were added with. */
export function attendeeName(a: Pick<ApiMeetingAttendee, 'userId' | 'externalName'>, nameOf: (userId: string) => string | null): string {
  if (a.userId) return nameOf(a.userId) ?? 'A team member';
  return a.externalName?.trim() || 'Guest';
}

// ── The agenda ──────────────────────────────────────────────────────────────

/** Planned agenda minutes against the meeting's own length (null when it has no end time). */
export function agendaTiming(items: { expectedMinutes: number | null }[], startAt: string, endAt: string | null) {
  const planned = items.reduce((sum, i) => sum + (i.expectedMinutes ?? 0), 0);
  const unplanned = items.filter((i) => i.expectedMinutes == null).length;
  const length = endAt ? Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000) : null;
  return { planned, length, over: length !== null && planned > length ? planned - length : 0, unplanned };
}

export function agendaTimingText(t: ReturnType<typeof agendaTiming>): string {
  const base = t.length !== null ? `${t.planned} of ${t.length} min planned` : `${t.planned} min planned`;
  return t.over ? `${base} · ${t.over} min over` : base;
}

/** "Aisha Khan · 15 min" — who presents the topic and for how long. */
export function agendaItemLine(item: { ownerId: string | null; expectedMinutes: number | null }, nameOf: (userId: string) => string | null): string {
  const who = (item.ownerId && nameOf(item.ownerId)) || 'No presenter';
  return `${who} · ${item.expectedMinutes != null ? `${item.expectedMinutes} min` : 'no time set'}`;
}

// ── Action items ────────────────────────────────────────────────────────────

const CLOSED: ActionItemStatus[] = ['COMPLETED', 'CANCELLED'];

export function openActionCount(items: Pick<ApiActionItem, 'status'>[]): number {
  return items.filter((i) => !CLOSED.includes(i.status)).length;
}

/** Overdue once its due day is before today (company time), while still to do. */
export function isActionItemOverdue(item: Pick<ApiActionItem, 'dueDate' | 'status'>, now: Date = new Date(), timeZone: string = appTimeZone()): boolean {
  if (CLOSED.includes(item.status)) return false;
  const day = dueDayKey(item.dueDate, timeZone);
  return day !== null && day < companyTodayKey(now, timeZone);
}

/** "Due Oct 5", "Due Oct 5 — overdue" or "No due date". */
export function actionDueText(item: Pick<ApiActionItem, 'dueDate' | 'status'>, now: Date = new Date(), locale?: string, timeZone: string = appTimeZone()): string {
  const day = formatDueDay(item.dueDate, locale, timeZone);
  if (!day) return 'No due date';
  return isActionItemOverdue(item, now, timeZone) ? `Due ${day} — overdue` : `Due ${day}`;
}

// ── Minutes ─────────────────────────────────────────────────────────────────

/** What to say instead of the final minutes, or null when they are final and can be read. */
export function finalMinutesNote(fm: Pick<ApiFinalMinutes, 'status' | 'content'>): string | null {
  if (fm.status === 'FINAL' && fm.content) return null;
  if (fm.status === 'DRAFT') return 'The final minutes are being written. They’re finished on the website.';
  return 'The final minutes aren’t ready yet.';
}

/** "Approved by Aisha Khan on 10 Oct 2026, 10:30." */
export function approvedLine(fm: Pick<ApiFinalMinutes, 'approvedBy' | 'approvedAt'>, locale?: string, timeZone: string = appTimeZone()): string {
  const who = fm.approvedBy?.name ?? 'someone';
  const at = fm.approvedAt ? new Date(fm.approvedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return `Approved by ${who}.`;
  const day = dateFormat(locale, { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(at);
  return `Approved by ${who} on ${day}, ${clockTime(fm.approvedAt!, timeZone)}.`;
}

// ── The header and notes ────────────────────────────────────────────────────

/** The meeting's day ("Tue, Oct 20") and times ("10:00 – 11:30"), in the zone given. */
export function meetingWhen(m: Pick<ApiMeeting, 'startAt' | 'endAt'>, timeZone: string = appTimeZone(), locale?: string): { day: string; time: string } {
  const start = new Date(m.startAt);
  if (Number.isNaN(start.getTime())) return { day: '', time: '' };
  const day = dateFormat(locale, { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(start);
  const time = m.endAt ? `${clockTime(m.startAt, timeZone)} – ${clockTime(m.endAt, timeZone)}` : clockTime(m.startAt, timeZone);
  return { day, time };
}

/** "Aisha Khan · 10:05 · edited" — who wrote a note and when. */
export function noteMeta(note: Pick<ApiMeetingNote, 'authorId' | 'createdAt' | 'editedAt'>, nameOf: (userId: string) => string | null, timeZone: string = appTimeZone()): string {
  return [nameOf(note.authorId) ?? 'Someone', clockTime(note.createdAt, timeZone), note.editedAt ? 'edited' : null].filter(Boolean).join(' · ');
}

/**
 * What to say when a meeting can't be opened: gone or not yours to see (no point retrying), no
 * answer from the server (check the connection), or anything else (try again).
 */
export function meetingLoadProblem(error: unknown): { message: string; canRetry: boolean } {
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return { message: 'This meeting wasn’t found, or you don’t have access to it. It may have been deleted.', canRetry: false };
  }
  if (isNetworkError(error)) return { message: 'Couldn’t load this meeting. Check your connection and try again.', canRetry: true };
  return { message: 'Couldn’t load this meeting. Please try again.', canRetry: true };
}
