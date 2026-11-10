import { describe, it, expect } from 'vitest';
import { formatDateTime, formatDay, printedLine } from './export-format';

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

describe('printedLine: the PDF footer’s words (1.23.11, owner)', () => {
  it('"Printed 10 Nov 2026, 14:05 by Name", in company time; without a name for a shared copy', () => {
    expect(printedLine(new Date('2026-11-10T10:05:00Z'), 'Asia/Muscat', 'Khurram Mumtaz')).toBe('Printed 10 Nov 2026, 14:05 by Khurram Mumtaz');
    expect(printedLine(new Date('2026-11-10T10:05:00Z'), 'Asia/Muscat')).toBe('Printed 10 Nov 2026, 14:05');
    expect(printedLine(new Date('2026-11-10T10:05:00Z'), 'Asia/Muscat', null, (n) => `[${n}]`)).toBe('Printed 10 Nov 2026, 14:05');
    expect(printedLine(new Date('2026-11-10T10:05:00Z'), 'Asia/Muscat', 'سالم', (n) => `[${n}]`)).toBe('Printed 10 Nov 2026, 14:05 by [سالم]');
  });
});
