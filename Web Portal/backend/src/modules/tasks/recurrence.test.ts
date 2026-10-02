import { describe, it, expect } from 'vitest';
import { nextOccurrence, generateOccurrences, isValidRule, withAnchorDay, nextDueDate, scheduledOccurrence, type RecurrenceRule } from './recurrence';

const utc = (s: string) => new Date(`${s}T09:30:00.000Z`);
const iso = (d: Date) => d.toISOString();

describe('nextOccurrence', () => {
  it('DAILY advances by the interval in days', () => {
    expect(iso(nextOccurrence(utc('2026-01-01'), { freq: 'DAILY', interval: 1 }))).toBe(iso(utc('2026-01-02')));
    expect(iso(nextOccurrence(utc('2026-01-01'), { freq: 'DAILY', interval: 3 }))).toBe(iso(utc('2026-01-04')));
  });

  it('preserves the time of day', () => {
    const from = new Date('2026-01-01T14:45:00.000Z');
    expect(nextOccurrence(from, { freq: 'DAILY', interval: 1 }).toISOString()).toBe('2026-01-02T14:45:00.000Z');
  });

  it('WEEKLY without weekdays advances by interval weeks', () => {
    expect(iso(nextOccurrence(utc('2026-01-01'), { freq: 'WEEKLY', interval: 1 }))).toBe(iso(utc('2026-01-08')));
    expect(iso(nextOccurrence(utc('2026-01-01'), { freq: 'WEEKLY', interval: 2 }))).toBe(iso(utc('2026-01-15')));
  });

  it('WEEKLY with weekdays returns the next matching weekday (Mon/Wed/Fri)', () => {
    // 2026-01-05 is a Monday; next of Mon/Wed/Fri is Wed the 7th
    expect(iso(nextOccurrence(utc('2026-01-05'), { freq: 'WEEKLY', interval: 1, weekdays: [1, 3, 5] }))).toBe(iso(utc('2026-01-07')));
    // From Fri the 9th it wraps to Mon the 12th
    expect(iso(nextOccurrence(utc('2026-01-09'), { freq: 'WEEKLY', interval: 1, weekdays: [1, 3, 5] }))).toBe(iso(utc('2026-01-12')));
  });

  it('WEEKLY with weekdays honours the interval: "every 2 weeks on Monday" is fortnightly', () => {
    // 2026-01-05 is a Monday.
    const rule: RecurrenceRule = { freq: 'WEEKLY', interval: 2, weekdays: [1] };
    expect(iso(nextOccurrence(utc('2026-01-05'), rule))).toBe(iso(utc('2026-01-19')));
    const dates = generateOccurrences(utc('2026-01-05'), rule, 4).map((d) => d.toISOString().slice(0, 10));
    expect(dates).toEqual(['2026-01-05', '2026-01-19', '2026-02-02', '2026-02-16']);
  });

  it('WEEKLY with several weekdays stays within the week, then skips interval − 1 weeks', () => {
    const rule: RecurrenceRule = { freq: 'WEEKLY', interval: 2, weekdays: [1, 3] }; // Mon + Wed, every other week
    expect(iso(nextOccurrence(utc('2026-01-05'), rule))).toBe(iso(utc('2026-01-07'))); // Mon → Wed same week
    expect(iso(nextOccurrence(utc('2026-01-07'), rule))).toBe(iso(utc('2026-01-19'))); // Wed → Mon two weeks on
  });

  it('MONTHLY with an anchor day returns to the 31st after a short month', () => {
    const rule: RecurrenceRule = { freq: 'MONTHLY', interval: 1, anchorDay: 31 };
    const dates = generateOccurrences(utc('2026-01-31'), rule, 4).map((d) => d.toISOString().slice(0, 10));
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('YEARLY with an anchor day returns to 29 Feb in leap years', () => {
    const rule: RecurrenceRule = { freq: 'YEARLY', interval: 1, anchorDay: 29 };
    const dates = generateOccurrences(utc('2024-02-29'), rule, 5).map((d) => d.toISOString().slice(0, 10));
    expect(dates).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });

  it('withAnchorDay pins month-based rules to the start day unless a day is already set', () => {
    expect(withAnchorDay({ freq: 'MONTHLY', interval: 1 }, utc('2026-01-31'))).toEqual({ freq: 'MONTHLY', interval: 1, anchorDay: 31 });
    expect(withAnchorDay({ freq: 'MONTHLY', interval: 1, dayOfMonth: 5 }, utc('2026-01-31'))).toEqual({ freq: 'MONTHLY', interval: 1, dayOfMonth: 5 });
    expect(withAnchorDay({ freq: 'WEEKLY', interval: 1 }, utc('2026-01-31'))).toEqual({ freq: 'WEEKLY', interval: 1 });
    expect(withAnchorDay({ freq: 'YEARLY', interval: 1 }, null)).toEqual({ freq: 'YEARLY', interval: 1 });
    // "The 2nd Tuesday" already fixes the day.
    expect(withAnchorDay({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } }, utc('2026-01-31'))).toEqual({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } });
  });

  it('MONTHLY advances by interval months, clamping to the month length', () => {
    expect(iso(nextOccurrence(utc('2026-01-15'), { freq: 'MONTHLY', interval: 1 }))).toBe(iso(utc('2026-02-15')));
    // Jan 31 -> Feb has only 28 days in 2026
    expect(iso(nextOccurrence(utc('2026-01-31'), { freq: 'MONTHLY', interval: 1 }))).toBe(iso(utc('2026-02-28')));
  });

  it('MONTHLY honours an explicit dayOfMonth — this month’s when it is still ahead', () => {
    // "Monthly on the 20th" for a task due 10 Jan: the next one is 20 Jan, not 20 Feb.
    expect(iso(nextOccurrence(utc('2026-01-10'), { freq: 'MONTHLY', interval: 1, dayOfMonth: 20 }))).toBe(iso(utc('2026-01-20')));
    expect(iso(nextOccurrence(utc('2026-01-20'), { freq: 'MONTHLY', interval: 1, dayOfMonth: 20 }))).toBe(iso(utc('2026-02-20')));
    expect(iso(nextOccurrence(utc('2026-01-25'), { freq: 'MONTHLY', interval: 1, dayOfMonth: 20 }))).toBe(iso(utc('2026-02-20')));
    expect(iso(nextOccurrence(utc('2026-01-10'), { freq: 'MONTHLY', interval: 3, dayOfMonth: 20 }))).toBe(iso(utc('2026-01-20')));
  });

  it('MONTHLY dayOfMonth is clamped to the month, also within the current month', () => {
    expect(iso(nextOccurrence(utc('2026-02-10'), { freq: 'MONTHLY', interval: 1, dayOfMonth: 31 }))).toBe(iso(utc('2026-02-28')));
    expect(iso(nextOccurrence(utc('2026-02-28'), { freq: 'MONTHLY', interval: 1, dayOfMonth: 31 }))).toBe(iso(utc('2026-03-31')));
  });

  it('QUARTERLY dayOfMonth takes this month’s date when still ahead, then steps by quarters', () => {
    expect(iso(nextOccurrence(utc('2026-01-10'), { freq: 'QUARTERLY', interval: 1, dayOfMonth: 20 }))).toBe(iso(utc('2026-01-20')));
    expect(iso(nextOccurrence(utc('2026-01-20'), { freq: 'QUARTERLY', interval: 1, dayOfMonth: 20 }))).toBe(iso(utc('2026-04-20')));
  });

  it('YEARLY advances by interval years, clamping Feb 29', () => {
    expect(iso(nextOccurrence(utc('2026-03-01'), { freq: 'YEARLY', interval: 1 }))).toBe(iso(utc('2027-03-01')));
    // 2024-02-29 (leap) -> 2025-02-28 (non-leap)
    expect(iso(nextOccurrence(utc('2024-02-29'), { freq: 'YEARLY', interval: 1 }))).toBe(iso(utc('2025-02-28')));
  });

  it('QUARTERLY advances by 3 months per interval, clamping the day', () => {
    expect(iso(nextOccurrence(utc('2026-01-15'), { freq: 'QUARTERLY', interval: 1 }))).toBe(iso(utc('2026-04-15')));
    expect(iso(nextOccurrence(utc('2026-01-15'), { freq: 'QUARTERLY', interval: 2 }))).toBe(iso(utc('2026-07-15')));
    // Nov 30 + 1 quarter -> Feb has only 28 days
    expect(iso(nextOccurrence(utc('2025-11-30'), { freq: 'QUARTERLY', interval: 1 }))).toBe(iso(utc('2026-02-28')));
  });
});

