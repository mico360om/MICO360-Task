import { describe, it, expect } from 'vitest';
import { recurrenceSummary } from './recurrence-summary';

describe('recurrenceSummary', () => {
  it('describes a simple daily rule', () => {
    expect(recurrenceSummary({ freq: 'DAILY', interval: 1 })).toBe('Repeats every day');
  });

  it('pluralises the interval', () => {
    expect(recurrenceSummary({ freq: 'WEEKLY', interval: 2 })).toBe('Repeats every 2 weeks');
  });

  it('lists weekdays for a weekly rule', () => {
    expect(recurrenceSummary({ freq: 'WEEKLY', interval: 1, weekdays: [1, 3, 5] })).toBe('Repeats every week on Mon, Wed, Fri');
  });

  it('names the day of month for monthly/quarterly rules', () => {
    expect(recurrenceSummary({ freq: 'MONTHLY', interval: 1, dayOfMonth: 15 })).toBe('Repeats every month on day 15');
  });

  it('appends end conditions and the paused flag', () => {
    expect(recurrenceSummary({ freq: 'DAILY', interval: 1, count: 5 })).toBe('Repeats every day, 5 times');
    expect(recurrenceSummary({ freq: 'DAILY', interval: 1, until: '2026-12-31T00:00:00.000Z' })).toBe('Repeats every day, until 2026-12-31');
    expect(recurrenceSummary({ freq: 'DAILY', interval: 1, paused: true })).toBe('Repeats every day (paused)');
  });
});
