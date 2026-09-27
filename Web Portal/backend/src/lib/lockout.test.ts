import { describe, it, expect } from 'vitest';
import { isLocked, recordFailure } from './lockout';

const now = new Date('2026-09-26T10:00:00.000Z');
const minutesFromNow = (d: Date | null) => (d ? (d.getTime() - now.getTime()) / 60_000 : null);

describe('account lockout (time-limited, with backoff)', () => {
  it('increments the failed-attempt count', () => {
    expect(recordFailure({ attempts: 0, max: 5, lockMinutes: 15, now }).attempts).toBe(1);
  });

  it('does not lock before reaching the max', () => {
    expect(recordFailure({ attempts: 3, max: 5, lockMinutes: 15, now }).lockedUntil).toBeNull(); // -> 4
  });

  it('locks for lockMinutes on the 5th consecutive failure', () => {
    const r = recordFailure({ attempts: 4, max: 5, lockMinutes: 15, now }); // -> 5
    expect(r.attempts).toBe(5);
    expect(minutesFromNow(r.lockedUntil)).toBe(15);
  });

  it('doubles the lock for each further failure after it expires, up to the cap', () => {
    expect(minutesFromNow(recordFailure({ attempts: 5, max: 5, lockMinutes: 15, now }).lockedUntil)).toBe(30);
    expect(minutesFromNow(recordFailure({ attempts: 6, max: 5, lockMinutes: 15, now }).lockedUntil)).toBe(60);
    expect(minutesFromNow(recordFailure({ attempts: 40, max: 5, lockMinutes: 15, now }).lockedUntil)).toBe(24 * 60);
    expect(minutesFromNow(recordFailure({ attempts: 9, max: 5, lockMinutes: 15, maxLockMinutes: 60, now }).lockedUntil)).toBe(60);
  });

  it('treats a lock as expired once lockedUntil has passed', () => {
    expect(isLocked(null, now)).toBe(false);
    expect(isLocked(new Date(now.getTime() + 1000), now)).toBe(true);
    expect(isLocked(new Date(now.getTime() - 1000), now)).toBe(false);
    expect(isLocked(now, now)).toBe(false); // the legacy "lockedUntil = now" rows unlock on their own
  });
});
