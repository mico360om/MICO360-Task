import type { NavAction } from './nav-actions';

/** How long a push tap made while signed out is remembered (WEB-18). */
export const PENDING_ACTION_TTL_MS = 15 * 60 * 1000;

/**
 * Holds a navigation action that cannot run yet — the navigator is not ready (cold start), or the
 * user tapped a push notification while signed out (WEB-18). It is taken once the app can perform
 * it (after sign-in); a stale one (older than the TTL) is dropped instead of surprising a user
 * who signs in much later.
 */
export function createPendingAction({ ttlMs = PENDING_ACTION_TTL_MS, now = Date.now }: { ttlMs?: number; now?: () => number } = {}) {
  let pending: { action: NavAction; at: number } | null = null;
  return {
    set(action: NavAction): void {
      pending = { action, at: now() };
    },
    /** Remove and return the action if it is still fresh. */
    take(): NavAction | null {
      const p = pending;
      pending = null;
      if (!p || now() - p.at > ttlMs) return null;
      return p.action;
    },
    peek(): NavAction | null {
      return pending && now() - pending.at <= ttlMs ? pending.action : null;
    },
    clear(): void {
      pending = null;
    },
  };
}

export type PendingAction = ReturnType<typeof createPendingAction>;
