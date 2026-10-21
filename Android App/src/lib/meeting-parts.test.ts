import { describe, it, expect } from 'vitest';
import { ApiError } from './api-client';
import {
  addablePeople,
  attendeeAddFailure,
  canChangeNoteText,
  canManageNote,
  canRemoveActionItem,
  canTickAgendaItem,
  dueDayToIso,
  guestProblem,
  moveAgenda,
  noteEditStart,
  notePlaceholder,
  noteTaskTitle,
  parseAgendaMinutes,
  personFlags,
} from './meeting-parts';
import type { ApiActionItem, ApiAgendaItem, ApiDirectoryUser, ApiMeeting, ApiMeetingAttendee, ApiMeetingNote } from './types';

const note = (over: Partial<ApiMeetingNote> = {}): ApiMeetingNote => ({
  id: 'n1',
  meetingId: 'm1',
  agendaItemId: null,
  authorId: 'u1',
  type: 'ACTION',
  body: 'Book the hall',
  highlighted: false,
  taskId: null,
  createdAt: '2026-10-20T06:05:00.000Z',
  editedAt: null,
  ...over,
});
const attendee = (over: Partial<ApiMeetingAttendee> = {}): ApiMeetingAttendee => ({
  id: 'a1',
  meetingId: 'm1',
  userId: null,
  externalName: 'Sara',
  externalEmail: 'sara@client.com',
  role: 'REQUIRED',
  attendance: 'INVITED',
  response: 'PENDING',
  invitedAt: null,
  department: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('Live notes', () => {
  it('lets the author change their note’s words; the organizer may mark any note a key point or delete it', () => {
    const mine = note({ authorId: 'me' });
    expect(canChangeNoteText(mine, 'me')).toBe(true);
    expect(canChangeNoteText(note(), 'me')).toBe(false);
    expect(canManageNote(note(), { canEdit: true, myId: 'me' })).toBe(true);
    expect(canManageNote(note(), { canEdit: false, myId: 'me' })).toBe(false);
    expect(canManageNote(mine, { canEdit: false, myId: 'me' })).toBe(true);
  });

  it('asks for the category picked', () => {
    expect(notePlaceholder('DECISION')).toBe('Write a decision…');
    expect(notePlaceholder('ACTION')).toBe('Write an action item…');
    expect(notePlaceholder('ISSUE')).toBe('Write an issue…');
  });

  it('opens a formatted note as its words (saving drops the formatting, and says so)', () => {
    expect(noteEditStart(note())).toEqual({ text: 'Book the hall', formatted: false });
    expect(noteEditStart(note({ bodyFormat: 'RICH', body: '<p><strong>Book</strong> the hall</p><ul><li><p>by Friday</p></li></ul>' }))).toEqual({ text: 'Book the hall\n- by Friday', formatted: true });
  });

  it('titles a task made from a note with its first line, cut short when long', () => {
    expect(noteTaskTitle(note({ body: '\n  Book   the hall \nfor Friday' }))).toBe('Book the hall');
    expect(noteTaskTitle(note({ body: 'x'.repeat(130) }))).toBe(`${'x'.repeat(117)}…`);
    expect(noteTaskTitle(note({ bodyFormat: 'RICH', body: '<p>Call <em>the</em> client</p>' }))).toBe('Call the client');
  });
});

describe('the agenda', () => {
  const item = (id: string, ownerId: string | null = null): ApiAgendaItem => ({ id, meetingId: 'm1', title: id, ownerId, expectedMinutes: null, position: 0, completed: false });

  it('moves an item up or down (nothing past either end)', () => {
    const items = [item('a'), item('b'), item('c')];
    expect(moveAgenda(items, 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveAgenda(items, 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveAgenda(items, 0, -1)).toBeNull();
    expect(moveAgenda(items, 2, 1)).toBeNull();
  });

  it('reads the planned minutes (blank is none)', () => {
    expect(parseAgendaMinutes('')).toEqual({ ok: true, value: null });
    expect(parseAgendaMinutes(' 15 ')).toEqual({ ok: true, value: 15 });
    expect(parseAgendaMinutes('١٥')).toEqual({ ok: true, value: 15 });
    expect(parseAgendaMinutes('ten')).toEqual({ ok: false, error: 'Enter the minutes as a whole number, e.g. 15.' });
    expect(parseAgendaMinutes('700')).toEqual({ ok: false, error: 'An agenda item can take at most 600 minutes.' });
  });

  it('lets the organizer tick any item off, and a presenter their own', () => {
    expect(canTickAgendaItem(item('a'), { canEdit: true, myId: 'me' })).toBe(true);
    expect(canTickAgendaItem(item('a', 'me'), { canEdit: false, myId: 'me' })).toBe(true);
    expect(canTickAgendaItem(item('a', 'u2'), { canEdit: false, myId: 'me' })).toBe(false);
  });
});

describe('the people', () => {
  const dir = (id: string, firstName: string): ApiDirectoryUser => ({ id, username: id, firstName, lastName: '' }) as ApiDirectoryUser;

  it('offers the team members not on the list yet', () => {
    expect(addablePeople([dir('u1', 'Aisha'), dir('u2', 'Bilal'), dir('u3', 'Chen')], [attendee({ userId: 'u2' })]).map((p) => p.id)).toEqual(['u1', 'u3']);
  });

  it('checks a guest before adding them', () => {
    expect(guestProblem(' ', '', [])).toBe('Enter the guest’s name.');
    expect(guestProblem('Sara', 'sara@', [])).toBe('Enter a valid email address for the guest (for example name@company.com), or leave it blank.');
    expect(guestProblem('Sara', 'SARA@client.com', [attendee()])).toBe('That guest is already on the list.');
    expect(guestProblem('Sara', '', [attendee()])).toBeNull();
    expect(guestProblem('Omar', 'omar@client.com', [attendee()])).toBeNull();
  });

  it('says why someone couldn’t be added', () => {
    expect(attendeeAddFailure(new ApiError(409, 'CONFLICT', 'x'), 'member')).toBe('That person is already on the list.');
    expect(attendeeAddFailure(new ApiError(409, 'CONFLICT', 'x'), 'guest')).toBe('That guest is already on the list.');
    expect(attendeeAddFailure(new ApiError(400, 'VALIDATION', 'x'), 'guest')).toBe('Check the guest’s details — the email address doesn’t look valid.');
    expect(attendeeAddFailure(new ApiError(403, 'FORBIDDEN', 'x'), 'member')).toBe('Couldn’t add the attendee. You don’t have permission to do that.');
  });

  it('marks who wasn’t invited yet, and a guest without an address (who can’t be)', () => {
    const m = { status: 'SCHEDULED', invitesSentAt: '2026-10-20T08:00:00.000Z' } as Pick<ApiMeeting, 'status' | 'invitesSentAt'>;
    expect(personFlags(attendee(), m)).toEqual({ notInvited: true, noEmail: false });
    expect(personFlags(attendee({ invitedAt: '2026-10-20T08:00:00.000Z' }), m)).toEqual({ notInvited: false, noEmail: false });
    expect(personFlags(attendee({ externalEmail: null }), m)).toEqual({ notInvited: false, noEmail: true });
    expect(personFlags(attendee(), { status: 'SCHEDULED', invitesSentAt: null })).toEqual({ notInvited: false, noEmail: false });
  });
});

describe('action items', () => {
  const item = (over: Partial<ApiActionItem> = {}) => ({ createdById: 'u1', ...over }) as ApiActionItem;

  it('sends a due day as that day', () => {
    expect(dueDayToIso('2026-10-30')).toBe('2026-10-30T00:00:00.000Z');
    expect(dueDayToIso(null)).toBeNull();
  });

  it('lets the organizer or the item’s creator remove it', () => {
    expect(canRemoveActionItem(item(), { canEdit: true, myId: 'me' })).toBe(true);
    expect(canRemoveActionItem(item({ createdById: 'me' }), { canEdit: false, myId: 'me' })).toBe(true);
    expect(canRemoveActionItem(item(), { canEdit: false, myId: 'me' })).toBe(false);
  });
});
