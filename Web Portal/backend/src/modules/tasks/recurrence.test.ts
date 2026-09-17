import { describe, it, expect } from 'vitest';
import { nextOccurrence, generateOccurrences, isValidRule, type RecurrenceRule } from './recurrence';

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

  it('MONTHLY advances by interval months, clamping to the month length', () => {
    expect(iso(nextOccurrence(utc('2026-01-15'), { freq: 'MONTHLY', interval: 1 }))).toBe(iso(utc('2026-02-15')));
    // Jan 31 -> Feb has only 28 days in 2026
    expect(iso(nextOccurrence(utc('2026-01-31'), { freq: 'MONTHLY', interval: 1 }))).toBe(iso(utc('2026-02-28')));
  });

  it('MONTHLY honours an explicit dayOfMonth (clamped)', () => {
    expect(iso(nextOccurrence(utc('2026-01-10'), { freq: 'MONTHLY', interval: 1, dayOfMonth: 20 }))).toBe(iso(utc('2026-02-20')));
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
  it('rejects out-of-range weekdays and dayOfMonth', () => {
    expect(isValidRule({ freq: 'WEEKLY', interval: 1, weekdays: [7] })).toBe(false);
    expect(isValidRule({ freq: 'MONTHLY', interval: 1, dayOfMonth: 32 })).toBe(false);
  });
});
