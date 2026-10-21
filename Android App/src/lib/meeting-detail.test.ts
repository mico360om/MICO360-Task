import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ANSWERS,
  MEETING_STATUS_LABELS,
  actionDueText,
  agendaItemLine,
  agendaTiming,
  agendaTimingText,
  answerAfterTap,
  approvedLine,
  attendeeName,
  canAnswer,
  finalMinutesNote,
  isActionItemOverdue,
  meetingLoadProblem,
  meetingWhen,
  minutesBadge,
  myAnswerText,
  myInvitation,
  noteMeta,
  openActionCount,
  responseLine,
  responseSummary,
  withAnswer,
} from './meeting-detail';
import { ApiError, NetworkError } from './api-client';
import type { ApiActionItem, ApiFinalMinutes, ApiMeetingAttendee, ApiMeetingNote } from './types';

const attendee = (id: string, over: Partial<ApiMeetingAttendee> = {}): ApiMeetingAttendee => ({
  id,
  meetingId: 'm1',
  userId: null,
  externalName: null,
  externalEmail: null,
  role: 'REQUIRED',
  attendance: 'INVITED',
  response: 'PENDING',
  respondedAt: null,
  invitedAt: null,
  department: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const item = (over: Partial<ApiActionItem> = {}): ApiActionItem => ({
  id: 'i1',
  meetingId: 'm1',
  projectId: null,
  description: 'Send the plan',
  assigneeId: 'u1',
  priority: 'NORMAL',
  status: 'OPEN',
  dueDate: null,
  progress: 0,
  completedAt: null,
  taskId: null,
  sourceNoteId: null,
  createdById: 'u1',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  overdue: false,
  ...over,
});

const NOW = new Date('2026-10-10T08:00:00.000Z'); // 12:00 in Muscat
const names: Record<string, string> = { u1: 'Aisha Khan', u2: 'Omar Said' };
const nameOf = (id: string | null | undefined) => (id ? names[id] ?? null : null);

describe('your answer to the invitation (RSVP)', () => {
  const people = [attendee('a1', { userId: 'u1', response: 'ACCEPTED' }), attendee('a2', { userId: 'u2' }), attendee('g1', { externalName: 'Guest' })];

  it('finds your own row only (never a guest’s, never someone else’s)', () => {
    expect(myInvitation(people, 'u2')?.id).toBe('a2');
    expect(myInvitation(people, 'u9')).toBeNull();
    expect(myInvitation(people, null)).toBeNull();
  });

  it('can be given until the meeting is over or cancelled', () => {
    expect(canAnswer({ status: 'SCHEDULED' })).toBe(true);
    expect(canAnswer({ status: 'DRAFT' })).toBe(true);
    expect(canAnswer({ status: 'IN_PROGRESS' })).toBe(true);
    expect(canAnswer({ status: 'COMPLETED' })).toBe(false);
    expect(canAnswer({ status: 'CANCELLED' })).toBe(false);
  });

  it('offers Accept, Maybe and Decline; tapping the answer you gave takes it back', () => {
    expect(ANSWERS.map((a) => [a.value, a.label])).toEqual([
      ['ACCEPTED', 'Accept'],
      ['TENTATIVE', 'Maybe'],
      ['DECLINED', 'Decline'],
    ]);
    expect(answerAfterTap('PENDING', 'ACCEPTED')).toBe('ACCEPTED');
    expect(answerAfterTap('ACCEPTED', 'DECLINED')).toBe('DECLINED');
    expect(answerAfterTap('TENTATIVE', 'TENTATIVE')).toBe('PENDING');
    expect(answerAfterTap(undefined, 'TENTATIVE')).toBe('TENTATIVE');
  });

  it('shows the new answer on your row at once (the rest of the list as it was)', () => {
    const next = withAnswer(people, 'a2', 'DECLINED', NOW);
    expect(next.map((a) => a.response)).toEqual(['ACCEPTED', 'DECLINED', 'PENDING']);
    expect(next[1]!.respondedAt).toBe(NOW.toISOString());
    expect(next[0]).toBe(people[0]);
    expect(withAnswer(people, 'a1', 'PENDING', NOW)[0]!.respondedAt).toBeNull();
  });

  it('says what you answered in words', () => {
    expect(myAnswerText('ACCEPTED')).toBe('You’re going.');
    expect(myAnswerText('TENTATIVE')).toBe('You might go.');
    expect(myAnswerText('DECLINED')).toBe('You’re not going.');
    expect(myAnswerText('PENDING')).toBe('You haven’t answered yet.');
    expect(myAnswerText(undefined)).toBe('You haven’t answered yet.');
  });
});

describe('the people', () => {
  it('counts each answer (an older row without one is no response) and says it in one line', () => {
    const s = responseSummary([attendee('a', { response: 'ACCEPTED' }), attendee('b', { response: 'ACCEPTED' }), attendee('c', { response: 'TENTATIVE' }), attendee('d', { response: undefined })]);
    expect(s).toEqual({ ACCEPTED: 2, TENTATIVE: 1, DECLINED: 0, PENDING: 1 });
    expect(responseLine(s)).toBe('2 accepted · 1 maybe · 0 declined · 1 no response');
  });

  it('names a team member from the directory, and a guest by their own name', () => {
    expect(attendeeName(attendee('a', { userId: 'u1' }), nameOf)).toBe('Aisha Khan');
    expect(attendeeName(attendee('a', { userId: 'u7' }), nameOf)).toBe('A team member');
    expect(attendeeName(attendee('g', { externalName: 'Sara (client)' }), nameOf)).toBe('Sara (client)');
    expect(attendeeName(attendee('g'), nameOf)).toBe('Guest');
  });

  it('matches the website’s answer counts', async () => {
    const web = resolve(__dirname, '../../../Web Portal/frontend/src/lib/meeting-flow.ts');
    if (!existsSync(web)) return;
    const theirs = (await import(/* @vite-ignore */ web)) as { responseSummary: (a: unknown[]) => unknown; agendaTiming: (...a: unknown[]) => unknown };
    const rows = [attendee('a', { response: 'DECLINED' }), attendee('b', { response: undefined }), attendee('c', { response: 'TENTATIVE' })];
    expect(responseSummary(rows)).toEqual(theirs.responseSummary(rows));
    const agenda = [{ expectedMinutes: 30 }, { expectedMinutes: null }, { expectedMinutes: 45 }];
    expect(agendaTiming(agenda, '2026-10-10T06:00:00.000Z', '2026-10-10T07:00:00.000Z')).toEqual(theirs.agendaTiming(agenda, '2026-10-10T06:00:00.000Z', '2026-10-10T07:00:00.000Z'));
  });
});

describe('the agenda', () => {
  it('adds up the planned minutes against the meeting’s length', () => {
    const t = agendaTiming([{ expectedMinutes: 30 }, { expectedMinutes: null }, { expectedMinutes: 45 }], '2026-10-10T06:00:00.000Z', '2026-10-10T07:00:00.000Z');
    expect(t).toEqual({ planned: 75, length: 60, over: 15, unplanned: 1 });
    expect(agendaTimingText(t)).toBe('75 of 60 min planned · 15 min over');
    expect(agendaTimingText(agendaTiming([{ expectedMinutes: 20 }], '2026-10-10T06:00:00.000Z', null))).toBe('20 min planned');
  });

  it('names who presents each topic and for how long', () => {
    expect(agendaItemLine({ ownerId: 'u1', expectedMinutes: 15 }, nameOf)).toBe('Aisha Khan · 15 min');
    expect(agendaItemLine({ ownerId: null, expectedMinutes: null }, nameOf)).toBe('No presenter · no time set');
  });
});

describe('action items', () => {
  it('counts the ones still to do', () => {
    expect(openActionCount([item(), item({ status: 'IN_PROGRESS' }), item({ status: 'COMPLETED' }), item({ status: 'CANCELLED' })])).toBe(2);
  });

  it('is overdue once its due day is before today in company time, while still to do', () => {
    expect(isActionItemOverdue(item({ dueDate: '2026-10-09T00:00:00.000Z' }), NOW, 'Asia/Muscat')).toBe(true);
    expect(isActionItemOverdue(item({ dueDate: '2026-10-10T00:00:00.000Z' }), NOW, 'Asia/Muscat')).toBe(false);
    expect(isActionItemOverdue(item({ dueDate: '2026-10-01T00:00:00.000Z', status: 'COMPLETED' }), NOW, 'Asia/Muscat')).toBe(false);
    expect(isActionItemOverdue(item({ dueDate: null }), NOW, 'Asia/Muscat')).toBe(false);
  });

  it('says when it is due', () => {
    expect(actionDueText(item({ dueDate: '2026-10-09T00:00:00.000Z' }), NOW, 'en-US', 'Asia/Muscat')).toBe('Due Oct 9 — overdue');
    expect(actionDueText(item({ dueDate: '2026-10-12T00:00:00.000Z' }), NOW, 'en-US', 'Asia/Muscat')).toBe('Due Oct 12');
    expect(actionDueText(item(), NOW, 'en-US', 'Asia/Muscat')).toBe('No due date');
  });
});

describe('minutes', () => {
  it('shows how far the minutes are as a badge (nothing when none were taken)', () => {
    expect(minutesBadge('FINAL')).toEqual({ label: 'Final minutes', tone: 'success' });
    expect(minutesBadge('DRAFT')).toEqual({ label: 'Minutes drafted', tone: 'info' });
    expect(minutesBadge('NOTES')).toEqual({ label: 'Notes taken', tone: 'neutral' });
    expect(minutesBadge('NONE')).toBeNull();
    expect(minutesBadge(undefined)).toBeNull();
  });

  const fm = (over: Partial<ApiFinalMinutes>): ApiFinalMinutes => ({ status: 'NONE', content: null, savedAt: null, approvedBy: null, approvedAt: null, canEdit: false, ...over });

  it('says plainly when the final minutes aren’t there to read yet', () => {
    expect(finalMinutesNote(fm({ status: 'NONE' }))).toBe('The final minutes aren’t ready yet.');
    expect(finalMinutesNote(fm({ status: 'DRAFT', canEdit: true }))).toBe('The final minutes are being written. They’re finished on the website.');
    expect(finalMinutesNote(fm({ status: 'FINAL', content: { summary: 'x', discussion: [], decisions: [], risks: [], nextSteps: [] } }))).toBeNull();
    expect(finalMinutesNote(fm({ status: 'FINAL', content: null }))).toBe('The final minutes aren’t ready yet.');
  });

  it('names who approved them, and when', () => {
    const line = approvedLine(fm({ status: 'FINAL', approvedBy: { id: 'u1', name: 'Aisha Khan' }, approvedAt: '2026-10-10T06:30:00.000Z' }), 'en-GB', 'Asia/Muscat');
    expect(line).toBe('Approved by Aisha Khan on 10 Oct 2026, 10:30.');
    expect(approvedLine(fm({ status: 'FINAL' }), 'en-GB', 'Asia/Muscat')).toBe('Approved by someone.');
  });
});

describe('the header', () => {
  it('gives the day and the times in the zone given', () => {
    expect(meetingWhen({ startAt: '2026-10-20T06:00:00.000Z', endAt: '2026-10-20T07:30:00.000Z' }, 'Asia/Muscat', 'en-US')).toEqual({ day: 'Tue, Oct 20', time: '10:00 – 11:30' });
    expect(meetingWhen({ startAt: '2026-10-20T06:00:00.000Z', endAt: null }, 'Asia/Muscat', 'en-US')).toEqual({ day: 'Tue, Oct 20', time: '10:00' });
  });

  it('labels every status as the website does', () => {
    expect(MEETING_STATUS_LABELS).toEqual({ DRAFT: 'Draft', SCHEDULED: 'Scheduled', IN_PROGRESS: 'In Progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled' });
  });
});

describe('notes', () => {
  const note = (over: Partial<ApiMeetingNote> = {}): ApiMeetingNote => ({
    id: 'n1',
    meetingId: 'm1',
    agendaItemId: null,
    authorId: 'u1',
    type: 'DECISION',
    body: 'Go',
    highlighted: false,
    taskId: null,
    createdAt: '2026-10-10T06:05:00.000Z',
    editedAt: null,
    ...over,
  });

  it('says who wrote it and when (and whether it was changed since)', () => {
    expect(noteMeta(note(), nameOf, 'Asia/Muscat')).toBe('Aisha Khan · 10:05');
    expect(noteMeta(note({ authorId: 'u9', editedAt: '2026-10-10T07:00:00.000Z' }), nameOf, 'Asia/Muscat')).toBe('Someone · 10:05 · edited');
  });
});

describe('meetingLoadProblem', () => {
  it('tells a missing meeting (no point retrying) from a failed load', () => {
    expect(meetingLoadProblem(new ApiError(404, 'NOT_FOUND', 'Meeting not found.'))).toEqual({
      message: 'This meeting wasn’t found, or you don’t have access to it. It may have been deleted.',
      canRetry: false,
    });
    expect(meetingLoadProblem(new NetworkError('offline'))).toEqual({ message: 'Couldn’t load this meeting. Check your connection and try again.', canRetry: true });
    expect(meetingLoadProblem(new ApiError(500, 'INTERNAL', 'x'))).toEqual({ message: 'Couldn’t load this meeting. Please try again.', canRetry: true });
  });
});
