import { describe, it, expect } from 'vitest';
import { HOUR_PX, SNAP_MINUTES, clipToDay, instantAt, layoutColumns, minutesAt, snapMinutes, timeLabel, workingBand } from './calendar-hours';

const TZ = 'Asia/Muscat'; // UTC+4

describe('the week and day hour grids', () => {
  it('reads an instant as minutes after the day’s midnight in the calendar’s zone, and back', () => {
    expect(minutesAt('2026-11-12T05:30:00.000Z', TZ)).toEqual({ day: '2026-11-12', minutes: 9 * 60 + 30 });
    expect(instantAt('2026-11-12', 9 * 60 + 30, TZ)).toBe('2026-11-12T05:30:00.000Z');
    expect(timeLabel(9 * 60 + 5)).toBe('09:05');
    expect(timeLabel(24 * 60)).toBe('24:00');
  });

  it('cuts something timed to one day (a block past midnight shows on both)', () => {
    // 23:00 on the 12th → 01:00 on the 13th, Muscat.
    const span = { startAt: '2026-11-12T19:00:00.000Z', endAt: '2026-11-12T21:00:00.000Z' };
    expect(clipToDay(span, '2026-11-12', TZ)).toEqual({ start: 23 * 60, end: 24 * 60 });
    expect(clipToDay(span, '2026-11-13', TZ)).toEqual({ start: 0, end: 60 });
    expect(clipToDay(span, '2026-11-14', TZ)).toBeNull();
  });

  it('a pointer means the 15-minute slot under it, inside the day', () => {
    expect(SNAP_MINUTES).toBe(15);
    expect(snapMinutes((9 * 60 + 7) * (HOUR_PX / 60))).toBe(9 * 60);
    expect(snapMinutes((9 * 60 + 14) * (HOUR_PX / 60))).toBe(9 * 60);
    expect(snapMinutes((9 * 60 + 15) * (HOUR_PX / 60))).toBe(9 * 60 + 15);
    // Moving something grabbed in its middle: the nearest mark.
    expect(snapMinutes((15 * 60 - 1) * (HOUR_PX / 60), HOUR_PX, true)).toBe(15 * 60);
    expect(snapMinutes(-20)).toBe(0);
    expect(snapMinutes(25 * HOUR_PX)).toBe(24 * 60 - 15);
  });

  it('side by side when they overlap: each cluster shares its width', () => {
    const laid = layoutColumns([
      { id: 'a', start: 540, end: 600 },
      { id: 'b', start: 570, end: 630 },
      { id: 'c', start: 600, end: 660 },
      { id: 'd', start: 700, end: 760 },
    ]);
    const of = (id: string) => laid.find((x) => x.id === id)!;
    expect([of('a').col, of('a').cols]).toEqual([0, 2]);
    expect([of('b').col, of('b').cols]).toEqual([1, 2]);
    expect([of('c').col, of('c').cols]).toEqual([0, 2]);
    expect([of('d').col, of('d').cols]).toEqual([0, 1]);
  });

  it('the working hours band (highlighted; the rest dimmed)', () => {
    expect(workingBand({ start: '08:00', end: '17:00' })).toEqual({ start: 480, end: 1020 });
    expect(workingBand(null)).toEqual({ start: 480, end: 1020 });
  });
});
