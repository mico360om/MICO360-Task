import type { KeyValueStore } from './storage';

/** Who last signed in on this phone (a user id; not secret). */
export const LAST_USER_KEY = 'mico360.lastUserId';

/** What forgetPreviousUser needs: who signed in last, the fingerprint sign-in key and the app lock. */
export interface UserSwitchDeps {
  /** Where the last person to sign in is remembered (the plain app store). */
  lastUserStore: KeyValueStore;
  /** Whose fingerprint sign-in key is on this phone (undefined when none, or an older build's). */
  getKeyOwner: () => Promise<string | undefined>;
  isKeyArmed: () => Promise<boolean>;
  disarmKey: () => Promise<void>;
  isLockOn: () => Promise<boolean>;
  turnLockOff: () => Promise<void>;
}

/** Run one step; a phone-storage error must never fail a sign-in the server already granted. */
async function attempt<T>(step: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await step();
  } catch {
    return fallback;
  }
}

/**
 * The fingerprint sign-in key and the app lock belong to one person. They survive a sign-out, so
 * the same person can sign back in with a fingerprint; when someone else signs in on the phone,
 * both are turned off. The lock is compared with the last person who signed in (remembered here),
 * not with the key, so losing the key (a password change, an expiry) doesn't take the owner's lock
 * with it; when no one is remembered yet (updated from 1.2.0) the lock stays. Call it right after
 * any successful sign-in. Never throws.
 */
export async function forgetPreviousUser(newUserId: string, deps: UserSwitchDeps): Promise<void> {
  const keyOwner = await attempt(deps.getKeyOwner, undefined);
  if (keyOwner !== newUserId && (await attempt(deps.isKeyArmed, false))) await attempt(deps.disarmKey, undefined);

  const lastUser = await attempt(async () => (await deps.lastUserStore.getItem(LAST_USER_KEY)) ?? undefined, undefined);
  if (lastUser !== undefined && lastUser !== newUserId && (await attempt(deps.isLockOn, false))) {
    await attempt(deps.turnLockOff, undefined);
  }
  await attempt(() => deps.lastUserStore.setItem(LAST_USER_KEY, newUserId), undefined);
}
