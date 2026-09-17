import { describe, it, expect } from 'vitest';
import { recurrenceSummary } from './recurrence-summary';

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

  it('appends a count when present', () => {
    expect(recurrenceSummary({ freq: 'DAILY', interval: 1, count: 5 })).toBe('Repeats every day, 5 times');
  });
});
