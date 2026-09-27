/**
 * Per-user browser storage. Everything that belongs to one signed-in person (last board, list/grid
 * choice, saved views…) lives under `mico360.u.<userId>.` so the next person on a shared PC never
 * sees it, and signing out clears it. Device-wide preferences (theme, chat sound) stay unscoped.
 * All access is guarded: storage can be unavailable (private mode, blocked site data).
 */

const PREFIX = 'mico360.u.';

/** Per-user names kept across sign-out: things the person built themselves, not cached data. */
const KEPT_ON_SIGN_OUT = new Set(['mytasks.views']);

/** Unscoped keys written by older builds. They can't be attributed to a user, so sign-out removes them. */
export const LEGACY_PER_USER_KEYS = ['mico360.board.projectId', 'mico360.mytasks.view'] as const;

export function userStorageKey(userId: string, name: string): string {
  return `${PREFIX}${userId}.${name}`;
}

export function readUserValue(userId: string | null | undefined, name: string): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(userStorageKey(userId, name));
  } catch {
    return null;
  }
}

export function writeUserValue(userId: string | null | undefined, name: string, value: string | null): void {
  if (!userId) return;
  try {
    if (value === null) localStorage.removeItem(userStorageKey(userId, name));
    else localStorage.setItem(userStorageKey(userId, name), value);
  } catch {
    /* storage unavailable — per-user state is a convenience */
  }
}

/**
 * Remove per-user state from this browser: every `mico360.u.*` key (except the few the person
 * authored, see KEPT_ON_SIGN_OUT) plus the legacy unscoped keys.
 */
export function clearUserStorage(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(PREFIX)) {
        const name = key.slice(PREFIX.length).split('.').slice(1).join('.');
        if (!KEPT_ON_SIGN_OUT.has(name)) doomed.push(key);
      } else if ((LEGACY_PER_USER_KEYS as readonly string[]).includes(key)) {
        doomed.push(key);
      }
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
