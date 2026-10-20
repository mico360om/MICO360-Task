/** What forgetPreviousUser needs: the fingerprint sign-in key and the app lock. */
export interface UserSwitchDeps {
  /** Whose fingerprint sign-in key is on this phone (undefined when none, or an older build's). */
  getKeyOwner: () => Promise<string | undefined>;
  isKeyArmed: () => Promise<boolean>;
  disarmKey: () => Promise<void>;
  isLockOn: () => Promise<boolean>;
  turnLockOff: () => Promise<void>;
}

/**
 * The fingerprint sign-in key and the app lock belong to one person. They survive a sign-out, so
 * the same person can sign back in with a fingerprint; when someone else signs in on the phone,
 * both are turned off. Call it right after any successful sign-in.
 */
export async function forgetPreviousUser(newUserId: string, deps: UserSwitchDeps): Promise<void> {
  const owner = await deps.getKeyOwner();
  if (owner === newUserId) return;
  if (await deps.isKeyArmed()) await deps.disarmKey();
  if (await deps.isLockOn()) await deps.turnLockOff();
}
