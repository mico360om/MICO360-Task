import { describe, it, expect } from 'vitest';
import { formBoardDate, scheduledNote, startsText, waitingDay } from './scheduled-start';

const TZ = 'Asia/Muscat';
const NOW = new Date('2026-11-10T06:00:00Z'); // 10:00 on 10 Nov in Muscat

describe('waitingDay — a task waiting for its start day (tasks scheduled for the future)', () => {
  it('its board day while that is later than today, and it isn’t done', () => {
    expect(waitingDay({ boardDate: '2026-11-20T12:00:00.000Z' }, TZ, NOW)).toBe('2026-11-20');
    expect(waitingDay({ boardDate: '2026-11-10T12:00:00.000Z' }, TZ, NOW)).toBeNull();
    expect(waitingDay({ boardDate: '2026-11-03T12:00:00.000Z' }, TZ, NOW)).toBeNull();
    expect(waitingDay({ boardDate: null }, TZ, NOW)).toBeNull();
    expect(waitingDay({}, TZ, NOW)).toBeNull();
    expect(waitingDay({ boardDate: '2026-11-20T12:00:00.000Z', completedAt: '2026-11-10T05:00:00.000Z' }, TZ, NOW)).toBeNull();
    expect(waitingDay({ boardDate: '2026-11-20T12:00:00.000Z', columnCategory: 'DONE' }, TZ, NOW)).toBeNull();
  });

  it('“today” is the company’s: just after midnight in Muscat, tomorrow’s task is today’s', () => {
    const justAfterMidnight = new Date('2026-11-10T20:30:00Z'); // 00:30 on 11 Nov in Muscat
    expect(waitingDay({ boardDate: '2026-11-11T12:00:00.000Z' }, TZ, justAfterMidnight)).toBeNull();
    expect(waitingDay({ boardDate: '2026-11-11T12:00:00.000Z' }, 'UTC', justAfterMidnight)).toBe('2026-11-11');
  });
});

describe('the form’s words', () => {
  it('“Scheduled for 20 Nov” under a start date later than today; nothing otherwise', () => {
    expect(scheduledNote('2026-11-20', '2026-11-10')).toBe('Scheduled for 20 Nov — it waits under Upcoming until then.');
    expect(scheduledNote('2027-01-04', '2026-11-10')).toBe('Scheduled for 4 Jan 2027 — it waits under Upcoming until then.');
    expect(scheduledNote('2026-11-10', '2026-11-10')).toBeNull();
    expect(scheduledNote('2026-11-02', '2026-11-10')).toBeNull();
    expect(scheduledNote('', '2026-11-10')).toBeNull();
  });

  it('“Starts 20 Nov” on a waiting task', () => {
    expect(startsText('2026-11-20', '2026-11-10')).toBe('Starts 20 Nov');
    expect(startsText('2027-01-04', '2026-11-10')).toBe('Starts 4 Jan 2027');
  });
});

describe('formBoardDate — the board day a new task’s form sends', () => {
  it('the board’s day, unless a start later than today was picked (then the server puts it on the start day)', () => {
    expect(formBoardDate('2026-11-10', '', '2026-11-10')).toBe('2026-11-10');
    expect(formBoardDate('2026-11-10', '2026-11-20', '2026-11-10')).toBeUndefined();
    expect(formBoardDate('2026-11-18', '2026-11-20', '2026-11-10')).toBeUndefined();
    expect(formBoardDate('2026-11-18', '2026-11-05', '2026-11-10')).toBe('2026-11-18');
    expect(formBoardDate(undefined, '2026-11-20', '2026-11-10')).toBeUndefined();
  });
});
