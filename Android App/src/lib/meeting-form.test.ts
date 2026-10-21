import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError, NetworkError } from './api-client';
import {
  checkMeetingDraft,
  draftFromMeeting,
  keepsSaveKey,
  firstMeetingDay,
  firstMeetingNote,
  fromWallClock,
  meetingRepeatText,
  meetingRule,
  newMeetingDraft,
  normalizeMeetingLink,
  parseTimeInput,
  repeatProblem,
  saveFailureText,
  saveRequest,
  scopeChoice,
  seriesIdOf,
  statusOptions,
  toWallClock,
  type MeetingDraft,
} from './meeting-form';
import type { ApiMeeting, RecurrenceRule } from './types';

const TZ = 'Asia/Muscat'; // UTC+4, no daylight saving

const meeting = (over: Partial<ApiMeeting> = {}): ApiMeeting => ({
  id: 'm1',
  title: 'Weekly sync',
  description: 'Plans',
  status: 'SCHEDULED',
  projectId: 'p1',
  organizerId: 'u1',
  location: 'Room 2',
  onlineLink: null,
  startAt: '2026-10-22T06:00:00.000Z',
  endAt: '2026-10-22T07:00:00.000Z',
  timeZone: TZ,
  recurrenceRule: null,
  recurrenceParentId: null,
  ...over,
});

const weekly: RecurrenceRule = { freq: 'WEEKLY', interval: 1, weekdays: [4] };

describe('times in company time (the meeting form)', () => {
  it('shows an instant as the day and time in the zone given, and reads them back', () => {
    expect(toWallClock('2026-10-22T06:00:00.000Z', TZ)).toEqual({ day: '2026-10-22', time: '10:00' });
    expect(toWallClock('2026-10-22T21:30:00.000Z', TZ)).toEqual({ day: '2026-10-23', time: '01:30' });
    expect(toWallClock(null, TZ)).toBeNull();
    expect(fromWallClock('2026-10-22', '10:00', TZ)).toBe('2026-10-22T06:00:00.000Z');
    expect(fromWallClock('2026-10-22', '', TZ)).toBeNull();
    expect(fromWallClock('2026-13-40', '10:00', TZ)).toBeNull();
  });

  it('settles the offset across a clock change', () => {
    // London moves from BST to GMT on 25 Oct 2026.
    expect(fromWallClock('2026-10-24', '09:00', 'Europe/London')).toBe('2026-10-24T08:00:00.000Z');
    expect(fromWallClock('2026-10-26', '09:00', 'Europe/London')).toBe('2026-10-26T09:00:00.000Z');
  });

  it('starts a new meeting at the next whole hour', () => {
    expect(newMeetingDraft(TZ, new Date('2026-10-22T06:20:00.000Z'))).toMatchObject({ startDay: '2026-10-22', startTime: '11:00', endTime: '', title: '', status: 'SCHEDULED', rule: null, projectId: '' });
    expect(newMeetingDraft(TZ, new Date('2026-10-22T19:40:00.000Z'), 'p9')).toMatchObject({ startDay: '2026-10-23', startTime: '00:00', projectId: 'p9' });
  });

  it('reads a typed time leniently (Arabic digits, 9, 9:5 is not a time) and says what is wrong', () => {
    expect(parseTimeInput('09:30')).toEqual({ ok: true, value: '09:30' });
    expect(parseTimeInput('9:30')).toEqual({ ok: true, value: '09:30' });
    expect(parseTimeInput('9')).toEqual({ ok: true, value: '09:00' });
    expect(parseTimeInput('٠٩:٣٠')).toEqual({ ok: true, value: '09:30' });
    expect(parseTimeInput('')).toEqual({ ok: true, value: '' });
    expect(parseTimeInput('25:00')).toMatchObject({ ok: false });
    expect(parseTimeInput('9:5')).toMatchObject({ ok: false, error: 'Enter the time as HH:MM, e.g. 09:30.' });
  });

  it('matches the website’s reading of company time', async () => {
    const web = resolve(__dirname, '../../../Web Portal/frontend/src/lib/meetingFormat.ts');
    if (!existsSync(web)) return;
    const theirs = (await import(/* @vite-ignore */ web)) as {
      toLocalInputValue: (iso: string, tz: string) => string;
      fromLocalInputValue: (v: string, tz: string) => string | null;
      normalizeMeetingLink: (v: string) => string | null | undefined;
    };
    for (const iso of ['2026-10-22T06:00:00.000Z', '2026-03-29T00:30:00.000Z', '2026-12-31T23:59:00.000Z']) {
      for (const tz of [TZ, 'Europe/London', 'America/New_York']) {
        const mine = toWallClock(iso, tz)!;
        expect(`${mine.day}T${mine.time}`).toBe(theirs.toLocalInputValue(iso, tz));
        expect(fromWallClock(mine.day, mine.time, tz)).toBe(theirs.fromLocalInputValue(`${mine.day}T${mine.time}`, tz));
      }
    }
    for (const link of ['', ' meet.google.com/abc ', 'https://zoom.us/j/1?pwd=x', 'javascript:alert(1)', 'http://localhost:3000/x', 'not a link']) {
      expect(normalizeMeetingLink(link)).toBe(theirs.normalizeMeetingLink(link));
    }
  });
});

