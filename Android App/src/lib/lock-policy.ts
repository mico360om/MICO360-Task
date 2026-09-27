/** How long the app may sit in the background before biometric unlock is asked again. */
export const LOCK_GRACE_MS = 2 * 60 * 1000;

export interface LockPolicyOptions {
  graceMs?: number;
  now?: () => number;
}

/**
 * When should the biometric app lock appear? (MOB-03)
 *
 * - On a cold start that restores a saved session → lock.
 * - Right after the user signs in → do NOT lock (they just authenticated).
 * - A silent token refresh (same user) → nothing happens; the lock depends on the user id, not on
 *   the session object that changes every ~15 minutes.
 * - Returning from the background after at least the grace period → lock.
 * - Background/foreground flips caused by the biometric prompt itself are ignored while locked.
 *
 * Pure (no React Native imports); LockGate feeds it user and AppState changes.
 */
export function createLockPolicy({ graceMs = LOCK_GRACE_MS, now = Date.now }: LockPolicyOptions = {}) {
  let initialized = false;
  let userId: string | null = null;
  let backgroundedAt: number | null = null;
  let locked = false;

  return {
    /** The signed-in user id changed (or was first observed). True → lock now. */
    onUserChange(next: string | null): boolean {
      const first = !initialized;
      initialized = true;
      const prev = userId;
      userId = next;
      backgroundedAt = null;
      if (!next) {
        locked = false;
        return false;
      }
      if (first) return true; // restored session on launch
      if (prev === next) return false; // same user (e.g. token refresh)
      return false; // a fresh sign-in
    },
    onBackground(): void {
      if (userId && !locked) backgroundedAt = now();
    },
    /** App came back to the foreground. True → lock now. */
    onForeground(): boolean {
      if (!userId || backgroundedAt === null) return false;
      const away = now() - backgroundedAt;
      backgroundedAt = null;
      return away >= graceMs;
    },
    /** Tell the policy whether the lock screen is up (so prompt-induced app-state flips are ignored). */
    setLocked(value: boolean): void {
      locked = value;
      if (value) backgroundedAt = null;
    },
  };
}

export type LockPolicy = ReturnType<typeof createLockPolicy>;
