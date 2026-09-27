import type { Session } from './types';

/**
 * - `user`: the person chose "Sign out" in Settings (after being warned about unsynced changes).
 * - `lock`: "Sign out instead" on the biometric lock screen. Whoever is holding the phone may not
 *   be its owner, so the session is revoked but the owner's queued offline changes are kept
 *   (they replay only when the owner signs in again).
 * - `expired`: the server rejected the refresh token (a real 401/400 from /auth/refresh).
 */
export type SignOutReason = 'user' | 'lock' | 'expired';

export interface SignOutDeps {
  getSession: () => Session | null;
  /** `POST /auth/logout { refreshToken }` — revokes the session server-side. */
  revokeRefreshToken: (refreshToken: string) => Promise<unknown>;
  /** Remove this phone's push token from the account (needs the access token, so runs first). */
  unregisterPush: () => Promise<unknown>;
  /** Forget the biometric sign-in credential. */
  disarmBiometricLogin: () => Promise<unknown>;
  /** Clear the stored session — the app switches to the sign-in screen. */
  clearSession: () => Promise<unknown>;
  /** Drop every in-memory query (TanStack `queryClient.clear()`). */
  clearQueryCache: () => void;
  /** Delete every `mico360.cache.*` entry. */
  clearReadCache: () => Promise<unknown>;
  /** Delete this user's queued offline changes (the UI warned about them first). */
  clearQueuedChanges: (userId: string) => Promise<unknown>;
  /** Upper bound for each network step, so signing out offline is not blocked (default 5 s). */
  networkTimeoutMs?: number;
  /** Diagnostics hook for a step that failed (the sign-out still completes). */
  onStepError?: (step: string, error: unknown) => void;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * The ONE sign-out routine every path uses — the Settings button, the lock screen, and a session
 * the server ended (XP-01, MOB-01, MOB-11, XP-02):
 *
 * 1. while the access token still works (`user` / `lock`): unregister the push token and revoke
 *    the refresh token with `POST /auth/logout`;
 * 2. disarm biometric sign-in;
 * 3. clear the session (UI returns to sign-in);
 * 4. clear the query cache and every `mico360.cache.*` entry, so the next person to sign in on
 *    this phone never sees the previous user's tasks, chats or notifications;
 * 5. an explicit sign-out from Settings also deletes the user's queued offline changes (after the
 *    UI warned about them). When the session expired, or someone signed out from the lock screen,
 *    they are kept — they belong to that user and replay only when the same user signs in again,
 *    so neither expiry nor a stranger at the lock screen can discard the owner's work.
 *
 * Network steps are bounded by a timeout and their failures never stop the local clean-up.
 * Concurrent calls share one run.
 */
export function createSignOut(deps: SignOutDeps) {
  const timeoutMs = deps.networkTimeoutMs ?? 5_000;
  let running: Promise<void> | null = null;

  async function step(name: string, fn: () => unknown): Promise<void> {
    try {
      await fn();
    } catch (error) {
      deps.onStepError?.(name, error);
    }
  }

  async function run(reason: SignOutReason): Promise<void> {
    const session = deps.getSession();
    const userId = session?.user.id ?? null;
    const revokes = reason === 'user' || reason === 'lock'; // the token still works: revoke it
    let revoked: string | null = null;

    if (session && revokes) {
      await step('push', () => withTimeout(deps.unregisterPush(), timeoutMs));
      // Re-read: a silent refresh may have rotated the token while we were unregistering.
      revoked = deps.getSession()?.refreshToken ?? session.refreshToken;
      await step('logout', () => withTimeout(deps.revokeRefreshToken(revoked!), timeoutMs));
    }

    await step('biometric', () => deps.disarmBiometricLogin());
    const latest = deps.getSession()?.refreshToken ?? null;
    await step('session', () => deps.clearSession());
    // A refresh that landed after the revoke minted a new token — revoke that one too.
    if (revokes && latest && latest !== revoked) {
      await step('logout', () => withTimeout(deps.revokeRefreshToken(latest), timeoutMs));
    }

    await step('queries', () => deps.clearQueryCache());
    await step('read-cache', () => deps.clearReadCache());
    if (reason === 'user' && userId) await step('queue', () => deps.clearQueuedChanges(userId));
  }

  function signOut(reason: SignOutReason = 'user'): Promise<void> {
    if (!running) {
      running = run(reason).finally(() => {
        running = null;
      });
    }
    return running;
  }

  return { signOut, isSigningOut: () => running !== null };
}

export type SignOut = ReturnType<typeof createSignOut>;
