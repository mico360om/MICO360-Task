import { describe, it, expect } from 'vitest';
import { recordFailure } from './lockout';

describe('account lockout (5-strike, unlock-via-reset)', () => {
  it('increments the failed-attempt count', () => {
    expect(recordFailure({ attempts: 0, max: 5 }).attempts).toBe(1);
  });

  it('does not lock before reaching the max', () => {
    expect(recordFailure({ attempts: 3, max: 5 }).lock).toBe(false); // -> 4
  });

  it('locks on the 5th consecutive failure', () => {
    const r = recordFailure({ attempts: 4, max: 5 }); // -> 5
    expect(r.attempts).toBe(5);
    expect(r.lock).toBe(true);
  });
});
