import { describe, it, expect } from 'vitest';
import {
  completedOnTime,
  daysUntilDue,
  dueDayKey,
  isDueSoon,
  isDueToday,
  isOverdue,
  overdueFrom,
  shiftDayKey,
  todayKey,
  zonedStartOfDay,
} from './due-date';

const TZ = 'Asia/Muscat'; // UTC+4, no DST
const due = new Date('2026-09-30T00:00:00.000Z'); // stored form of '2026-09-30'

describe('due-date rules (company time zone)', () => {
  it('keeps a date-only due date on its own calendar day', () => {
    expect(dueDayKey(due, TZ)).toBe('2026-09-30');
    expect(dueDayKey('2026-09-30', TZ)).toBe('2026-09-30');
    expect(dueDayKey('2026-09-30T00:00:00.000Z', TZ)).toBe('2026-09-30');
    expect(dueDayKey(null, TZ)).toBeNull();
    expect(dueDayKey('not a date', TZ)).toBeNull();
  });

  it('reads a non-midnight instant in the company zone', () => {
    expect(dueDayKey(new Date('2026-09-30T22:00:00.000Z'), TZ)).toBe('2026-10-01');
  });

  it('is not overdue on the due day itself, even after 04:00 Muscat', () => {
    const fiveAm = new Date('2026-09-30T01:00:00.000Z'); // 05:00 Muscat
    expect(isOverdue(due, TZ, fiveAm)).toBe(false);
    expect(isDueToday(due, TZ, fiveAm)).toBe(true);
    const lateEvening = new Date('2026-09-30T19:59:00.000Z'); // 23:59 Muscat
    expect(isOverdue(due, TZ, lateEvening)).toBe(false);
  });

  it('becomes overdue at midnight company time after the due day', () => {
    const justAfter = new Date('2026-09-30T20:00:00.000Z'); // 00:00 1 Oct Muscat
    expect(isOverdue(due, TZ, justAfter)).toBe(true);
    expect(daysUntilDue(due, TZ, justAfter)).toBe(-1);
    expect(overdueFrom(due, TZ)?.toISOString()).toBe('2026-09-30T20:00:00.000Z');
  });

  it('treats due today and tomorrow as due soon, but not overdue or later days', () => {
    const now = new Date('2026-09-29T06:00:00.000Z');
    expect(isDueSoon(due, TZ, now)).toBe(true); // due tomorrow
    expect(isDueSoon(new Date('2026-10-05T00:00:00.000Z'), TZ, now)).toBe(false);
    expect(isDueSoon(new Date('2026-09-20T00:00:00.000Z'), TZ, now)).toBe(false);
  });

  it('counts a completion on the due day (company time) as on time', () => {
    expect(completedOnTime(due, new Date('2026-09-30T15:00:00.000Z'), TZ)).toBe(true); // 19:00 Muscat
    expect(completedOnTime(due, new Date('2026-09-30T21:00:00.000Z'), TZ)).toBe(false); // 01:00 1 Oct
    expect(completedOnTime(null, new Date(), TZ)).toBeNull();
  });

  it('computes zone day boundaries and key arithmetic', () => {
    expect(zonedStartOfDay('2026-10-01', TZ).toISOString()).toBe('2026-09-30T20:00:00.000Z');
    expect(zonedStartOfDay('2026-03-29', 'Europe/London').toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(zonedStartOfDay('2026-07-01', 'Europe/London').toISOString()).toBe('2026-06-30T23:00:00.000Z');
    expect(shiftDayKey('2026-02-28', 1)).toBe('2026-03-01');
    expect(todayKey(TZ, new Date('2026-09-30T20:30:00.000Z'))).toBe('2026-10-01');
  });
});
