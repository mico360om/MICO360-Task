/**
 * What the app lock shows. While a signed-in person's lock setting is still being read (a cold
 * start reads it from the keystore), a plain cover hides the app, so nothing flashes before the lock.
 */
export function lockView(state: { signedIn: boolean; enabled: boolean | null; locked: boolean }): 'cover' | 'lock' | 'content' {
  if (!state.signedIn) return 'content';
  if (state.enabled === null) return 'cover';
  return state.locked ? 'lock' : 'content';
}
