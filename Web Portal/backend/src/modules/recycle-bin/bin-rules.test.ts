import { describe, it, expect } from 'vitest';
import { BIN_DAYS, binDaysLeft, binExpiryOf, effectiveExpiry, mayEraseNow, mayRestore } from './bin-rules';

const TZ = 'Asia/Muscat';

describe('how long a deleted task is kept', () => {
  it('60 days: erased at the company midnight that ends the 60th day after the day it was deleted', () => {
    expect(BIN_DAYS).toBe(60);
    // Deleted 3 Nov 10:00 Muscat (06:00 UTC) → erased at the start of 3 Jan, Muscat midnight (20:00 UTC on 2 Jan).
    expect(binExpiryOf(new Date('2026-11-03T06:00:00Z'), TZ).toISOString()).toBe('2027-01-02T20:00:00.000Z');
    // Late in the evening in Muscat (21:30 UTC is 01:30 on the 4th there): the 4th is its day.
    expect(binExpiryOf(new Date('2026-11-03T21:30:00Z'), TZ).toISOString()).toBe('2027-01-03T20:00:00.000Z');
  });

  it('days left count whole days from today, 0 on the last day (it is erased tonight)', () => {
    const deleted = new Date('2026-11-03T06:00:00Z');
    const expires = binExpiryOf(deleted, TZ);
    expect(binDaysLeft(expires, TZ, deleted)).toBe(60);
    expect(binDaysLeft(expires, TZ, new Date('2026-11-10T08:00:00Z'))).toBe(53);
    expect(binDaysLeft(expires, TZ, new Date('2027-01-01T08:00:00Z'))).toBe(1);
    expect(binDaysLeft(expires, TZ, new Date('2027-01-02T08:00:00Z'))).toBe(0);
    // Past its time and not erased yet (the sweep runs hourly): still 0, never negative.
    expect(binDaysLeft(expires, TZ, new Date('2027-01-05T08:00:00Z'))).toBe(0);
  });

  it('a task deleted before the Recycle Bin (no expiry stored) is kept 60 days from when it was deleted', () => {
    const deleted = new Date('2026-11-03T06:00:00Z');
    expect(effectiveExpiry({ deletedAt: deleted, binExpiresAt: null }, TZ).toISOString()).toBe(binExpiryOf(deleted, TZ).toISOString());
    const stored = new Date('2027-02-01T00:00:00Z');
    expect(effectiveExpiry({ deletedAt: deleted, binExpiresAt: stored }, TZ)).toBe(stored);
  });

  it('an expiry the upgrade wrote at UTC midnight reads as that day in Muscat (04:00 there)', () => {
    const backfilled = new Date('2027-01-10T00:00:00Z');
    expect(binDaysLeft(backfilled, TZ, new Date('2027-01-09T08:00:00Z'))).toBe(0);
    expect(binDaysLeft(backfilled, TZ, new Date('2027-01-08T08:00:00Z'))).toBe(1);
  });
});

describe('who may restore and who may delete forever', () => {
  it('admins restore any; people who run the task’s project restore its tasks; nobody else', () => {
    expect(mayRestore({ isAdmin: true, runsProject: false })).toBe(true);
    expect(mayRestore({ isAdmin: false, runsProject: true })).toBe(true);
    expect(mayRestore({ isAdmin: false, runsProject: false })).toBe(false);
  });

  it('delete forever before the 60 days: admins only', () => {
    expect(mayEraseNow({ isAdmin: true })).toBe(true);
    expect(mayEraseNow({ isAdmin: false })).toBe(false);
  });
});
