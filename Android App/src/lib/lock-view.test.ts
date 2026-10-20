import { describe, it, expect } from 'vitest';
import { lockView } from './lock-view';

describe('lockView — never a flash of the app before the lock', () => {
  it('signed out: the app (the sign-in screen) shows', () => {
    expect(lockView({ signedIn: false, enabled: null, locked: false })).toBe('content');
  });
  it('signed in, the lock setting not read yet: a cover, so nothing shows before the lock', () => {
    expect(lockView({ signedIn: true, enabled: null, locked: false })).toBe('cover');
  });
  it('locked: the lock screen', () => {
    expect(lockView({ signedIn: true, enabled: true, locked: true })).toBe('lock');
  });
  it('unlocked, or the lock is off: the app', () => {
    expect(lockView({ signedIn: true, enabled: true, locked: false })).toBe('content');
    expect(lockView({ signedIn: true, enabled: false, locked: false })).toBe('content');
  });
});
