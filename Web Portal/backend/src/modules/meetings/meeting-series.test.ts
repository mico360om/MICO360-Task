import { describe, it, expect } from 'vitest';
import { alignToRule, instantOf, seriesStarts, seriesRule, untilBefore, wallOf } from './meeting-series';

const iso = (ds: Date[]) => ds.map((d) => d.toISOString());

describe('meeting series dates', () => {
  it('reads and writes wall-clock times in a zone', () => {
    const at = new Date('2026-10-20T06:00:00.000Z'); // 10:00 in Muscat (UTC+4)
    expect(wallOf(at, 'Asia/Muscat').toISOString()).toBe('2026-10-20T10:00:00.000Z');
    expect(instantOf(new Date('2026-10-20T10:00:00.000Z'), 'Asia/Muscat').toISOString()).toBe('2026-10-20T06:00:00.000Z');
  });

  it('repeats weekly at the same local time, from the first meeting on', () => {
    const first = new Date('2026-10-20T06:00:00.000Z'); // Tue 10:00 Muscat
    const starts = seriesStarts(first, { freq: 'WEEKLY', interval: 1 }, 'Asia/Muscat', new Date('2026-11-10T23:00:00.000Z'));
    expect(iso(starts)).toEqual([
      '2026-10-20T06:00:00.000Z',
      '2026-10-27T06:00:00.000Z',
      '2026-11-03T06:00:00.000Z',
      '2026-11-10T06:00:00.000Z',
    ]);
  });

  it('keeps the local time when the clocks change', () => {
    // London leaves summer time on Sunday 25 Oct 2026: 10:00 BST is 09:00Z, 10:00 GMT is 10:00Z.
    const first = new Date('2026-10-20T09:00:00.000Z');
    const starts = seriesStarts(first, { freq: 'WEEKLY', interval: 1 }, 'Europe/London', new Date('2026-10-28T00:00:00.000Z'));
    expect(iso(starts)).toEqual(['2026-10-20T09:00:00.000Z', '2026-10-27T10:00:00.000Z']);
  });

  it('stops after the number of meetings asked for', () => {
    const first = new Date('2026-10-20T06:00:00.000Z');
    const starts = seriesStarts(first, { freq: 'DAILY', interval: 1, count: 3 }, 'Asia/Muscat', new Date('2027-01-01T00:00:00.000Z'));
    expect(starts).toHaveLength(3);
    expect(starts[2]!.toISOString()).toBe('2026-10-22T06:00:00.000Z');
  });

  it('includes a meeting on the end date itself', () => {
    const first = new Date('2026-10-20T06:00:00.000Z');
    const starts = seriesStarts(first, { freq: 'WEEKLY', interval: 1, until: '2026-11-03' }, 'Asia/Muscat', new Date('2027-01-01T00:00:00.000Z'));
    expect(iso(starts).at(-1)).toBe('2026-11-03T06:00:00.000Z');
    expect(starts).toHaveLength(3);
  });

  it('repeats on chosen weekdays and every other week', () => {
    const first = new Date('2026-10-19T06:00:00.000Z'); // Mon 10:00 Muscat
    const rule = { freq: 'WEEKLY' as const, interval: 2, weekdays: [1, 3] };
    const starts = seriesStarts(first, rule, 'Asia/Muscat', new Date('2026-11-06T00:00:00.000Z'));
    expect(iso(starts)).toEqual([
      '2026-10-19T06:00:00.000Z', // Mon
      '2026-10-21T06:00:00.000Z', // Wed
      '2026-11-02T06:00:00.000Z', // Mon, two weeks on
      '2026-11-04T06:00:00.000Z', // Wed
    ]);
  });

  it('keeps a monthly meeting on the 31st on each month’s last day', () => {
    const first = new Date('2027-01-31T06:00:00.000Z');
    const rule = seriesRule({ freq: 'MONTHLY', interval: 1 }, first, 'Asia/Muscat');
    expect(rule.anchorDay).toBe(31);
    const starts = seriesStarts(first, rule, 'Asia/Muscat', new Date('2027-04-01T00:00:00.000Z'));
    expect(iso(starts)).toEqual(['2027-01-31T06:00:00.000Z', '2027-02-28T06:00:00.000Z', '2027-03-31T06:00:00.000Z']);
  });

  it('pins the anchor day in the meeting’s zone, not UTC', () => {
    // 1 Nov 01:00 in Muscat is still 31 Oct in UTC.
    const first = new Date('2026-10-31T21:00:00.000Z');
    expect(seriesRule({ freq: 'MONTHLY', interval: 1 }, first, 'Asia/Muscat').anchorDay).toBe(1);
  });

  it('moves a start onto the rule’s next day when it is off the rule', () => {
    const tue = new Date('2026-10-20T06:00:00.000Z');
    expect(alignToRule(tue, { freq: 'WEEKLY', interval: 1, weekdays: [3] }, 'Asia/Muscat').toISOString()).toBe('2026-10-21T06:00:00.000Z');
    expect(alignToRule(tue, { freq: 'WEEKLY', interval: 1, weekdays: [2] }, 'Asia/Muscat').toISOString()).toBe(tue.toISOString());
    expect(alignToRule(tue, { freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 5 } }, 'Asia/Muscat').toISOString()).toBe('2026-10-30T06:00:00.000Z');
    expect(alignToRule(tue, { freq: 'DAILY', interval: 1 }, 'Asia/Muscat').toISOString()).toBe(tue.toISOString());
  });

  it('gives the end date that stops a series before a meeting', () => {
    // A meeting at 01:00 on 5 Nov in Muscat: the series ends on 4 Nov, local time.
    expect(untilBefore(new Date('2026-11-04T21:00:00.000Z'), 'Asia/Muscat')).toBe('2026-11-04');
  });
});
