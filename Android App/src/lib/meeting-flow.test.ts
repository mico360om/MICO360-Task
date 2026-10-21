import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError, NetworkError } from './api-client';
import { cancelDialog, deleteDialog, meetingFailure, meetingMenu, minutesFileName, primaryAction, PRIMARY_LABEL, statusNotice } from './meeting-flow';
import type { ApiMeeting, MeetingStatus } from './types';

const meeting = (over: Partial<ApiMeeting> = {}): ApiMeeting => ({
  id: 'm1',
  title: 'Weekly sync',
  description: null,
  status: 'SCHEDULED',
  projectId: null,
  organizerId: 'u1',
  location: null,
  onlineLink: null,
  startAt: '2026-10-22T06:00:00.000Z',
  endAt: null,
  timeZone: null,
  recurrenceRule: null,
  recurrenceParentId: null,
  invitesSentAt: null,
  canEdit: true,
  ...over,
});

describe('the one main button: the next step for the meeting’s status', () => {
  it('schedules a draft, invites, starts, ends, then emails the minutes', () => {
    expect(primaryAction(meeting({ status: 'DRAFT' }), true)).toBe('schedule');
    expect(primaryAction(meeting(), true)).toBe('invite');
    expect(primaryAction(meeting({ invitesSentAt: '2026-10-20T00:00:00.000Z' }), true)).toBe('start');
    expect(primaryAction(meeting({ status: 'IN_PROGRESS' }), true)).toBe('end');
    expect(primaryAction(meeting({ status: 'COMPLETED' }), true)).toBe('email-minutes');
    expect(primaryAction(meeting({ status: 'CANCELLED' }), true)).toBe('duplicate');
    expect(PRIMARY_LABEL.schedule).toBe('Schedule & invite');
  });

  it('for someone who can’t run it: only the minutes, once it is over', () => {
    expect(primaryAction(meeting({ status: 'COMPLETED' }), false)).toBe('export-minutes');
    expect(primaryAction(meeting(), false)).toBeNull();
  });

  it('matches the website', async () => {
    const web = resolve(__dirname, '../../../Web Portal/frontend/src/lib/meeting-flow.ts');
    if (!existsSync(web)) return;
    const theirs = (await import(/* @vite-ignore */ web)) as { primaryAction: (m: { status: MeetingStatus; invitesSentAt: string | null }, canEdit: boolean) => string | null };
    for (const status of ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as MeetingStatus[]) {
      for (const invitesSentAt of [null, '2026-10-20T00:00:00.000Z']) {
        for (const canEdit of [true, false]) {
          expect(primaryAction(meeting({ status, invitesSentAt }), canEdit)).toBe(theirs.primaryAction({ status, invitesSentAt }, canEdit));
        }
      }
    }
  });
});

describe('the other meeting actions (More)', () => {
  const keys = (m: ApiMeeting, canEdit = true) => meetingMenu(m, canEdit).map((i) => i.key);

  it('offers what the website offers for each status, the destructive pair last', () => {
    expect(keys(meeting({ status: 'DRAFT' }))).toEqual(['edit', 'schedule-quietly', 'email-minutes', 'export-minutes', 'duplicate', 'cancel', 'delete']);
    expect(keys(meeting())).toEqual(['edit', 'start', 'email-minutes', 'export-minutes', 'duplicate', 'cancel', 'delete']);
    expect(keys(meeting({ invitesSentAt: '2026-10-20T00:00:00.000Z' }))).toEqual(['edit', 'invite', 'email-minutes', 'export-minutes', 'duplicate', 'cancel', 'delete']);
    expect(keys(meeting({ status: 'IN_PROGRESS' }))).toEqual(['edit', 'invite', 'email-minutes', 'export-minutes', 'duplicate', 'cancel', 'delete']);
    expect(keys(meeting({ status: 'COMPLETED' }))).toEqual(['edit', 'export-minutes', 'duplicate', 'delete']);
    expect(keys(meeting({ status: 'CANCELLED' }))).toEqual(['export-minutes', 'delete']);
    expect(meetingMenu(meeting(), true).filter((i) => i.danger).map((i) => i.label)).toEqual(['Cancel meeting…', 'Delete meeting…']);
  });

  it('for an attendee: the minutes and a copy only', () => {
    expect(keys(meeting(), false)).toEqual(['export-minutes', 'duplicate']);
    expect(keys(meeting({ status: 'COMPLETED' }), false)).toEqual(['duplicate']);
  });
});

