import { describe, it, expect } from 'vitest';
import { firstMeetingDay, meetingRepeatText, repeatProblem } from './meeting-repeat';

describe('meeting repeat wording', () => {
  it('names the weekday of a weekly meeting without chosen days', () => {
    // Tue 20 Oct 2026, 10:00 in Muscat.
    expect(meetingRepeatText({ freq: 'WEEKLY', interval: 1 }, '2026-10-20T06:00:00.000Z', 'Asia/Muscat')).toBe('Repeats every week on Tue');
  });

  it('uses the meeting’s own day, not UTC’s', () => {
    // 01:00 on Wed 21 Oct in Muscat is still Tuesday in UTC.
    expect(meetingRepeatText({ freq: 'WEEKLY', interval: 2 }, '2026-10-20T21:00:00.000Z', 'Asia/Muscat')).toBe('Repeats every 2 weeks on Wed');
  });

  it('says how the series ends', () => {
    expect(meetingRepeatText({ freq: 'DAILY', interval: 1, until: '2026-11-03' }, '2026-10-20T06:00:00.000Z', 'Asia/Muscat')).toBe('Repeats every day, until 3 Nov 2026');
    expect(meetingRepeatText({ freq: 'MONTHLY', interval: 1, count: 6 }, '2026-10-20T06:00:00.000Z', 'Asia/Muscat')).toBe('Repeats every month, 6 times');
    expect(meetingRepeatText({ freq: 'WEEKLY', interval: 1, weekdays: [1, 3] }, '2026-10-20T06:00:00.000Z', 'Asia/Muscat')).toBe('Repeats every week on Mon, Wed');
  });

  it('finds the day the first meeting will be on', () => {
    // Tue 20 Oct with "Mon, Wed": the first meeting is Wednesday.
    expect(firstMeetingDay('2026-10-20', { freq: 'WEEKLY', interval: 1, weekdays: [1, 3] })).toBe('2026-10-21');
    expect(firstMeetingDay('2026-10-20', { freq: 'WEEKLY', interval: 1, weekdays: [2, 4] })).toBe('2026-10-20');
    expect(firstMeetingDay('2026-10-20', { freq: 'WEEKLY', interval: 1 })).toBe('2026-10-20');
    expect(firstMeetingDay('2026-10-10', { freq: 'MONTHLY', interval: 1, dayOfMonth: 20 })).toBe('2026-10-20');
    expect(firstMeetingDay('2026-10-20', { freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 5 } })).toBe('2026-10-30');
    expect(firstMeetingDay('2026-10-30', { freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 5 } })).toBe('2026-10-30');
  });

  it('finds the first meeting’s day whatever the count or end date (the server moves it all the same)', () => {
    expect(firstMeetingDay('2026-10-20', { freq: 'WEEKLY', interval: 1, weekdays: [1, 3], count: 1 })).toBe('2026-10-21');
    expect(firstMeetingDay('2026-10-20', { freq: 'WEEKLY', interval: 1, weekdays: [1, 3], until: '2026-10-20' })).toBe('2026-10-21');
  });

  it('flags an end date before the first meeting', () => {
    expect(repeatProblem({ freq: 'DAILY', interval: 1, until: '2026-10-19' }, '2026-10-20')).toMatch(/can’t end before the first meeting/);
    expect(repeatProblem({ freq: 'DAILY', interval: 1, until: '2026-10-20' }, '2026-10-20')).toBeNull();
    expect(repeatProblem(null, '2026-10-20')).toBeNull();
  });
});
