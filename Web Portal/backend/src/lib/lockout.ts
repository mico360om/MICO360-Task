export interface FailureInput {
  /** Current stored failed-attempt count for the user. */
  attempts: number;
  /** Max attempts allowed before the account locks. */
  max: number;
}

export interface FailureResult {
  /** New failed-attempt count. */
  attempts: number;
  /** Whether the account should now be locked (unlock requires a password reset). */
  lock: boolean;
}

/**
 * Record a failed login attempt. After `max` consecutive failures the account
 * locks and can only be unlocked via password reset (M2 / T2.11).
 */
export function recordFailure({ attempts, max }: FailureInput): FailureResult {
  const next = attempts + 1;
  return { attempts: next, lock: next >= max };
}
