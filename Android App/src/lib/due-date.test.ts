import { describe, it, expect } from 'vitest';
import { COMPANY_TIMEZONE, companyTodayKey, dueDayKey, daysUntilDue, isOverdue, formatDueDay } from './due-date';

describe('mobile due-date rules (XP-03)', () => {
  it('uses Asia/Muscat as the company zone', () => {
    expect(COMPANY_TIMEZONE).toBe('Asia/Muscat');
  });

  it('computes today in the company time zone, not UTC or the device zone', () => {
    // 22:00 UTC on the 29th is already 02:00 on the 30th in Muscat.
    expect(companyTodayKey(new Date('2026-09-29T22:00:00Z'))).toBe('2026-09-30');
    expect(companyTodayKey(new Date('2026-09-29T19:59:00Z'))).toBe('2026-09-29');
  });

  it('keeps the UTC calendar day of a stored due date (UTC midnight = 04:00 Muscat)', () => {
    expect(dueDayKey('2026-09-30T00:00:00.000Z')).toBe('2026-09-30');
    expect(dueDayKey('2026-09-30')).toBe('2026-09-30');
    expect(dueDayKey(null)).toBeNull();
    expect(dueDayKey('garbage')).toBeNull();
  });

  it('is NOT overdue from 04:00 on its own due day — only once the day has passed', () => {
    const task = { dueDate: '2026-09-30T00:00:00.000Z', completedAt: null };
    expect(isOverdue(task, new Date('2026-09-30T00:30:00Z'))).toBe(false); // 04:30 Muscat on the 30th
    expect(isOverdue(task, new Date('2026-09-30T19:59:00Z'))).toBe(false); // 23:59 Muscat on the 30th
    expect(isOverdue(task, new Date('2026-09-30T20:00:00Z'))).toBe(true); // 00:00 Muscat on Oct 1
  });

  it('never marks a completed task overdue', () => {
    expect(isOverdue({ dueDate: '2026-01-01T00:00:00.000Z', completedAt: '2026-02-01T00:00:00Z' }, new Date('2026-09-30T12:00:00Z'))).toBe(false);
  });

  it('counts whole days to the due day', () => {
    const now = new Date('2026-09-30T06:00:00Z');
    expect(daysUntilDue('2026-09-30T00:00:00.000Z', now)).toBe(0);
    expect(daysUntilDue('2026-10-01T00:00:00.000Z', now)).toBe(1);
    expect(daysUntilDue('2026-09-28T00:00:00.000Z', now)).toBe(-2);
    expect(daysUntilDue(null, now)).toBeNull();
  });

  it('formats the due day without shifting it', () => {
    expect(formatDueDay('2026-09-30T00:00:00.000Z', 'en-US')).toBe('Sep 30');
    expect(formatDueDay(null)).toBeNull();
  });
});
