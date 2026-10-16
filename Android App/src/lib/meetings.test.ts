import { describe, it, expect } from 'vitest';
import { buildAgenda, isRepeating, joinLink, meetingPlace, meetingTime, meetingWindow, meetingDayKey } from './meetings';
import type { ApiMeeting, ApiTask } from './types';

const meeting = (id: string, patch: Partial<ApiMeeting> = {}): ApiMeeting => ({
  id,
  title: id,
  description: null,
  status: 'SCHEDULED',
  projectId: 'p1',
  organizerId: 'u1',
  location: null,
  onlineLink: null,
  startAt: '2026-10-20T06:00:00.000Z',
  endAt: '2026-10-20T07:00:00.000Z',
  timeZone: 'Asia/Muscat',
  recurrenceRule: null,
  recurrenceParentId: null,
  ...patch,
});

const task = (id: string, dueDate: string | null): ApiTask => ({
  id,
  key: `T-${id}`,
  title: id,
  description: null,
  projectId: 'p1',
  columnId: 'c1',
  position: 0,
  priority: 'NORMAL',
  startDate: null,
  dueDate,
  estimatedHours: null,
  progress: 0,
  completedAt: null,
});

describe('meetingDayKey', () => {
  it('is the meeting day in company time (Muscat), not UTC', () => {
    // 22:30 UTC on the 19th is 02:30 on the 20th in Muscat.
    expect(meetingDayKey(meeting('a', { startAt: '2026-10-19T22:30:00.000Z' }))).toBe('2026-10-20');
  });
});

describe('meetingTime', () => {
  it('gives the start and end in company time', () => {
    expect(meetingTime(meeting('a'))).toBe('10:00 – 11:00');
  });

  it('gives just the start when the meeting has no end', () => {
    expect(meetingTime(meeting('a', { endAt: null }))).toBe('10:00');
  });
});

describe('meetingPlace', () => {
  it('prefers the room, then says Online for a link, else nothing', () => {
    expect(meetingPlace(meeting('a', { location: ' Room 2 ', onlineLink: 'https://meet.example.com/x' }))).toBe('Room 2');
    expect(meetingPlace(meeting('b', { onlineLink: 'https://meet.example.com/x' }))).toBe('Online');
    expect(meetingPlace(meeting('c', { location: '  ' }))).toBeNull();
  });
});

describe('isRepeating', () => {
  it('is true for the first meeting of a series and for its later meetings', () => {
    expect(isRepeating(meeting('root', { recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [2] } }))).toBe(true);
    expect(isRepeating(meeting('child', { recurrenceParentId: 'root' }))).toBe(true);
    expect(isRepeating(meeting('one-off'))).toBe(false);
  });
});

describe('meetingWindow', () => {
  it('covers a week back and two months ahead', () => {
    const w = meetingWindow(new Date('2026-10-16T12:00:00.000Z'));
    expect(w).toEqual({ from: '2026-10-09T12:00:00.000Z', to: '2026-12-15T12:00:00.000Z' });
  });
});

describe('buildAgenda', () => {
  it('puts tasks (by due day) and meetings (by company-time day) on the same days, in order', () => {
    const days = buildAgenda(
      [task('t2', '2026-10-21T00:00:00.000Z'), task('t1', '2026-10-20T00:00:00.000Z'), task('none', null)],
      [
        meeting('late', { startAt: '2026-10-20T10:00:00.000Z', endAt: null }),
        meeting('early', { startAt: '2026-10-20T05:00:00.000Z', endAt: null }),
        meeting('only', { startAt: '2026-10-22T05:00:00.000Z', endAt: null }),
      ],
    );
    expect(days.map((d) => [d.date, d.tasks.map((t) => t.id), d.meetings.map((m) => m.id)])).toEqual([
      ['2026-10-20', ['t1'], ['early', 'late']],
      ['2026-10-21', ['t2'], []],
      ['2026-10-22', [], ['only']],
    ]);
  });

  it('keeps a UTC-midnight due date on its own calendar day (XP-03)', () => {
    // Stored as UTC midnight; on a phone west of UTC `new Date(...).getDate()` would say the 29th.
    expect(buildAgenda([task('a', '2026-09-30T00:00:00.000Z')], [])[0]!.date).toBe('2026-09-30');
  });

  it('is empty when nothing is scheduled', () => {
    expect(buildAgenda([task('a', null)], [])).toEqual([]);
  });

  it('works with no meetings (an older server)', () => {
    expect(buildAgenda([task('t1', '2026-10-20T00:00:00.000Z')], []).map((d) => d.date)).toEqual(['2026-10-20']);
  });
});

describe('joinLink', () => {
  it('opens only web links', () => {
    expect(joinLink(meeting('a', { onlineLink: ' https://meet.example.com/abc ' }))).toBe('https://meet.example.com/abc');
    expect(joinLink(meeting('b', { onlineLink: 'http://meet.example.com/abc' }))).toBe('http://meet.example.com/abc');
    expect(joinLink(meeting('c', { onlineLink: 'javascript:alert(1)' }))).toBeNull();
    expect(joinLink(meeting('d', { onlineLink: 'intent://evil' }))).toBeNull();
    expect(joinLink(meeting('e'))).toBeNull();
  });
});
