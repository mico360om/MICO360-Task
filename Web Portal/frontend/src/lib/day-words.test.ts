import { describe, it, expect } from 'vitest';
import { clockText, dateTimeText, dayKeyIn, dayText, instantDayText, weekdayText } from './day-words';

describe('dates in words, day before month (as the minutes PDF and the daily emails write them)', () => {
  it('a calendar day: "5 Oct 2026", with the weekday or long names when asked', () => {
    expect(dayText('2026-10-05')).toBe('5 Oct 2026');
    expect(dayText('2026-10-30', { weekday: 'short' })).toBe('Fri 30 Oct 2026');
    expect(dayText('2026-10-01', { weekday: 'long', month: 'long' })).toBe('Thursday 1 October 2026');
    expect(dayText('2026-10-30', { year: false })).toBe('30 Oct');
    expect(dayText('2026-10-30', { weekday: 'short', year: false })).toBe('Fri 30 Oct');
    expect(dayText('2026-10-30', { weekday: 'long', month: 'long', year: false })).toBe('Friday 30 October');
  });

  it('three-letter months always (never "Sept"), and no commas', () => {
    expect(dayText('2026-09-04', { weekday: 'short' })).toBe('Fri 4 Sep 2026');
    for (let m = 1; m <= 12; m++) {
      const text = dayText(`2026-${String(m).padStart(2, '0')}-15`);
      expect(text).toMatch(/^15 [A-Z][a-z]{2} 2026$/);
    }
    expect(dayText('2026-09-04', { weekday: 'long', month: 'long' })).not.toContain(',');
  });

  it('reads the day itself, never shifted by a time zone; anything after it is ignored', () => {
    expect(dayText('2026-10-30T23:59:00.000Z')).toBe('30 Oct 2026');
    expect(dayText('2028-02-29', { weekday: 'short' })).toBe('Tue 29 Feb 2028');
    expect(dayText('')).toBe('');
    expect(dayText('not a date')).toBe('');
  });

  it('the day of an instant in a time zone', () => {
    expect(dayKeyIn(new Date('2026-10-29T20:30:00Z'), 'Asia/Muscat')).toBe('2026-10-30');
    expect(dayKeyIn(new Date('2026-10-29T20:30:00Z'), 'UTC')).toBe('2026-10-29');
    // An unknown zone falls back to the device's, never throws.
    expect(dayKeyIn(new Date('2026-10-29T12:00:00Z'), 'Not/AZone')).toMatch(/^2026-10-(29|30|28)$/);
  });

  it('times on the 24-hour clock, in the zone given', () => {
    expect(clockText('2026-10-30T05:05:00Z', 'Asia/Muscat')).toBe('09:05');
    expect(clockText('2026-10-30T10:30:00Z', 'Asia/Muscat')).toBe('14:30');
    expect(clockText('2026-10-30T20:00:00Z', 'Asia/Muscat')).toBe('00:00');
    expect(clockText('nope', 'Asia/Muscat')).toBe('');
  });

  it('the day and the weekday of an instant, in the zone given', () => {
    expect(instantDayText('2026-10-29T20:30:00Z', 'Asia/Muscat', { weekday: 'short' })).toBe('Fri 30 Oct 2026');
    expect(weekdayText('2026-10-29T20:30:00Z', 'Asia/Muscat')).toBe('Fri');
    expect(weekdayText('2026-10-29T20:30:00Z', 'UTC', 'long')).toBe('Thursday');
    expect(instantDayText('nope')).toBe('');
  });

  it('a day and a time: "30 Oct 2026, 09:05"', () => {
    expect(dateTimeText('2026-10-30T05:05:00Z', 'Asia/Muscat')).toBe('30 Oct 2026, 09:05');
    expect(dateTimeText('2026-10-29T20:30:00Z', 'Asia/Muscat', { weekday: 'long', month: 'long' })).toBe('Friday 30 October 2026, 00:30');
    expect(dateTimeText('', 'Asia/Muscat')).toBe('');
  });
});