describe('online links', () => {
  it('adds https:// when none was typed, and refuses what isn’t a web link', () => {
    expect(normalizeMeetingLink('meet.google.com/abc-defg')).toBe('https://meet.google.com/abc-defg');
    expect(normalizeMeetingLink('  ')).toBeNull();
    expect(normalizeMeetingLink('javascript:alert(1)')).toBeUndefined();
    expect(normalizeMeetingLink('tel:123')).toBeUndefined();
  });
});

describe('the repeat of a new series', () => {
  it('moves the first meeting to the repeat’s first day, and says so', () => {
    // 2026-10-22 is a Thursday: a Monday repeat starts on the 26th.
    expect(firstMeetingDay('2026-10-22', { freq: 'WEEKLY', interval: 1, weekdays: [1] })).toBe('2026-10-26');
    expect(firstMeetingDay('2026-10-22', weekly)).toBe('2026-10-22');
    expect(firstMeetingNote('2026-10-22', { freq: 'WEEKLY', interval: 1, weekdays: [1] })).toBe('The first meeting will be on Mon 26 Oct, the first day this repeat gives.');
    expect(firstMeetingNote('2026-10-22', weekly)).toBeNull();
  });

  it('can’t end before the first meeting', () => {
    expect(repeatProblem({ ...weekly, until: '2026-10-20' }, '2026-10-22')).toBe('The repeat can’t end before the first meeting.');
    expect(repeatProblem(weekly, '2026-10-22')).toBeNull();
    expect(repeatProblem(null, '2026-10-22')).toBeNull();
  });

  it('describes it as the website does', async () => {
    expect(meetingRepeatText({ freq: 'WEEKLY', interval: 1 }, '2026-10-22T06:00:00.000Z', TZ)).toBe('Repeats every week on Thu');
    expect(meetingRepeatText({ ...weekly, until: '2026-11-03' }, '2026-10-22T06:00:00.000Z', TZ)).toBe('Repeats every week on Thu, until 3 Nov 2026');
    const web = resolve(__dirname, '../../../Web Portal/frontend/src/lib/meeting-repeat.ts');
    if (!existsSync(web)) return;
    const theirs = (await import(/* @vite-ignore */ web)) as {
      meetingRepeatText: (r: RecurrenceRule, s: string, tz: string) => string;
      firstMeetingDay: (d: string, r: RecurrenceRule) => string;
      repeatProblem: (r: RecurrenceRule | null, d: string) => string | null;
    };
    const rules: RecurrenceRule[] = [
      { freq: 'WEEKLY', interval: 1 },
      { freq: 'WEEKLY', interval: 2, weekdays: [1, 3], count: 6 },
      { freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 5 } },
      { freq: 'MONTHLY', interval: 1, dayOfMonth: 15, until: '2027-01-01' },
      { freq: 'DAILY', interval: 1, until: '2026-10-01' },
    ];
    for (const r of rules) {
      expect(meetingRepeatText(r, '2026-10-22T06:00:00.000Z', TZ)).toBe(theirs.meetingRepeatText(r, '2026-10-22T06:00:00.000Z', TZ));
      expect(firstMeetingDay('2026-10-22', r)).toBe(theirs.firstMeetingDay('2026-10-22', r));
      expect(repeatProblem(r, '2026-10-22')).toBe(theirs.repeatProblem(r, '2026-10-22'));
    }
  });
});

