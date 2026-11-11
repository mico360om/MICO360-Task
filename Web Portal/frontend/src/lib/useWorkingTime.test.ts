import { describe, expect, it } from 'vitest';
import { calendarOf, defaultWorkingRange, dueDayWarning, lateWorkingDays, shortDay } from './useWorkingTime';

const cal = calendarOf({ workingDays: [0, 1, 2, 3, 4], daysOff: [{ day: '2026-11-20', name: 'National Day' }] });

describe('working time on the website', () => {
  it('asks for this year and next', () => {
    expect(defaultWorkingRange('2026-11-11')).toEqual({ from: '2025-01-01', to: '2027-12-31' });
  });

  it('writes a day the site’s way', () => {
    expect(shortDay('2026-11-20')).toBe('Fri 20 Nov');
  });

  it('warns about a due date on a holiday or a weekend, never on a working day', () => {
    expect(dueDayWarning('2026-11-20', cal)).toBe('Fri 20 Nov is National Day — a day off.');
    expect(dueDayWarning('2026-11-14', cal)).toBe('Sat 14 Nov is a weekend day.');
    expect(dueDayWarning('2026-11-15', cal)).toBeNull();
    expect(dueDayWarning('', cal)).toBeNull();
    expect(dueDayWarning('2026-11-14', null)).toBeNull();
  });

  it('counts days late in working days (calendar days only without a calendar)', () => {
    expect(lateWorkingDays('2026-11-12', '2026-11-15', cal)).toBe(1);
    expect(lateWorkingDays('2026-11-12', '2026-11-15', null)).toBe(3);
    expect(lateWorkingDays('2026-11-15', '2026-11-12', cal)).toBe(0);
  });
});
