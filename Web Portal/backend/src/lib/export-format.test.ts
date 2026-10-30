import { describe, it, expect } from 'vitest';
import { formatDateTime, formatDay } from './export-format';

describe('formatDay: the day before the month, three-letter months (never "Sept")', () => {
  it('writes a calendar day with its year by default', () => {
    expect(formatDay('2026-09-30')).toBe('30 Sep 2026');
    expect(formatDay('2026-10-05T00:00:00.000Z')).toBe('5 Oct 2026');
    expect(formatDay(null)).toBe('');
    expect(formatDay('nope')).toBe('');
  });

  it('can add the short weekday and leave out the year: "Wed 30 Sep", "30 Sep"', () => {
    expect(formatDay('2026-09-30', { weekday: true, year: false })).toBe('Wed 30 Sep');
    expect(formatDay('2026-09-27', { year: false })).toBe('27 Sep');
    expect(formatDay('2026-09-01', { weekday: true })).toBe('Tue 1 Sep 2026');
    expect(formatDay('2028-02-29', { weekday: true, year: false })).toBe('Tue 29 Feb');
    expect(formatDay('', { weekday: true })).toBe('');
  });

  it('formatDateTime keeps the 24-hour clock in the company zone', () => {
    expect(formatDateTime(new Date('2026-09-30T06:15:00Z'), 'Asia/Muscat')).toBe('30 Sep 2026, 10:15');
  });
});