describe('a meeting’s series', () => {
  it('is its first meeting, and its rule is found on the meeting, its series, or nowhere', () => {
    expect(seriesIdOf(meeting())).toBeNull();
    expect(seriesIdOf(meeting({ recurrenceRule: weekly }))).toBe('m1');
    expect(seriesIdOf(meeting({ recurrenceParentId: 'm0' }))).toBe('m0');
    expect(meetingRule(meeting({ recurrenceParentId: 'm0', series: { id: 'm0', rule: weekly, timeZone: TZ } }))).toEqual(weekly);
    expect(meetingRule(meeting({ recurrenceRule: weekly }))).toEqual(weekly);
    expect(meetingRule(meeting())).toBeNull();
  });

  it('asks which meetings a change is for: a new repeat changes the whole series', () => {
    expect(scopeChoice(false)).toEqual({ scope: 'one', oneDisabled: null });
    expect(scopeChoice(true)).toEqual({ scope: 'series', oneDisabled: 'A new repeat changes the whole series.' });
  });

  it('offers Draft, Scheduled and In progress for a new meeting, every status for an existing one', () => {
    expect(statusOptions(false).map((o) => o.value)).toEqual(['DRAFT', 'SCHEDULED', 'IN_PROGRESS']);
    expect(statusOptions(true).map((o) => o.label)).toEqual(['Draft', 'Scheduled', 'In Progress', 'Completed', 'Cancelled']);
  });
});

describe('checking the form', () => {
  const draft = (over: Partial<MeetingDraft> = {}): MeetingDraft => ({ ...newMeetingDraft(TZ, new Date('2026-10-22T05:00:00.000Z')), title: 'Kick-off', ...over });

  it('builds what is sent: trimmed words, times in company time with the zone, empty fields as none', () => {
    const r = checkMeetingDraft(draft({ title: '  Kick-off  ', endTime: '11:30', location: ' ', onlineLink: 'zoom.us/j/1', description: ' Agenda ' }), { timeZone: TZ, seriesId: null });
    expect(r).toEqual({
      ok: true,
      payload: {
        title: 'Kick-off',
        startAt: '2026-10-22T06:00:00.000Z',
        endAt: '2026-10-22T07:30:00.000Z',
        timeZone: TZ,
        location: null,
        onlineLink: 'https://zoom.us/j/1',
        projectId: null,
        status: 'SCHEDULED',
        description: 'Agenda',
      },
      link: 'https://zoom.us/j/1',
    });
  });

  it('ends on another day only when that day is given; a new repeat goes with a new meeting', () => {
    const r = checkMeetingDraft(draft({ endDay: '2026-10-23', endTime: '09:00', rule: weekly }), { timeZone: TZ, seriesId: null });
    expect(r.ok && r.payload).toMatchObject({ endAt: '2026-10-23T05:00:00.000Z', recurrenceRule: weekly });
    // One meeting of a series keeps the series' repeat.
    const one = checkMeetingDraft(draft({ rule: weekly }), { timeZone: TZ, seriesId: 'm0' });
    expect(one.ok && 'recurrenceRule' in one.payload).toBe(false);
  });

  it('says what to fix, with the website’s words', () => {
    const check = (over: Partial<MeetingDraft>) => checkMeetingDraft(draft(over), { timeZone: TZ, seriesId: null });
    expect(check({ title: '  ' })).toEqual({ ok: false, field: 'title', message: 'A meeting title is required.' });
    expect(check({ startDay: '' })).toEqual({ ok: false, field: 'start', message: 'Choose when the meeting starts.' });
    expect(check({ startDay: '2026-02-31' })).toEqual({ ok: false, field: 'start', message: '2026-02-31 is not a real date.' });
    expect(check({ startTime: '7pm' })).toEqual({ ok: false, field: 'start', message: 'Enter the time as HH:MM, e.g. 09:30.' });
    expect(check({ endTime: '09:00' })).toEqual({ ok: false, field: 'end', message: 'The end time can’t be before the start time.' });
    expect(check({ endTime: '10:00' })).toEqual({ ok: false, field: 'end', message: 'The end time must be after the start time.' });
    expect(check({ endDay: '2026-10-23' })).toEqual({ ok: false, field: 'end', message: 'Add the end time, or clear the end date.' });
    expect(check({ onlineLink: 'javascript:x' })).toEqual({ ok: false, field: 'link', message: 'Enter a web link that starts with https:// (for example https://meet.google.com/abc-defg-hij).' });
    expect(check({ rule: { ...weekly, until: '2026-10-01' } })).toEqual({ ok: false, field: 'repeat', message: 'Check the repeat schedule below.' });
  });

  it('opens an existing meeting as it is, in company time', () => {
    expect(draftFromMeeting(meeting({ onlineLink: 'https://x.co/a', series: { id: 'm1', rule: weekly, timeZone: TZ } }), TZ)).toEqual({
      title: 'Weekly sync',
      startDay: '2026-10-22',
      startTime: '10:00',
      endDay: '',
      endTime: '11:00',
      location: 'Room 2',
      onlineLink: 'https://x.co/a',
      projectId: 'p1',
      status: 'SCHEDULED',
      description: 'Plans',
      rule: weekly,
    });
    // A meeting that runs past midnight keeps its end day.
    expect(draftFromMeeting(meeting({ endAt: '2026-10-22T21:00:00.000Z' }), TZ)).toMatchObject({ endDay: '2026-10-23', endTime: '01:00' });
  });
});