describe('nextOccurrence — "the 2nd Tuesday" / "the last Friday" (nthWeekday)', () => {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const secondTuesday: RecurrenceRule = { freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } };
  const lastFriday: RecurrenceRule = { freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 5 } };

  it('MONTHLY moves to that weekday of the next month', () => {
    expect(day(nextOccurrence(utc('2026-10-13'), secondTuesday))).toBe('2026-11-10');
    expect(day(nextOccurrence(utc('2026-11-10'), secondTuesday))).toBe('2026-12-08');
  });

  it('takes this month’s one when it is still ahead', () => {
    expect(day(nextOccurrence(utc('2026-10-01'), secondTuesday))).toBe('2026-10-13');
    expect(day(nextOccurrence(utc('2026-10-01'), lastFriday))).toBe('2026-10-30');
  });

  it('"last" finds the final such weekday of the month', () => {
    expect(generateOccurrences(utc('2026-10-30'), lastFriday, 3).map(day)).toEqual(['2026-10-30', '2026-11-27', '2026-12-25']);
  });

  it('honours the interval and QUARTERLY', () => {
    expect(day(nextOccurrence(utc('2026-10-13'), { ...secondTuesday, interval: 2 }))).toBe('2026-12-08');
    expect(day(nextOccurrence(utc('2026-10-13'), { ...secondTuesday, freq: 'QUARTERLY' }))).toBe('2027-01-12');
  });

  it('keeps the time of day', () => {
    expect(nextOccurrence(utc('2026-10-13'), secondTuesday).toISOString()).toBe('2026-11-10T09:30:00.000Z');
  });
});