describe('cancelling and deleting (in a series: this one or all upcoming)', () => {
  it('says who is told, in the website’s words', () => {
    expect(cancelDialog(meeting(), 'one')).toEqual({
      title: 'Cancel this meeting?',
      body: '“Weekly sync” stays in the list, marked Cancelled. No invitations went out, so nobody is notified.',
      confirm: 'Cancel meeting',
      keep: 'Keep meeting',
      scopes: null,
      done: 'Meeting cancelled.',
    });
    const series = cancelDialog(meeting({ recurrenceParentId: 'm0', invitesSentAt: '2026-10-20T00:00:00.000Z' }), 'series');
    expect(series).toMatchObject({ title: 'Cancel a repeating meeting?', confirm: 'Cancel meetings', done: 'The upcoming meetings of the series are cancelled.' });
    expect(series.body).toBe('“Weekly sync” repeats. Everyone who was invited gets a cancellation notice.');
    expect(series.scopes?.series.label).toBe('All upcoming meetings in the series');
  });

  it('warns that deleting can’t be undone, and offers cancelling instead', () => {
    const one = deleteDialog(meeting({ invitesSentAt: '2026-10-20T00:00:00.000Z' }), 'one');
    expect(one.title).toBe('Delete this meeting?');
    expect(one.body).toBe('“Weekly sync” and its agenda, notes and action items are removed. This can’t be undone. Invited people get a cancellation notice.');
    expect(one.hint).toBe('To keep the record but call it off, cancel the meeting instead.');
    const all = deleteDialog(meeting({ recurrenceRule: { freq: 'WEEKLY', interval: 1 } }), 'series');
    expect(all).toMatchObject({ title: 'Delete a repeating meeting?', confirm: 'Delete meetings', body: 'The upcoming meetings and their agenda, notes and action items are removed. This can’t be undone.' });
  });
});

describe('the minutes PDF', () => {
  it('is named as the website names it (the server’s own name wins when it gives one)', () => {
    expect(minutesFileName('Weekly Sync: Q4!')).toBe('minutes-weekly-sync-q4.pdf');
    expect(minutesFileName('اجتماع', true)).toBe('minutes-final-meeting.pdf');
  });
});

describe('words after a change', () => {
  it('says the meeting started or ended', () => {
    expect(statusNotice('IN_PROGRESS')).toBe('The meeting has started.');
    expect(statusNotice('COMPLETED')).toBe('The meeting has ended. You can now send the minutes.');
    expect(statusNotice('SCHEDULED')).toBe('Saved.');
  });

  it('gives our sentence plus the server’s reason, and says plainly what isn’t allowed or offline', () => {
    expect(meetingFailure(new ApiError(403, 'FORBIDDEN', 'Only the organizer…'), 'Couldn’t add the attendee.')).toBe('Couldn’t add the attendee. You don’t have permission to do that.');
    expect(meetingFailure(new ApiError(409, 'CONFLICT', 'That person is already on the list.'), 'Couldn’t add the attendee.')).toBe('Couldn’t add the attendee. That person is already on the list.');
    expect(meetingFailure(new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'x'), 'Couldn’t send the invitations.')).toBe('Couldn’t send the invitations. Email isn’t set up on this server, so nothing was sent — ask your administrator.');
    expect(meetingFailure(new ApiError(503, 'UNAVAILABLE', 'Email is not configured.'), 'Couldn’t send the invitations.')).toBe('Couldn’t send the invitations. Email isn’t set up on this server, so nothing was sent — ask your administrator.');
    expect(meetingFailure(new ApiError(500, 'ERROR', 'Request failed (500)'), 'Couldn’t save.')).toBe('Couldn’t save.');
    expect(meetingFailure(new NetworkError('offline'), 'Couldn’t save.')).toBe('Couldn’t save. You’re offline — this needs a connection.');
  });
});
