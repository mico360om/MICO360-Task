import { createApiClient, type RefreshOutcome } from '../lib/api-client';
import { readStoredSession, useAuthStore, type Session } from '../stores/auth-store';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

/** Origin that serves uploaded files (the API origin, without the /api/v1 prefix). */
export const assetOrigin = baseUrl.replace(/\/api\/v1\/?$/, '');
/** Absolute URL for a server-relative asset path (e.g. /uploads/<key>); undefined for empty input. */
export const assetUrl = (path: string | null | undefined): string | undefined => (path ? `${assetOrigin}${path}` : undefined);

/** Web Locks name shared by every tab, so only one of them spends the single-use refresh token at a time. */
const REFRESH_LOCK = 'mico360-auth-refresh';

type LockManagerLike = { request: <T>(name: string, cb: () => Promise<T>) => Promise<T> };

async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }).locks : undefined);
  if (locks && typeof locks.request === 'function') return locks.request(REFRESH_LOCK, fn);
  return fn();
}

/**
 * Has the session already moved past `rejectedToken` — refreshed by this tab, adopted from another
 * tab's broadcast, or written to storage by a tab that won the refresh race? If storage holds a newer
 * pair for the same person, take it over. `spentRefresh` excludes the refresh token we just used.
 */
function adoptNewerSession(rejectedToken: string | null, spentRefresh?: string): boolean {
  const state = useAuthStore.getState();
  if (state.accessToken && state.accessToken !== rejectedToken && (!spentRefresh || state.refreshToken !== spentRefresh)) return true;
  // Only the kind of storage this tab's session lives in (a window-only tab never adopts the remembered one).
  const stored = readStoredSession(state.isAuthenticated ? state.remember : undefined);
  if (!stored || !stored.refreshToken || stored.accessToken === rejectedToken || stored.refreshToken === spentRefresh) return false;
  if (state.user && stored.user && stored.user.id !== state.user.id) return false;
  useAuthStore.setState({
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    user: stored.user ?? state.user,
    isAuthenticated: true,
    remember: stored.remember,
  });
  return true;
}

/** How long to wait for another tab's just-rotated pair to land before retrying a rejected refresh. */
const ROTATION_SETTLE_MS = 250;

type RefreshCall = { kind: 'ok' } | { kind: 'rejected' } | { kind: 'transient' };

/** POST /auth/refresh with one refresh token; stores the new pair on success. */
async function callRefresh(refreshToken: string): Promise<RefreshCall> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return { kind: 'transient' }; // offline / DNS / CORS hiccup — not a verdict on the session
  }
  if (res.ok) {
    try {
      const json = (await res.json()) as { data: Session };
      useAuthStore.getState().setSession(json.data);
      return { kind: 'ok' };
    } catch {
      return { kind: 'transient' };
    }
  }
  if (res.status === 401 || res.status === 400) return { kind: 'rejected' };
  return { kind: 'transient' }; // 429 rate limit, 5xx, proxy errors: stay signed in and try again later
}

/**
 * Exchange the refresh token for a fresh pair, shared safely across tabs: serialized with Web Locks
 * (where available), re-reading the latest stored session first, so two tabs never both spend the same
 * single-use token. Only a 401/400 from /auth/refresh means the session is over — and even then, since
 * the server answers 401 for a token another tab rotated moments ago, the latest stored refresh token
 * is re-read and tried once more before giving up.
 */
export function refreshTokens(rejectedToken: string | null): Promise<RefreshOutcome> {
  return withRefreshLock(async () => {
    // Let a pending cross-tab message (another tab's fresh pair) be applied before deciding.
    await new Promise((r) => setTimeout(r, 0));
    if (adoptNewerSession(rejectedToken)) return 'refreshed';
    const { refreshToken } = useAuthStore.getState();
    if (!refreshToken) return 'invalid';
    const first = await callRefresh(refreshToken);
    if (first.kind === 'ok') return 'refreshed';
    if (first.kind === 'transient') return 'transient';

    // Rejected: most likely another tab rotated it just now. Give its new pair a moment to arrive…
    if (adoptNewerSession(rejectedToken, refreshToken)) return 'refreshed';
    await new Promise((r) => setTimeout(r, ROTATION_SETTLE_MS));
    if (adoptNewerSession(rejectedToken, refreshToken)) return 'refreshed';
    // …then retry once with the latest refresh token in storage, if it differs from the one just spent.
    const state = useAuthStore.getState();
    const latest = readStoredSession(state.isAuthenticated ? state.remember : undefined)?.refreshToken ?? state.refreshToken;
    if (latest && latest !== refreshToken) {
      const retry = await callRefresh(latest);
      if (retry.kind === 'ok') return 'refreshed';
      if (retry.kind === 'transient') return 'transient';
    }
    return 'invalid';
  });
}

/**
 * Refresh the session on demand (e.g. a socket whose handshake was rejected). Resolves true when a
 * usable access token is in the store; signs out only when the refresh token itself was rejected.
 */
export async function refreshSession(): Promise<boolean> {
  const outcome = await refreshTokens(useAuthStore.getState().accessToken);
  if (outcome === 'invalid') useAuthStore.getState().logout('expired');
  return outcome === 'refreshed';
}

/** Shared API client — base URL from env, bearer token from the auth store, with silent refresh on 401. */
export const apiClient = createApiClient({
  baseUrl,
  getToken: () => useAuthStore.getState().accessToken,
  refreshTokens,
  // The refresh token was rejected: the session truly ended → back to sign-in (never on 429/5xx/offline).
  onUnauthorized: () => useAuthStore.getState().logout('expired'),
});