describe('nextDueDate — the next occurrence, never already overdue', () => {
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const midnight = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it('is the next occurrence after the due date when that is today or later', () => {
    expect(day(nextDueDate(midnight('2026-10-01'), { freq: 'DAILY', interval: 1 }, '2026-10-01'))).toBe('2026-10-02');
    expect(day(nextDueDate(midnight('2026-10-10'), { freq: 'DAILY', interval: 1 }, '2026-10-01'))).toBe('2026-10-11');
  });

  it('skips occurrences that are already in the past, but keeps today’s', () => {
    // A daily task due 25 Sep, completed on 1 Oct: the next one is due today, not on 26 Sep.
    expect(day(nextDueDate(midnight('2026-09-25'), { freq: 'DAILY', interval: 1 }, '2026-10-01'))).toBe('2026-10-01');
    // Weekly on Monday, due Mon 7 Sep, completed Thu 1 Oct → Mon 5 Oct.
    expect(day(nextDueDate(midnight('2026-09-07'), { freq: 'WEEKLY', interval: 1, weekdays: [1] }, '2026-10-01'))).toBe('2026-10-05');
  });

  it('keeps the series’ rhythm while skipping (every 3 days from 20 Sep)', () => {
    // 23, 26, 29 Sep are past; 2 Oct is the next on the schedule.
    expect(day(nextDueDate(midnight('2026-09-20'), { freq: 'DAILY', interval: 3 }, '2026-10-01'))).toBe('2026-10-02');
  });

  it('is null once the series has ended (until)', () => {
    expect(nextDueDate(midnight('2026-09-25'), { freq: 'DAILY', interval: 1, until: '2026-09-30' }, '2026-10-01')).toBeNull();
    expect(day(nextDueDate(midnight('2026-09-29'), { freq: 'DAILY', interval: 1, until: '2026-09-30' }, '2026-09-29'))).toBe('2026-09-30');
  });
});

describe('scheduledOccurrence — the copy an on-schedule series owes today', () => {
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const midnight = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it('is null until the next date arrives', () => {
    expect(scheduledOccurrence(midnight('2026-10-01'), { freq: 'DAILY', interval: 1 }, '2026-10-01')).toBeNull();
    expect(scheduledOccurrence(midnight('2026-09-28'), { freq: 'WEEKLY', interval: 1 }, '2026-10-01')).toBeNull();
  });

  it('is the next date once it is today', () => {
    expect(day(scheduledOccurrence(midnight('2026-09-30'), { freq: 'DAILY', interval: 1 }, '2026-10-01'))).toBe('2026-10-01');
  });

  it('after missed days, only the latest one that is due (no backlog of copies)', () => {
    expect(day(scheduledOccurrence(midnight('2026-09-25'), { freq: 'DAILY', interval: 1 }, '2026-10-01'))).toBe('2026-10-01');
    // Weekly on Monday from 14 Sep: 21 and 28 Sep have both passed → 28 Sep.
    expect(day(scheduledOccurrence(midnight('2026-09-14'), { freq: 'WEEKLY', interval: 1, weekdays: [1] }, '2026-10-01'))).toBe('2026-09-28');
  });

  it('respects until', () => {
    expect(day(scheduledOccurrence(midnight('2026-09-25'), { freq: 'DAILY', interval: 1, until: '2026-09-27' }, '2026-10-01'))).toBe('2026-09-27');
    expect(scheduledOccurrence(midnight('2026-09-27'), { freq: 'DAILY', interval: 1, until: '2026-09-27' }, '2026-10-01')).toBeNull();
  });
});

