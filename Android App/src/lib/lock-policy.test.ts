import { describe, it, expect } from 'vitest';
import { createLockPolicy } from './lock-policy';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe('createLockPolicy (MOB-03)', () => {
  it('locks on a cold start that restores a saved session', () => {
    const p = createLockPolicy();
    expect(p.onUserChange('u1')).toBe(true);
  });

  it('does not lock right after the user signs in', () => {
    const p = createLockPolicy();
    expect(p.onUserChange(null)).toBe(false); // launched signed out
    expect(p.onUserChange('u1')).toBe(false); // just typed the password
  });

  it('ignores silent token refreshes (same user)', () => {
    const p = createLockPolicy();
    p.onUserChange(null);
    p.onUserChange('u1');
    expect(p.onUserChange('u1')).toBe(false);
  });

  it('locks when returning from the background after the grace period', () => {
    const c = clock();
    const p = createLockPolicy({ graceMs: 60_000, now: c.now });
    p.onUserChange(null);
    p.onUserChange('u1');
    p.onBackground();
    c.advance(61_000);
    expect(p.onForeground()).toBe(true);
  });

  it('does not lock for a quick app switch within the grace period', () => {
    const c = clock();
    const p = createLockPolicy({ graceMs: 60_000, now: c.now });
    p.onUserChange(null);
    p.onUserChange('u1');
    p.onBackground();
    c.advance(10_000);
    expect(p.onForeground()).toBe(false);
  });

  it('ignores background flips caused by the biometric prompt while locked', () => {
    const c = clock();
    const p = createLockPolicy({ graceMs: 60_000, now: c.now });
    expect(p.onUserChange('u1')).toBe(true);
    p.setLocked(true);
    p.onBackground(); // prompt shown
    c.advance(120_000); // user takes their time
    p.setLocked(false); // unlocked
    expect(p.onForeground()).toBe(false);
  });

  it('never locks while signed out', () => {
    const c = clock();
    const p = createLockPolicy({ graceMs: 1, now: c.now });
    p.onUserChange(null);
    p.onBackground();
    c.advance(10_000);
    expect(p.onForeground()).toBe(false);
  });
});
