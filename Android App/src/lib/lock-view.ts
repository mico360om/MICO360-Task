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
