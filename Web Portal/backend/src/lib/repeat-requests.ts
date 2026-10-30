const MINUTE = 60_000;

export interface RepeatGuard {
  /**
   * Takes a request for `key` at `at` (ms): null when it is within the per-minute limit (it is then
   * counted), else the whole seconds until the oldest counted one is a minute old (never 0).
   */
  (key: string, at: number): number | null;
  /** How many keys are remembered (for tests). */
  size(): number;
}

/**
 * Remembers, for a minute, when each key (an email address as typed, …) had its requests taken, so
 * one asked again too soon can be told how long to wait. The answer depends only on what was asked
 * for that key — never on whether an account (or a client share) has it — so it is the same, and as
 * fast, for every key. Used by the staff sign-in code and the client page's code.
 */
export function createRepeatGuard(perMinute: number): RepeatGuard {
  // In order of each key's latest request, oldest first, so the stale ones are at the front.
  const asked = new Map<string, number[]>();
  const guard = ((key: string, at: number): number | null => {
    for (const [k, times] of asked) {
      if (at - times[times.length - 1]! < MINUTE) break;
      asked.delete(k);
    }
    const recent = (asked.get(key) ?? []).filter((t) => at - t < MINUTE);
    if (recent.length >= perMinute) return Math.max(1, Math.ceil((recent[0]! + MINUTE - at) / 1000));
    asked.delete(key);
    asked.set(key, [...recent, at]);
    return null;
  }) as RepeatGuard;
  guard.size = () => asked.size;
  return guard;
}