describe('what saving sends', () => {
  const opened = meeting({ recurrenceRule: weekly });

  it('creates a new meeting, or changes one meeting', () => {
    const create = saveRequest({ payload: { title: 'A', startAt: '2026-10-22T06:00:00.000Z' }, meeting: null, scope: 'one', ruleChanged: false, rule: null, timeZone: TZ });
    expect(create).toEqual({ kind: 'create', input: { title: 'A', startAt: '2026-10-22T06:00:00.000Z' } });
    const one = saveRequest({ payload: { title: 'B', startAt: opened.startAt }, meeting: opened, scope: 'one', ruleChanged: false, rule: weekly, timeZone: TZ });
    expect(one).toEqual({ kind: 'update', patch: { title: 'B', startAt: opened.startAt }, scope: 'one' });
  });

  it('gives a series only what changed, so a meeting moved on its own keeps its other details', () => {
    const payload = { title: 'Weekly sync', startAt: '2026-10-22T07:00:00.000Z', endAt: '2026-10-22T08:00:00.000Z', timeZone: TZ, location: 'Room 2', onlineLink: null, projectId: 'p1', status: 'SCHEDULED' as const, description: 'Plans' };
    expect(saveRequest({ payload, meeting: opened, scope: 'series', ruleChanged: false, rule: weekly, timeZone: TZ })).toEqual({
      kind: 'update',
      scope: 'series',
      patch: { startAt: '2026-10-22T07:00:00.000Z', endAt: '2026-10-22T08:00:00.000Z', timeZone: TZ },
    });
    const renamed = saveRequest({ payload: { ...payload, startAt: opened.startAt, endAt: opened.endAt, title: 'Sync', location: null }, meeting: opened, scope: 'series', ruleChanged: true, rule: { ...weekly, interval: 2 }, timeZone: TZ });
    expect(renamed).toEqual({ kind: 'update', scope: 'series', patch: { title: 'Sync', location: null, recurrenceRule: { ...weekly, interval: 2 } } });
    // Nothing changed: nothing is sent (and nobody is emailed).
    expect(saveRequest({ payload: { ...payload, startAt: opened.startAt, endAt: opened.endAt }, meeting: opened, scope: 'series', ruleChanged: false, rule: weekly, timeZone: TZ })).toEqual({ kind: 'none' });
  });

  it('says why a save was refused', () => {
    expect(saveFailureText(new ApiError(403, 'FORBIDDEN', 'x'), true)).toBe('You don’t have permission to change this meeting.');
    expect(saveFailureText(new ApiError(403, 'FORBIDDEN', 'x'), false)).toBe('You don’t have access to that project.');
    expect(saveFailureText(new ApiError(400, 'VALIDATION', 'The repeat needs at least one day.'), false)).toBe('The repeat needs at least one day.');
    expect(saveFailureText(new ApiError(500, 'ERROR', 'Request failed (500)'), true)).toBe('Couldn’t save changes. Check the title, times and link.');
    expect(saveFailureText(new ApiError(500, 'ERROR', 'Request failed (500)'), false)).toBe('Couldn’t create the meeting. Check the title, times and link.');
    expect(saveFailureText(new NetworkError('offline'), false)).toBe('You’re offline — this needs a connection. Nothing was saved; try again when you’re online.');
    expect(saveFailureText(new NetworkError('slow', { timedOut: true }), false)).toBe('The server took too long to answer — the meeting may already be saved. Tap again to finish: it won’t be scheduled twice.');
    expect(saveFailureText(new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'x'), false)).toBe('The meeting is still being saved — try again in a moment.');
  });

  it('keeps the same try’s key only while the server may still have it (no answer, or still saving)', () => {
    expect(keepsSaveKey(new NetworkError('offline'))).toBe(true);
    expect(keepsSaveKey(new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'x'))).toBe(true);
    // The server keeps a refusal under its key: a fixed form must be sent as a new try.
    expect(keepsSaveKey(new ApiError(403, 'FORBIDDEN', 'x'))).toBe(false);
    expect(keepsSaveKey(new ApiError(400, 'VALIDATION', 'x'))).toBe(false);
  });
});
