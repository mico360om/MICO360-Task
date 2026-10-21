import type { LockPolicy } from './lock-policy';

/**
 * What the app lock shows. While a signed-in person's lock setting is still being read (a cold
 * start reads it from the keystore), a plain cover hides the app, so nothing flashes before the lock.
 */
export function lockView(state: { signedIn: boolean; enabled: boolean | null; locked: boolean }): 'cover' | 'lock' | 'content' {
  if (!state.signedIn) return 'content';
  if (state.enabled === null) return 'cover';
  return state.locked ? 'lock' : 'content';
}

/**
 * Read the lock setting for the lock gate. A setting that can't be read (a keystore error) counts as
 * on: the lock screen shows, and it has a sign-out, rather than the cover staying up for good.
 */
export async function readLockSetting(isEnabled: () => Promise<boolean>): Promise<boolean> {
  try {
    return await isEnabled();
  } catch {
    return true;
  }
}

/**
 * Block screenshots, screen recording and the recent-apps preview (FLAG_SECURE)? Only while someone
 * is signed in with the lock on: the lock stays on for its owner after a sign-out, but the sign-in
 * screen shows nothing private.
 */
export function screenPrivate(state: { signedIn: boolean; enabled: boolean | null }): boolean {
  return state.signedIn && state.enabled === true;
}

export type LockViewState = ReturnType<typeof lockView>;

/**
 * The lock gate's answer to the app going to the background and coming back (AppState):
 * - going away with the lock on → covered at once (6b review): a notification tapped in the phone's
 *   list reaches the app before it is in front again (Android's new intent comes before its
 *   resume), and its alert must not be read in the moment before the lock shows;
 * - back after the grace period → lock (covered until unlocked; shown again if the setting was
 *   turned off meanwhile);
 * - back sooner → shown again at once (still covered while locked: the fingerprint prompt's flips).
 */
export function createAppStateCover(deps: {
  policy: Pick<LockPolicy, 'onBackground' | 'onForeground'>;
  /** The lock setting as last read (null: not read yet). */
  lockOn: () => boolean | null;
  view: () => LockViewState;
  setCovered: (covered: boolean) => void;
  /** Lock when the setting is on; says whether it locked. */
  lockIfEnabled: () => Promise<boolean>;
}): (state: string) => void {
  const { policy, lockOn, view, setCovered, lockIfEnabled } = deps;
  const showAgain = () => setCovered(view() !== 'content');
  return (state) => {
    if (state === 'background') {
      policy.onBackground();
      if (lockOn()) setCovered(true);
      return;
    }
    if (state !== 'active') return;
    if (!policy.onForeground()) {
      showAgain();
      return;
    }
    setCovered(true);
    void lockIfEnabled().then(
      // Locked: the lock view keeps it covered until unlocked. Not on: shown again.
      (didLock) => {
        if (!didLock) showAgain();
      },
      showAgain,
    );
  };
}
