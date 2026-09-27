import { describe, it, expect } from 'vitest';
import {
  dueDayKey, todayKey, daysUntilDue, isOverdue, isDueToday, shiftDayKey, formatDayKey, relativeDayHint, isDayKey,
} from './due-date.js';

const TZ = 'Asia/Muscat'; // UTC+4
const at = (iso) => new Date(iso);

describe('due-date helpers (XP-03)', () => {
  it('a date-only due date keeps its calendar day in every zone', () => {
    expect(dueDayKey('2026-09-30T00:00:00.000Z', TZ)).toBe('2026-09-30');
    expect(dueDayKey('2026-09-30T00:00:00.000Z', 'America/Los_Angeles')).toBe('2026-09-30');
    expect(dueDayKey('2026-09-30', TZ)).toBe('2026-09-30');
    expect(dueDayKey(null, TZ)).toBeNull();
    expect(dueDayKey('garbage', TZ)).toBeNull();
  });

  it('a timed due date is read in the company zone', () => {
    expect(dueDayKey('2026-09-30T21:00:00.000Z', TZ)).toBe('2026-10-01'); // 01:00 Muscat
  });

  it('"today" is the company-zone date', () => {
    expect(todayKey(TZ, at('2026-09-30T20:30:00Z'))).toBe('2026-10-01'); // 00:30 in Muscat
    expect(todayKey(TZ, at('2026-09-30T19:59:00Z'))).toBe('2026-09-30');
  });

  it('is NOT overdue at 04:00 (or any time) on its own due day', () => {
    const due = '2026-09-30T00:00:00.000Z';
    expect(isOverdue(due, TZ, at('2026-09-30T00:00:00Z'))).toBe(false); // 04:00 Muscat
    expect(isOverdue(due, TZ, at('2026-09-30T19:59:59Z'))).toBe(false); // 23:59 Muscat
    expect(isDueToday(due, TZ, at('2026-09-30T00:00:00Z'))).toBe(true);
    expect(isOverdue(due, TZ, at('2026-09-30T20:00:00Z'))).toBe(true); // 00:00 next day in Muscat
    expect(isOverdue(null, TZ)).toBe(false);
  });

  it('counts whole calendar days', () => {
    expect(daysUntilDue('2026-10-02', TZ, at('2026-09-30T08:00:00Z'))).toBe(2);
    expect(daysUntilDue('2026-09-29', TZ, at('2026-09-30T08:00:00Z'))).toBe(-1);
  });

  it('shifts and labels day keys', () => {
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(relativeDayHint('2026-09-26', '2026-09-26')).toBe('Today');
    expect(relativeDayHint('2026-09-25', '2026-09-26')).toBe('Yesterday');
    expect(relativeDayHint('2026-09-27', '2026-09-26')).toBe('Tomorrow');
    expect(relativeDayHint('2026-09-20', '2026-09-26')).toBe('');
    expect(formatDayKey('2026-09-30')).toMatch(/30/);
    expect(formatDayKey('2026-09-30', { year: true })).toMatch(/2026/);
    expect(formatDayKey('bad')).toBe('');
    expect(isDayKey('2026-09-30')).toBe(true);
    expect(isDayKey('2026-9-30')).toBe(false);
    expect(isDayKey(undefined)).toBe(false);
  });
});
