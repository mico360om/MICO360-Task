import { describe, it, expect } from 'vitest';
import { seriesDay, seriesHref, splitByNow } from './meeting-series';

const NOW = new Date('2026-11-04T08:00:00Z');

describe('meeting series helpers', () => {
  it('writes a day as "3 Nov", with the year when it isn’t this year', () => {
    expect(seriesDay('2026-11-03T06:00:00Z', 'Asia/Muscat', NOW)).toBe('3 Nov');
    expect(seriesDay('2027-01-05T06:00:00Z', 'Asia/Muscat', NOW)).toBe('5 Jan 2027');
    expect(seriesDay('2025-12-31T22:00:00Z', 'Asia/Muscat', NOW)).toBe('1 Jan'); // the company's day
    expect(seriesDay('not a date', 'Asia/Muscat', NOW)).toBe('');
  });

  it('splits a series at now', () => {
    const list = [{ startAt: '2026-11-03T06:00:00Z' }, { startAt: '2026-11-04T08:00:00Z' }, { startAt: '2026-12-01T06:00:00Z' }];
    const { earlier, upcoming } = splitByNow(list, NOW);
    expect(earlier).toEqual([list[0]]);
    expect(upcoming).toEqual([list[1], list[2]]);
  });

  it('links to the series page', () => {
    expect(seriesHref('s 1')).toBe('/meetings/series/s%201');
  });
});
