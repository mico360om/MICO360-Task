import { describe, expect, it } from 'vitest';
import { median, workingHoursBetween, workingMinutesBetween } from './working-time';
import type { WorkCalendar } from '../../lib/working-days';

// Oman: Sunday–Thursday, 08:00–17:00 (9 h a day), Muscat (UTC+4, no daylight saving).
const TZ = 'Asia/Muscat';
const CAL: WorkCalendar = { workingDays: [0, 1, 2, 3, 4], holidays: [{ day: '2026-11-18', name: 'National Day' }] };
const HOURS = { start: '08:00', end: '17:00' };
/** A Muscat wall-clock time as an instant. */
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+04:00`);

describe('workingMinutesBetween', () => {
  it('counts the minutes inside working hours on one working day', () => {
    // Sun 1 Nov 2026, 09:00 → 11:30.
    expect(workingMinutesBetween(at('2026-11-01', '09:00'), at('2026-11-01', '11:30'), TZ, CAL, HOURS)).toBe(150);
  });

  it('clips to working hours (before 08:00 and after 17:00 count nothing)', () => {
    expect(workingMinutesBetween(at('2026-11-01', '06:00'), at('2026-11-01', '20:00'), TZ, CAL, HOURS)).toBe(9 * 60);
    expect(workingMinutesBetween(at('2026-11-01', '17:30'), at('2026-11-01', '23:00'), TZ, CAL, HOURS)).toBe(0);
  });

  it('spans days: the rest of the first day, full days between, the start of the last', () => {
    // Sun 16:00 → Tue 09:00 = 1 h (Sun) + 9 h (Mon) + 1 h (Tue).
    expect(workingMinutesBetween(at('2026-11-01', '16:00'), at('2026-11-03', '09:00'), TZ, CAL, HOURS)).toBe(11 * 60);
  });

  it('skips the weekend (Friday, Saturday) and holidays', () => {
    // Thu 5 Nov 16:00 → Sun 8 Nov 09:00 = 1 h + 1 h.
    expect(workingMinutesBetween(at('2026-11-05', '16:00'), at('2026-11-08', '09:00'), TZ, CAL, HOURS)).toBe(120);
    // Tue 17 Nov 16:00 → Thu 19 Nov 09:00: Wed 18 Nov is National Day = 1 h + 1 h.
    expect(workingMinutesBetween(at('2026-11-17', '16:00'), at('2026-11-19', '09:00'), TZ, CAL, HOURS)).toBe(120);
  });

  it('a start on a day off begins at the next working morning', () => {
    // Fri 6 Nov 10:00 → Sun 8 Nov 10:00 = 2 h.
    expect(workingMinutesBetween(at('2026-11-06', '10:00'), at('2026-11-08', '10:00'), TZ, CAL, HOURS)).toBe(120);
  });

  it('never negative; the same instant is 0', () => {
    expect(workingMinutesBetween(at('2026-11-03', '10:00'), at('2026-11-02', '10:00'), TZ, CAL, HOURS)).toBe(0);
    expect(workingMinutesBetween(at('2026-11-03', '10:00'), at('2026-11-03', '10:00'), TZ, CAL, HOURS)).toBe(0);
  });

  it('a calendar with no working days counts nothing', () => {
    expect(workingMinutesBetween(at('2026-11-01', '09:00'), at('2026-11-30', '09:00'), TZ, { workingDays: [], holidays: [] }, HOURS)).toBe(0);
  });

  it('long spans are counted without walking every day (a year)', () => {
    const m = workingMinutesBetween(at('2026-01-01', '00:00'), at('2027-01-01', '00:00'), TZ, { workingDays: [0, 1, 2, 3, 4], holidays: [] }, HOURS);
    // 2026 has 261 Sunday–Thursday days.
    expect(m).toBe(261 * 9 * 60);
  });

  it('hours, to one decimal', () => {
    expect(workingHoursBetween(at('2026-11-01', '09:00'), at('2026-11-01', '10:20'), TZ, CAL, HOURS)).toBeCloseTo(1.333, 2);
  });
});

describe('median', () => {
  it('the middle value, the mean of the two middle ones, null for none', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
