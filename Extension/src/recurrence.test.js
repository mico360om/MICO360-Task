import { describe, it, expect } from 'vitest';
import {
  recurrenceSummary, isRecurring, inSeries, withFreq, withInterval, toggleWeekday, withMonthlyMode, withNth,
  withEnds, withCreateNext, togglePaused, nthWeekdayOf, isEarlierCopy,
} from './recurrence.js';

describe('recurrenceSummary (same wording as the web and Android apps)', () => {
  it('describes frequency, interval and days', () => {
    expect(recurrenceSummary({ freq: 'DAILY', interval: 1 })).toBe('Repeats every day');
    expect(recurrenceSummary({ freq: 'WEEKLY', interval: 2, weekdays: [4, 0] })).toBe('Repeats every 2 weeks on Sun, Thu');
    expect(recurrenceSummary({ freq: 'MONTHLY', interval: 1, dayOfMonth: 15 })).toBe('Repeats every month on day 15');
    expect(recurrenceSummary({ freq: 'MONTHLY', interval: 1, dayOfMonth: 31 })).toBe('Repeats every month on the last day');
    expect(recurrenceSummary({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } })).toBe('Repeats every month on the 2nd Tuesday');
    expect(recurrenceSummary({ freq: 'QUARTERLY', interval: 1, nthWeekday: { week: -1, day: 5 } })).toBe('Repeats every quarter on the last Friday');
  });

  it('adds the end, the schedule mode and pause', () => {
    expect(recurrenceSummary({ freq: 'DAILY', interval: 1, count: 5 })).toBe('Repeats every day, 5 times');
    expect(recurrenceSummary({ freq: 'DAILY', interval: 1, until: '2026-12-31' })).toBe('Repeats every day, until 2026-12-31');
    expect(recurrenceSummary({ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE', paused: true })).toBe('Repeats every day · new copy on each date (paused)');
  });
});

describe('series membership', () => {
  it('the newest copy carries the rule; every copy links to the series', () => {
    expect(isRecurring({ recurrenceRule: { freq: 'DAILY', interval: 1 } })).toBe(true);
    expect(isRecurring({ recurrenceRule: null, recurrenceParentId: 'x' })).toBe(false);
    expect(inSeries({ recurrenceRule: null, recurrenceParentId: 'x' })).toBe(true);
    expect(inSeries({})).toBe(false);
  });

  it('an earlier copy is one that already has its next copy', () => {
    expect(isEarlierCopy({ recurrenceParentId: 'x', recurrenceNextId: 'y' })).toBe(true);
    // The newest copy with its repeat switched off can turn it back on.
    expect(isEarlierCopy({ recurrenceParentId: 'x', recurrenceRule: null, recurrenceNextId: null })).toBe(false);
    expect(isEarlierCopy({})).toBe(false);
  });
});

describe('editing a rule', () => {
  it('starts, changes and stops repeating, keeping how it ends and when copies are made', () => {
    expect(withFreq(null, 'WEEKLY')).toEqual({ freq: 'WEEKLY', interval: 1 });
    expect(withFreq({ freq: 'MONTHLY', interval: 2, dayOfMonth: 5, count: 3, createNext: 'ON_SCHEDULE' }, 'WEEKLY'))
      .toEqual({ freq: 'WEEKLY', interval: 2, count: 3, createNext: 'ON_SCHEDULE' });
    expect(withFreq({ freq: 'DAILY', interval: 1 }, 'NONE')).toBeNull();
  });

  it('sets the interval (at least 1) and toggles weekdays in order', () => {
    expect(withInterval({ freq: 'DAILY', interval: 1 }, 3)).toEqual({ freq: 'DAILY', interval: 3 });
    expect(withInterval({ freq: 'DAILY', interval: 1 }, 0)).toEqual({ freq: 'DAILY', interval: 1 });
    expect(toggleWeekday({ freq: 'WEEKLY', interval: 1, weekdays: [4] }, 0)).toEqual({ freq: 'WEEKLY', interval: 1, weekdays: [0, 4] });
    expect(toggleWeekday({ freq: 'WEEKLY', interval: 1, weekdays: [0, 4] }, 4)).toEqual({ freq: 'WEEKLY', interval: 1, weekdays: [0] });
  });

  it('switches a monthly rule between a date and "the 2nd Tuesday" (suggested from the due date)', () => {
    expect(nthWeekdayOf('2026-10-13')).toEqual({ week: 2, day: 2 });
    expect(nthWeekdayOf('2026-10-30')).toEqual({ week: -1, day: 5 });
    expect(withMonthlyMode({ freq: 'MONTHLY', interval: 1, dayOfMonth: 13, anchorDay: 13 }, 'WEEKDAY', '2026-10-13'))
      .toEqual({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } });
    expect(withMonthlyMode({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } }, 'DATE')).toEqual({ freq: 'MONTHLY', interval: 1 });
    expect(withNth({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } }, { week: -1 })).toEqual({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 2 } });
  });

  it('sets how the series ends', () => {
    const r = { freq: 'DAILY', interval: 1 };
    expect(withEnds(r, 'COUNT')).toEqual({ ...r, count: 10, until: null });
    expect(withEnds(r, 'UNTIL', '2026-11-01')).toEqual({ ...r, until: '2026-11-01', count: null });
    expect(withEnds({ ...r, count: 4 }, 'NEVER')).toEqual({ ...r, count: null, until: null });
  });

  it('chooses when copies are made and pauses', () => {
    expect(withCreateNext({ freq: 'DAILY', interval: 1 }, 'ON_SCHEDULE')).toEqual({ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' });
    expect(withCreateNext({ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' }, 'ON_COMPLETE')).toEqual({ freq: 'DAILY', interval: 1 });
    expect(togglePaused({ freq: 'DAILY', interval: 1 })).toEqual({ freq: 'DAILY', interval: 1, paused: true });
    expect(togglePaused({ freq: 'DAILY', interval: 1, paused: true })).toEqual({ freq: 'DAILY', interval: 1, paused: false });
  });
});
