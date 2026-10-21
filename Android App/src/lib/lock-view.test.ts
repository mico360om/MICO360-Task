import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAppStateCover, lockView, readLockSetting, screenPrivate, type LockViewState } from './lock-view';
import { createLockPolicy } from './lock-policy';
import { appCovered, setAppCovered, subscribeViewing } from './chat-viewing';
import { whenShown } from './alerts';

describe('screenPrivate — no screenshots or recent-apps preview while it matters', () => {
  it('only while someone is signed in with the lock on', () => {
    expect(screenPrivate({ signedIn: true, enabled: true })).toBe(true);
    expect(screenPrivate({ signedIn: true, enabled: false })).toBe(false);
    expect(screenPrivate({ signedIn: true, enabled: null })).toBe(false);
  });
  it('the sign-in screen is never private, even with the lock left on for the same person', () => {
    expect(screenPrivate({ signedIn: false, enabled: true })).toBe(false);
  });
});

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

/**
 * A notification tapped in the phone's list after the app went to the background (6b review): Android
 * hands the tap to the app (its new intent) before the app is in front again (its resume), so the
 * alert must not be read in that moment — the lock may be about to show. The app is covered as it
 * goes away when the lock is on; back in front it is locked, or shown again at once.
 */
describe('createAppStateCover — nothing is read on the way back to the lock', () => {
  const GRACE = 1000;
  function gate({ lockOn = true }: { lockOn?: boolean } = {}) {
    let t = 0;
    let view: LockViewState = 'content';
    const policy = createLockPolicy({ graceMs: GRACE, now: () => t });
    policy.onUserChange('u1'); // a saved session: locked at launch…
    setAppCovered(false); // …and unlocked
    // The lock gate's own lock: the lock view covers the app until it is unlocked.
    const lockIfEnabled = async () => {
      if (!lockOn) return false;
      view = 'lock';
      policy.setLocked(true);
      setAppCovered(true);
      return true;
    };
    const onChange = createAppStateCover({ policy, lockOn: () => lockOn, view: () => view, setCovered: setAppCovered, lockIfEnabled });
    return {
      onChange,
      away: (ms: number) => {
        t += ms;
      },
      unlock: () => {
        view = 'content';
        policy.setLocked(false);
        setAppCovered(false);
      },
      /** A notification tapped now: its alert is read once the app is shown (core/alerts usePushOpened). */
      tap: () => {
        const read = vi.fn();
        whenShown({ covered: appCovered, subscribe: subscribeViewing }, read);
        return read;
      },
    };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));
  afterEach(() => setAppCovered(false));

  it('after the grace period: the tap waits behind the lock, and reads its alert once unlocked', async () => {
    const g = gate();
    g.onChange('background');
    g.away(GRACE * 5);
    const read = g.tap(); // before the app is in front again
    expect(read).not.toHaveBeenCalled();
    g.onChange('active');
    await settle();
    expect(appCovered()).toBe(true);
    expect(read).not.toHaveBeenCalled();
    g.unlock();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('back within the grace period: no lock, the app is shown again at once and the tap reads its alert', async () => {
    const g = gate();
    g.onChange('background');
    g.away(GRACE / 2);
    const read = g.tap();
    g.onChange('active');
    expect(appCovered()).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('with the lock off nothing covers the app: a tap reads its alert at once', () => {
    const g = gate({ lockOn: false });
    g.onChange('background');
    expect(appCovered()).toBe(false);
    expect(g.tap()).toHaveBeenCalledTimes(1);
  });

  it('the fingerprint prompt’s own flips while locked keep the app covered', async () => {
    const g = gate();
    g.onChange('background');
    g.away(GRACE * 5);
    g.onChange('active');
    await settle();
    g.onChange('background'); // the prompt
    g.onChange('active');
    expect(appCovered()).toBe(true);
    g.unlock();
    expect(appCovered()).toBe(false);
  });
});
