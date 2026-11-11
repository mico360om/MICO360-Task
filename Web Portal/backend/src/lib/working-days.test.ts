import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  dayOffReason,
  holidayOn,
  holidaysInRange,
  isWorkingDay,
  isWorkingTime,
  nextWorkingDay,
  nextWorkingStart,
  previousWorkingDay,
  weekdayOf,
  workingDaysBetween,
  workingDaysLate,
  zonedClock,
  zonedDay,
  zonedInstant,
  type WorkCalendar,
} from './working-days';

// Oman: Sunday to Thursday, Friday + Saturday off. 2026-11-12 is a Thursday.
const OMAN: WorkCalendar = { workingDays: [0, 1, 2, 3, 4], holidays: [] };
const withHolidays = (holidays: WorkCalendar['holidays']): WorkCalendar => ({ ...OMAN, holidays });
const HOURS = { start: '08:00', end: '17:00' };
const MUSCAT = 'Asia/Muscat';

/** The slow, obviously right count: every day after `from` up to and including `to`. */
function naiveBetween(from: string, to: string, cal: WorkCalendar): number {
  const step = to >= from ? 1 : -1;
  let n = 0;
  let d = from;
  while (d !== to) {
    const next = new Date(`${d}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + step);
    d = next.toISOString().slice(0, 10);
    // Going back, the day counted is the one left behind (from is inclusive, to exclusive).
    const counted = step > 0 ? d : new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    if (isWorkingDay(counted, cal)) n += step;
  }
  return n;
}

describe('working days: weekdays and weekends', () => {
  it('reads the weekday of a day (0 Sunday … 6 Saturday)', () => {
    expect(weekdayOf('2026-11-12')).toBe(4); // Thursday
    expect(weekdayOf('2026-11-13')).toBe(5); // Friday
    expect(weekdayOf('2026-11-15')).toBe(0); // Sunday
    expect(weekdayOf('2028-02-29')).toBe(2); // a leap day
  });

  it('a working day is one of the working weekdays and no holiday', () => {
    expect(isWorkingDay('2026-11-12', OMAN)).toBe(true);
    expect(isWorkingDay('2026-11-13', OMAN)).toBe(false);
    expect(isWorkingDay('2026-11-14', OMAN)).toBe(false);
    expect(isWorkingDay('2026-11-15', OMAN)).toBe(true);
    expect(isWorkingDay('2026-11-15', withHolidays([{ day: '2026-11-15', name: 'Day off' }]))).toBe(false);
  });

  it('says why a day is off: a holiday (by name) before a weekend', () => {
    const cal = withHolidays([{ day: '2026-11-18', name: 'National Day' }, { day: '2026-11-13', name: 'Friday holiday' }]);
    expect(dayOffReason('2026-11-18', cal)).toEqual({ kind: 'holiday', name: 'National Day' });
    expect(dayOffReason('2026-11-13', cal)).toEqual({ kind: 'holiday', name: 'Friday holiday' });
    expect(dayOffReason('2026-11-14', cal)).toEqual({ kind: 'weekend' });
    expect(dayOffReason('2026-11-16', cal)).toBeNull();
  });
});

describe('working days: holidays', () => {
  it('a one-off holiday is that day only', () => {
    const cal = withHolidays([{ day: '2026-11-18', name: 'National Day' }]);
    expect(holidayOn('2026-11-18', cal)?.name).toBe('National Day');
    expect(holidayOn('2027-11-18', cal)).toBeNull();
  });

  it('a holiday every year repeats on its month and day from its first year on', () => {
    const cal = withHolidays([{ day: '2026-11-18', name: 'National Day', recurring: true }]);
    expect(holidayOn('2026-11-18', cal)?.name).toBe('National Day');
    expect(holidayOn('2027-11-18', cal)?.name).toBe('National Day');
    expect(holidayOn('2031-11-18', cal)?.name).toBe('National Day');
    expect(holidayOn('2025-11-18', cal)).toBeNull();
    expect(holidayOn('2027-11-19', cal)).toBeNull();
  });

  it('a yearly holiday on 29 February is kept only in leap years', () => {
    const cal = withHolidays([{ day: '2028-02-29', name: 'Leap', recurring: true }]);
    expect(holidayOn('2028-02-29', cal)).not.toBeNull();
    expect(holidayOn('2029-02-28', cal)).toBeNull();
    expect(holidayOn('2029-03-01', cal)).toBeNull();
    expect(holidayOn('2032-02-29', cal)).not.toBeNull();
  });

  it('lists the holidays in a range, yearly ones once per year, in day order', () => {
    const cal = withHolidays([
      { day: '2026-11-18', name: 'National Day', recurring: true },
      { day: '2027-03-10', name: 'Eid al-Fitr' },
      { day: '2026-01-01', name: 'New Year', recurring: true },
    ]);
    expect(holidaysInRange('2026-11-01', '2027-12-31', cal)).toEqual([
      { day: '2026-11-18', name: 'National Day' },
      { day: '2027-01-01', name: 'New Year' },
      { day: '2027-03-10', name: 'Eid al-Fitr' },
      { day: '2027-11-18', name: 'National Day' },
    ]);
    expect(holidaysInRange('2027-04-01', '2027-04-30', cal)).toEqual([]);
  });
});

describe('working days: counting', () => {
  it('counts the working days after one day up to and including another', () => {
    // Due Thursday, today Sunday: Friday and Saturday are off — 1 working day late.
    expect(workingDaysBetween('2026-11-12', '2026-11-15', OMAN)).toBe(1);
    expect(workingDaysBetween('2026-11-12', '2026-11-12', OMAN)).toBe(0);
    expect(workingDaysBetween('2026-11-12', '2026-11-19', OMAN)).toBe(5);
    expect(workingDaysBetween('2026-11-15', '2026-11-12', OMAN)).toBe(-1);
  });

  it('a holiday on a working day is not counted; one on a weekend changes nothing', () => {
    expect(workingDaysBetween('2026-11-12', '2026-11-19', withHolidays([{ day: '2026-11-18', name: 'National Day' }]))).toBe(4);
    expect(workingDaysBetween('2026-11-12', '2026-11-19', withHolidays([{ day: '2026-11-14', name: 'Saturday holiday' }]))).toBe(5);
    // Two holidays on one day count once.
    expect(workingDaysBetween('2026-11-12', '2026-11-19', withHolidays([{ day: '2026-11-18', name: 'A' }, { day: '2026-11-18', name: 'B' }]))).toBe(4);
  });

  it('agrees with a day-by-day count over long and short ranges, both ways', () => {
    const cal = withHolidays([
      { day: '2026-11-18', name: 'National Day', recurring: true },
      { day: '2027-03-10', name: 'Eid' },
      { day: '2027-03-11', name: 'Eid' },
      { day: '2026-12-31', name: 'Year end', recurring: true },
    ]);
    const days = ['2026-10-01', '2026-11-12', '2026-11-13', '2026-11-18', '2026-12-31', '2027-01-04', '2027-03-09', '2027-03-12', '2028-02-29', '2028-11-18'];
    for (const a of days) for (const b of days) expect(workingDaysBetween(a, b, cal), `${a} → ${b}`).toBe(naiveBetween(a, b, cal));
  });

  it('days late are never negative', () => {
    expect(workingDaysLate('2026-11-12', '2026-11-15', OMAN)).toBe(1);
    expect(workingDaysLate('2026-11-15', '2026-11-12', OMAN)).toBe(0);
    expect(workingDaysLate('2026-11-12', '2026-11-12', OMAN)).toBe(0);
  });

  it('a calendar with no working days counts none and never loops', () => {
    const none: WorkCalendar = { workingDays: [], holidays: [] };
    expect(workingDaysBetween('2026-01-01', '2026-12-31', none)).toBe(0);
    expect(nextWorkingDay('2026-01-01', none)).toBe('2026-01-01');
    expect(addWorkingDays('2026-01-01', 3, none)).toBe('2026-01-01');
  });
});

describe('working days: moving by working days', () => {
  it('finds the next working day on or after a day, or strictly after it', () => {
    expect(nextWorkingDay('2026-11-13', OMAN)).toBe('2026-11-15');
    expect(nextWorkingDay('2026-11-12', OMAN)).toBe('2026-11-12');
    expect(nextWorkingDay('2026-11-12', OMAN, { after: true })).toBe('2026-11-15');
    expect(nextWorkingDay('2026-11-17', withHolidays([{ day: '2026-11-18', name: 'National Day' }]), { after: true })).toBe('2026-11-19');
  });

  it('finds the previous working day on or before a day', () => {
    expect(previousWorkingDay('2026-11-14', OMAN)).toBe('2026-11-12');
    expect(previousWorkingDay('2026-11-15', OMAN)).toBe('2026-11-15');
  });

  it('adds and takes away working days', () => {
    expect(addWorkingDays('2026-11-12', 1, OMAN)).toBe('2026-11-15');
    expect(addWorkingDays('2026-11-12', 5, OMAN)).toBe('2026-11-19');
    expect(addWorkingDays('2026-11-15', -1, OMAN)).toBe('2026-11-12');
    expect(addWorkingDays('2026-11-17', -2, OMAN)).toBe('2026-11-15');
    expect(addWorkingDays('2026-11-13', 0, OMAN)).toBe('2026-11-13');
    // Two working days before a Sunday due day: Wednesday.
    expect(addWorkingDays('2026-11-15', -2, OMAN)).toBe('2026-11-11');
    expect(workingDaysBetween(addWorkingDays('2026-11-12', 7, OMAN), '2026-11-12', OMAN)).toBe(-7);
  });
});

describe('working days: time zones and working hours', () => {
  it('reads an instant as a day and a time of day in a zone', () => {
    // 20:30 UTC on the 12th is 00:30 on the 13th in Muscat (UTC+4).
    expect(zonedDay(new Date('2026-11-12T20:30:00Z'), MUSCAT)).toBe('2026-11-13');
    expect(zonedClock(new Date('2026-11-12T20:30:00Z'), MUSCAT)).toEqual({ day: '2026-11-13', minutes: 30 });
    expect(zonedClock(new Date('2026-11-12T20:30:00Z'), 'UTC')).toEqual({ day: '2026-11-12', minutes: 20 * 60 + 30 });
  });

  it('turns a day and a time in a zone into an instant, across daylight saving too', () => {
    expect(zonedInstant('2026-11-15', '08:00', MUSCAT).toISOString()).toBe('2026-11-15T04:00:00.000Z');
    expect(zonedInstant('2026-03-29', '08:00', 'Europe/London').toISOString()).toBe('2026-03-29T07:00:00.000Z');
    expect(zonedInstant('2026-01-15', '08:00', 'Europe/London').toISOString()).toBe('2026-01-15T08:00:00.000Z');
  });

  it('working time is a working day between the start (inclusive) and the end (exclusive)', () => {
    expect(isWorkingTime(new Date('2026-11-15T05:00:00Z'), MUSCAT, OMAN, HOURS)).toBe(true); // Sun 09:00
    expect(isWorkingTime(new Date('2026-11-15T04:00:00Z'), MUSCAT, OMAN, HOURS)).toBe(true); // Sun 08:00
    expect(isWorkingTime(new Date('2026-11-15T13:00:00Z'), MUSCAT, OMAN, HOURS)).toBe(false); // Sun 17:00
    expect(isWorkingTime(new Date('2026-11-13T05:00:00Z'), MUSCAT, OMAN, HOURS)).toBe(false); // Friday
    expect(isWorkingTime(new Date('2026-11-18T05:00:00Z'), MUSCAT, withHolidays([{ day: '2026-11-18', name: 'National Day' }]), HOURS)).toBe(false);
  });

  it('finds when working time next starts: now when inside it, else the next working morning', () => {
    const at = (iso: string) => nextWorkingStart(new Date(iso), MUSCAT, OMAN, HOURS)?.toISOString();
    expect(at('2026-11-15T05:00:00Z')).toBe('2026-11-15T05:00:00.000Z'); // inside: now
    expect(at('2026-11-15T02:00:00Z')).toBe('2026-11-15T04:00:00.000Z'); // Sun 06:00 → 08:00
    expect(at('2026-11-12T14:00:00Z')).toBe('2026-11-15T04:00:00.000Z'); // Thu 18:00 → Sun 08:00
    expect(at('2026-11-13T09:00:00Z')).toBe('2026-11-15T04:00:00.000Z'); // Friday → Sunday
    const holiday = withHolidays([{ day: '2026-11-15', name: 'Day off' }]);
    expect(nextWorkingStart(new Date('2026-11-12T14:00:00Z'), MUSCAT, holiday, HOURS)?.toISOString()).toBe('2026-11-16T04:00:00.000Z');
    expect(nextWorkingStart(new Date('2026-11-12T14:00:00Z'), MUSCAT, { workingDays: [], holidays: [] }, HOURS)).toBeNull();
  });
});