describe('generateOccurrences', () => {
  it('starts at the start date and yields `count` occurrences', () => {
    const rule: RecurrenceRule = { freq: 'DAILY', interval: 1, count: 3 };
    const dates = generateOccurrences(utc('2026-01-01'), rule, 10).map(iso);
    expect(dates).toEqual([iso(utc('2026-01-01')), iso(utc('2026-01-02')), iso(utc('2026-01-03'))]);
  });

  it('stops at the `until` date (inclusive)', () => {
    const rule: RecurrenceRule = { freq: 'DAILY', interval: 1, until: '2026-01-03T09:30:00.000Z' };
    const dates = generateOccurrences(utc('2026-01-01'), rule, 10).map(iso);
    expect(dates).toEqual([iso(utc('2026-01-01')), iso(utc('2026-01-02')), iso(utc('2026-01-03'))]);
  });

  it('respects the hard limit even with no count/until', () => {
    const dates = generateOccurrences(utc('2026-01-01'), { freq: 'DAILY', interval: 1 }, 5);
    expect(dates).toHaveLength(5);
  });
});

describe('isValidRule', () => {
  it('accepts a well-formed rule', () => {
    expect(isValidRule({ freq: 'WEEKLY', interval: 2, weekdays: [1, 3] })).toBe(true);
    expect(isValidRule({ freq: 'QUARTERLY', interval: 1, dayOfMonth: 1 })).toBe(true);
    expect(isValidRule({ freq: 'MONTHLY', interval: 1, paused: true })).toBe(true);
  });
  it('rejects a non-positive interval', () => {
    expect(isValidRule({ freq: 'DAILY', interval: 0 })).toBe(false);
  });
  it('rejects an unknown frequency', () => {
    expect(isValidRule({ freq: 'HOURLY' as unknown as RecurrenceRule['freq'], interval: 1 })).toBe(false);
  });
  it('accepts "the 2nd Tuesday" / "the last Friday" on month-based rules only', () => {
    expect(isValidRule({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } })).toBe(true);
    expect(isValidRule({ freq: 'QUARTERLY', interval: 1, nthWeekday: { week: -1, day: 5 } })).toBe(true);
    expect(isValidRule({ freq: 'WEEKLY', interval: 1, nthWeekday: { week: 1, day: 1 } })).toBe(false);
    expect(isValidRule({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 5 as 1, day: 1 } })).toBe(false);
    expect(isValidRule({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 0 as 1, day: 1 } })).toBe(false);
    expect(isValidRule({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 1, day: 7 } })).toBe(false);
    // Either a day of the month or a weekday of the month — not both.
    expect(isValidRule({ freq: 'MONTHLY', interval: 1, dayOfMonth: 3, nthWeekday: { week: 1, day: 1 } })).toBe(false);
  });
  it('accepts when the next copy is created: on completion or on schedule', () => {
    expect(isValidRule({ freq: 'DAILY', interval: 1, createNext: 'ON_COMPLETE' })).toBe(true);
    expect(isValidRule({ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' })).toBe(true);
    expect(isValidRule({ freq: 'DAILY', interval: 1, createNext: 'HOURLY' as 'ON_SCHEDULE' })).toBe(false);
  });
  it('rejects out-of-range weekdays, dayOfMonth and anchorDay', () => {
    expect(isValidRule({ freq: 'WEEKLY', interval: 1, weekdays: [7] })).toBe(false);
    expect(isValidRule({ freq: 'MONTHLY', interval: 1, dayOfMonth: 32 })).toBe(false);
    expect(isValidRule({ freq: 'MONTHLY', interval: 1, anchorDay: 0 })).toBe(false);
  });
});
