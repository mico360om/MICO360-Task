import { describe, it, expect } from 'vitest';
import { recurrenceSummary, upcomingDates } from './recurrence-summary';

describe('recurrenceSummary', () => {
  it('summarises simple intervals', () => {
    expect(recurrenceSummary({ freq: 'DAILY', interval: 1 })).toBe('Repeats every day');
    expect(recurrenceSummary({ freq: 'DAILY', interval: 3 })).toBe('Repeats every 3 days');
    expect(recurrenceSummary({ freq: 'WEEKLY', interval: 1 })).toBe('Repeats every week');
    expect(recurrenceSummary({ freq: 'WEEKLY', interval: 2 })).toBe('Repeats every 2 weeks');
    expect(recurrenceSummary({ freq: 'MONTHLY', interval: 1 })).toBe('Repeats every month');
    expect(recurrenceSummary({ freq: 'YEARLY', interval: 1 })).toBe('Repeats every year');
  });

  it('names the weekdays for a weekly rule', () => {
    expect(recurrenceSummary({ freq: 'WEEKLY', interval: 1, weekdays: [1, 3, 5] })).toBe('Repeats every week on Mon, Wed, Fri');
  });

  it('names the day of month for a monthly rule', () => {
    expect(recurrenceSummary({ freq: 'MONTHLY', interval: 1, dayOfMonth: 15 })).toBe('Repeats every month on day 15');
  });

  it('names "the 2nd Tuesday" / "the last Friday"', () => {
    expect(recurrenceSummary({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } })).toBe('Repeats every month on the 2nd Tuesday');
    expect(recurrenceSummary({ freq: 'QUARTERLY', interval: 1, nthWeekday: { week: -1, day: 5 } })).toBe('Repeats every quarter on the last Friday');
  });

  it('calls day 31 the last day of the month (it is clamped to each month’s length)', () => {
    expect(recurrenceSummary({ freq: 'MONTHLY', interval: 1, dayOfMonth: 31 })).toBe('Repeats every month on the last day');
  });

  it('says when copies are made on schedule rather than on completion', () => {
    expect(recurrenceSummary({ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' })).toBe('Repeats every day · new copy on each date');
    expect(recurrenceSummary({ freq: 'DAILY', interval: 1, createNext: 'ON_COMPLETE' })).toBe('Repeats every day');
  });

  it('appends a count when present', () => {
    expect(recurrenceSummary({ freq: 'DAILY', interval: 1, count: 5 })).toBe('Repeats every day, 5 times');
  });
});

describe('upcomingDates', () => {
  it('lists the next dates after the due date', () => {
    expect(upcomingDates('2026-10-30', { freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 5 } })).toEqual(['2026-11-27', '2026-12-25', '2027-01-29']);
    expect(upcomingDates('2026-10-01', { freq: 'WEEKLY', interval: 1, weekdays: [0, 4] })).toEqual(['2026-10-04', '2026-10-08', '2026-10-11']);
  });

  it('keeps a month-end series on the last day', () => {
    expect(upcomingDates('2026-01-31', { freq: 'MONTHLY', interval: 1 })).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('stops where the series ends', () => {
    expect(upcomingDates('2026-10-01', { freq: 'DAILY', interval: 1, count: 2 })).toEqual(['2026-10-02']);
    expect(upcomingDates('2026-10-01', { freq: 'DAILY', interval: 1, until: '2026-10-02' })).toEqual(['2026-10-02']);
  });

  it('is empty without a valid due date', () => {
    expect(upcomingDates('', { freq: 'DAILY', interval: 1 })).toEqual([]);
  });
});
