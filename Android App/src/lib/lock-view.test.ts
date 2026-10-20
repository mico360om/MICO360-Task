import { describe, it, expect } from 'vitest';
import { lockView, readLockSetting } from './lock-view';

describe('readLockSetting — the cover always lifts', () => {
  it('passes the setting through', async () => {
    await expect(readLockSetting(async () => true)).resolves.toBe(true);
    await expect(readLockSetting(async () => false)).resolves.toBe(false);
  });
  it('a setting that cannot be read counts as on, so the lock screen (with its sign-out) shows instead of a cover forever', async () => {
    await expect(
      readLockSetting(async () => {
        throw new Error('keystore unavailable');
      }),
    ).resolves.toBe(true);
  });
});

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
