export interface FailureInput {
  /** Current stored failed-attempt count for the user. */
  attempts: number;
  /** Failed attempts allowed before the account locks. */
  max: number;
  /** Length of the first lock, in minutes. */
  lockMinutes: number;
  /** Upper bound for the backed-off lock, in minutes. Default 24 hours. */
  maxLockMinutes?: number;
  now?: Date;
}

export interface FailureResult {
  /** New failed-attempt count. */
  attempts: number;
  /** When the account unlocks by itself, or null when it isn't locked by this failure. */
  lockedUntil: Date | null;
}

export const DEFAULT_MAX_LOCK_MINUTES = 24 * 60;

/**
 * Record a failed sign-in attempt (T2.11). The `max`-th consecutive failure locks the account for
 * `lockMinutes`; the counter is only cleared by a successful sign-in, a password reset or an admin
 * unlock, so each further failure after a lock expires locks again for twice as long (capped).
 */
export function recordFailure({ attempts, max, lockMinutes, maxLockMinutes = DEFAULT_MAX_LOCK_MINUTES, now = new Date() }: FailureInput): FailureResult {
  const next = attempts + 1;
  if (next < max) return { attempts: next, lockedUntil: null };
  const minutes = Math.min(lockMinutes * 2 ** Math.min(next - max, 20), maxLockMinutes);
  return { attempts: next, lockedUntil: new Date(now.getTime() + minutes * 60_000) };
}

/** A lock is time-limited: it only applies while `lockedUntil` is in the future. */
export function isLocked(lockedUntil: Date | null | undefined, now: Date = new Date()): boolean {
  return lockedUntil != null && lockedUntil.getTime() > now.getTime();
}
