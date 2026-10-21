/**
 * The parts of a meeting the app now changes (2b) — Live notes, the agenda, the people and the
 * action items — and who may change what. The rules are the server's (note-routes, agenda-routes,
 * attendee-routes, action-item-routes); the words are the website's. Pure, so it is tested here.
 */
import { ApiError } from './api-client';
import { normalizeDigits, type Parsed } from './form-input';
import { meetingFailure } from './meeting-flow';
import { noteTypeLabel } from './meeting-detail';
import { noteWords } from './rich-note';
import type { ApiActionItem, ApiAgendaItem, ApiDirectoryUser, ApiMeeting, ApiMeetingAttendee, ApiMeetingNote, AttendanceStatus, MeetingNoteType, Priority } from './types';

interface Viewer {
  /** The server's `canEdit` for this meeting. */
  canEdit: boolean;
  myId: string | null;
}

// ── Live notes ──────────────────────────────────────────────────────────────

/** The note categories, in the website's order. */
export const NOTE_TYPES: MeetingNoteType[] = ['DISCUSSION', 'DECISION', 'ACTION', 'ISSUE', 'QUESTION', 'INFORMATION'];

/** Only a note's author changes its words. */
export function canChangeNoteText(note: Pick<ApiMeetingNote, 'authorId'>, myId: string | null): boolean {
  return !!myId && note.authorId === myId;
}

/** Its author, or whoever runs the meeting, may mark a note a key point or delete it. */
export function canManageNote(note: Pick<ApiMeetingNote, 'authorId'>, v: Viewer): boolean {
  return v.canEdit || canChangeNoteText(note, v.myId);
}

/** "Write a decision…", "Write an action item…". */
export function notePlaceholder(type: MeetingNoteType): string {
  const label = noteTypeLabel(type).toLowerCase();
  return `Write ${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}…`;
}

/**
 * A note as the phone's editor opens it: a formatted (website) note as its words — lines, list
 * items — since the phone saves plain text; `formatted` says so, so the editor can warn that saving
 * here drops the formatting.
 */
export function noteEditStart(note: Pick<ApiMeetingNote, 'body' | 'bodyFormat'>): { text: string; formatted: boolean } {
  const formatted = note.bodyFormat === 'RICH';
  return { text: formatted ? noteWords(note) : note.body, formatted };
}

/** A task made from a note is titled with its first line (cut short at 120 characters). */
export function noteTaskTitle(note: Pick<ApiMeetingNote, 'body' | 'bodyFormat'>): string {
  const words = noteWords(note);
  const first = words.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? words.trim();
  const clean = first.replace(/\s+/g, ' ');
  return clean.length > 120 ? `${clean.slice(0, 117).trimEnd()}…` : clean;
}

// ── The agenda ──────────────────────────────────────────────────────────────

/** The agenda's ids with one item moved up (-1) or down (+1); null past either end. */
export function moveAgenda(items: Pick<ApiAgendaItem, 'id'>[], index: number, dir: -1 | 1): string[] | null {
  const to = index + dir;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return null;
  const ids = items.map((i) => i.id);
  const [moved] = ids.splice(index, 1);
  ids.splice(to, 0, moved!);
  return ids;
}

/** Planned minutes as typed (Arabic digits allowed): a whole number up to 600, blank = none. */
export function parseAgendaMinutes(input: string): Parsed<number | null> {
  const s = normalizeDigits(input).trim();
  if (!s) return { ok: true, value: null };
  if (!/^\d+$/.test(s)) return { ok: false, error: 'Enter the minutes as a whole number, e.g. 15.' };
  const n = Number(s);
  if (n > 600) return { ok: false, error: 'An agenda item can take at most 600 minutes.' };
  return { ok: true, value: n };
}

/** Whoever runs the meeting ticks any item off as covered; a presenter, their own. */
export function canTickAgendaItem(item: Pick<ApiAgendaItem, 'ownerId'>, v: Viewer): boolean {
  return v.canEdit || (!!v.myId && item.ownerId === v.myId);
}

// ── The people ──────────────────────────────────────────────────────────────

/** Attendance on the day, in the website's order. */
export const ATTENDANCE_CHOICES: AttendanceStatus[] = ['INVITED', 'PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The team members not on the meeting yet. */
export function addablePeople(directory: ApiDirectoryUser[], attendees: Pick<ApiMeetingAttendee, 'userId'>[]): ApiDirectoryUser[] {
  const on = new Set(attendees.map((a) => a.userId).filter(Boolean));
  return directory.filter((u) => !on.has(u.id));
}

/** What's wrong with a guest before they are added (an email is optional), or null. */
export function guestProblem(name: string, email: string, attendees: Pick<ApiMeetingAttendee, 'externalEmail'>[]): string | null {
  const mail = email.trim().toLowerCase();
  if (!name.trim()) return 'Enter the guest’s name.';
  if (mail && !EMAIL_RE.test(mail)) return 'Enter a valid email address for the guest (for example name@company.com), or leave it blank.';
  if (mail && attendees.some((a) => a.externalEmail?.toLowerCase() === mail)) return 'That guest is already on the list.';
  return null;
}

/** Why someone couldn't be added. */
export function attendeeAddFailure(e: unknown, mode: 'member' | 'guest'): string {
  if (e instanceof ApiError && e.status === 409) return mode === 'member' ? 'That person is already on the list.' : 'That guest is already on the list.';
  if (e instanceof ApiError && e.status === 400 && mode === 'guest') return 'Check the guest’s details — the email address doesn’t look valid.';
  return meetingFailure(e, 'Couldn’t add the attendee.');
}

/**
 * Not invited yet (invitations went out before they were added), or a guest without an address —
 * who can't be emailed, so isn't "waiting" for an invitation.
 */
export function personFlags(a: Pick<ApiMeetingAttendee, 'userId' | 'externalEmail' | 'invitedAt'>, m: Pick<ApiMeeting, 'status' | 'invitesSentAt'>): { notInvited: boolean; noEmail: boolean } {
  const noEmail = !a.userId && !a.externalEmail;
  return { notInvited: !noEmail && !!m.invitesSentAt && !a.invitedAt && m.status !== 'CANCELLED', noEmail };
}

// ── Action items ────────────────────────────────────────────────────────────

export const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
export const PRIORITY_LABELS: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

/** A due day ('YYYY-MM-DD') as the server keeps it: that day at UTC midnight. */
export function dueDayToIso(day: string | null | undefined): string | null {
  return day ? `${day}T00:00:00.000Z` : null;
}

/** Whoever runs the meeting, or the item's creator, may remove it. */
export function canRemoveActionItem(item: Pick<ApiActionItem, 'createdById'>, v: Viewer): boolean {
  return v.canEdit || (!!v.myId && item.createdById === v.myId);
}
