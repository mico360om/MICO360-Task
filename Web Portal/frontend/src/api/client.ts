import { createApiClient, type RefreshOutcome } from '../lib/api-client';
import { COMPANY_HEADER, companyHeaders } from '../lib/companies';
import { readStoredSession, useAuthStore, type Session } from '../stores/auth-store';
import { useCompanyStore } from '../stores/company-store';
import { PROJECT_ARCHIVED_CODE, useArchivedNoticeStore } from '../stores/archived-notice-store';
import { useDatabaseBusyStore } from '../stores/database-busy-store';
import { mayRetryRequest, noteRequest, pageMark } from '../lib/error-reporting';
import { noteManagerViewRefusal } from '../stores/manager-view-store';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';
/** The API's address (/api/v1 on the site itself): the Error log reporter sends there too. */
export const apiBaseUrl = baseUrl;

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

/** Whose session this tab holds now (null: nobody is signed in). */
function heldUserId(): string | null {
  const s = useAuthStore.getState();
  return s.isAuthenticated ? (s.user?.id ?? null) : null;
}

/**
 * Has the session already moved past `rejectedToken` — refreshed by this tab, adopted from another
 * tab's broadcast, or written to storage by a tab that won the refresh race? If storage holds a newer
 * pair for the same person, take it over. `spentRefresh` excludes the refresh token we just used.
 * Batch 2: `expectedUserId` (whose request it was, when known) — only ever that person's session.
 */
function adoptNewerSession(rejectedToken: string | null, expectedUserId?: string | null, spentRefresh?: string): boolean {
  const state = useAuthStore.getState();
  if (expectedUserId !== undefined && heldUserId() !== expectedUserId) return false;
  if (state.accessToken && state.accessToken !== rejectedToken && (!spentRefresh || state.refreshToken !== spentRefresh)) return true;
  // Only the kind of storage this tab's session lives in (a window-only tab never adopts the remembered one).
  const stored = readStoredSession(state.isAuthenticated ? state.remember : undefined);
  if (!stored || !stored.refreshToken || stored.accessToken === rejectedToken || stored.refreshToken === spentRefresh) return false;
  if (state.user && stored.user && stored.user.id !== state.user.id) return false;
  if (expectedUserId !== undefined && (stored.user?.id ?? state.user?.id ?? null) !== expectedUserId) return false;
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

/**
 * Batch 2: how long a renewal may take before it is given up as a passing problem (like being offline:
 * still signed in, tried again later). The server hands the same new pair to a retry of a reply that was
 * lost (within 2 minutes), so giving up never costs the session.
 */
export const REFRESH_TIMEOUT_MS = 20_000;

type RefreshCall = { kind: 'ok' } | { kind: 'rejected' } | { kind: 'transient' } | { kind: 'changed' };

/** A real session in a refresh reply — a 200 from a Wi-Fi sign-in page or a proxy is never stored. */
function isSessionReply(v: unknown): v is Session {
  if (!v || typeof v !== 'object') return false;
  const s = v as { user?: { id?: unknown } | null; accessToken?: unknown; refreshToken?: unknown };
  return typeof s.accessToken === 'string' && !!s.accessToken && typeof s.refreshToken === 'string' && !!s.refreshToken
    && !!s.user && typeof s.user.id === 'string' && !!s.user.id;
}

/**
 * End a refresh token nobody on this browser will hold (a renewal that came back too late) at the server,
 * so it can't sign anyone back in. Fire-and-forget, like the log out itself.
 */
function revokeUnheld(refreshToken: string): void {
  try {
    void fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* best effort */
  }
}

/**
 * POST /auth/refresh with one refresh token; stores the new pair on success — only while the session it
 * was asked for is still the one held (batch 2, review #4). Who is held, and the pair held, are taken as it
 * goes; when the reply comes back:
 * - signed out, or someone else signed in (here, or in another tab whose word hasn't reached this one
 *   yet): the reply is never stored — it would sign the person back in — and is ended at the server ('changed');
 * - the same person holds a newer pair meanwhile (another tab's, or a fresh sign-in): that one is kept,
 *   and the late one ended at the server.
 */
async function callRefresh(refreshToken: string): Promise<RefreshCall> {
  const before = useAuthStore.getState();
  const owner = heldUserId();
  const heldRefresh = before.refreshToken;
  const storedBefore = readStoredSession(before.remember);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS) : null;
  let res: Response;
  let reply: unknown;
  try {
    res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (res.ok) reply = ((await res.json()) as { data?: unknown } | null)?.data;
  } catch {
    return { kind: 'transient' }; // offline / DNS / CORS hiccup / too slow — not a verdict on the session
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.ok) {
    if (!isSessionReply(reply)) return { kind: 'transient' };
    const now = useAuthStore.getState();
    const storedNow = readStoredSession(now.remember);
    const gone = !now.isAuthenticated
      || heldUserId() !== owner
      || (owner !== null && reply.user.id !== owner)
      || (storedBefore !== null && (!storedNow || (storedNow.user?.id ?? owner) !== owner));
    if (gone) {
      revokeUnheld(reply.refreshToken);
      return { kind: 'changed' };
    }
    if (now.refreshToken !== heldRefresh) {
      revokeUnheld(reply.refreshToken);
      return { kind: 'ok' };
    }
    if (storedBefore && storedNow && storedNow.refreshToken && storedNow.refreshToken !== storedBefore.refreshToken) {
      // Another tab of this person stored a newer pair meanwhile: take it over, end the late one.
      revokeUnheld(reply.refreshToken);
      useAuthStore.setState({ accessToken: storedNow.accessToken, refreshToken: storedNow.refreshToken, user: storedNow.user ?? now.user, isAuthenticated: true, remember: storedNow.remember });
      return { kind: 'ok' };
    }
    useAuthStore.getState().setSession(reply);
    return { kind: 'ok' };
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
 * Batch 2: `expectedUserId` — whose request it was (the API client's sentAs): when someone else's session,
 * or none, is held by then, nothing is renewed for them and the answer is 'changed'.
 */
export function refreshTokens(rejectedToken: string | null, expectedUserId?: string | null): Promise<RefreshOutcome> {
  return withRefreshLock(async () => {
    // Let a pending cross-tab message (another tab's fresh pair) be applied before deciding.
    await new Promise((r) => setTimeout(r, 0));
    const changed = () => expectedUserId !== undefined && heldUserId() !== expectedUserId;
    if (changed()) return 'changed';
    if (adoptNewerSession(rejectedToken, expectedUserId)) return 'refreshed';
    const { refreshToken } = useAuthStore.getState();
    if (!refreshToken) return 'invalid';
    const first = await callRefresh(refreshToken);
    if (first.kind === 'ok') return 'refreshed';
    if (first.kind === 'changed') return 'changed';
    if (first.kind === 'transient') return 'transient';

    // Rejected: most likely another tab rotated it just now. Give its new pair a moment to arrive…
    if (changed()) return 'changed';
    if (adoptNewerSession(rejectedToken, expectedUserId, refreshToken)) return 'refreshed';
    await new Promise((r) => setTimeout(r, ROTATION_SETTLE_MS));
    if (changed()) return 'changed';
    if (adoptNewerSession(rejectedToken, expectedUserId, refreshToken)) return 'refreshed';
    // …then retry once with the latest refresh token in storage, if it differs from the one just spent —
    // only the same person's (never another person's, signed in in another tab, found in shared storage).
    const state = useAuthStore.getState();
    const stored = readStoredSession(state.isAuthenticated ? state.remember : undefined);
    const samePerson = !!stored && (!stored.user || !state.user || stored.user.id === state.user.id);
    const latest = (samePerson ? stored.refreshToken : null) ?? state.refreshToken;
    if (latest && latest !== refreshToken) {
      const retry = await callRefresh(latest);
      if (retry.kind === 'ok') return 'refreshed';
      if (retry.kind === 'changed') return 'changed';
      if (retry.kind === 'transient') return 'transient';
    }
    if (changed()) return 'changed';
    return 'invalid';
  });
}

/**
 * Refresh the session on demand (e.g. a socket whose handshake was rejected). Resolves true when a
 * usable access token is in the store; signs out only when the refresh token itself was rejected — and
 * only the person it was asked for, still signed in here (batch 2).
 */
export async function refreshSession(): Promise<boolean> {
  const expected = heldUserId();
  const outcome = await refreshTokens(useAuthStore.getState().accessToken, expected);
  if (outcome === 'invalid' && useAuthStore.getState().isAuthenticated && heldUserId() === expected) useAuthStore.getState().logout('expired');
  return outcome === 'refreshed';
}

/**
 * Shared API client — base URL from env, bearer token from the auth store, with silent refresh on 401.
 * Every request carries the company picked in the top bar (`X-Company-Id`), so lists, counts,
 * exports, search and MICO AI follow it; a pick the server refuses is cleared, with a notice.
 */
export const apiClient = createApiClient({
  baseUrl,
  getToken: () => useAuthStore.getState().accessToken,
  // Batch 2: whose request each one is — sent again (after a 401, a refused company pick) only as them.
  getUserId: heldUserId,
  refreshTokens,
  // The refresh token was rejected: the session truly ended → back to sign-in (never on 429/5xx/offline).
  onUnauthorized: () => useAuthStore.getState().logout('expired'),
  getHeaders: () => companyHeaders(useCompanyStore.getState().pick),
  onCompanyGone: (sent) => useCompanyStore.getState().companyGone(sent[COMPANY_HEADER] ?? null),
  // 1.22: a change to an archived project, refused by the server — said across the page in its words.
  onRefused: (err) => {
    if (err.code === PROJECT_ARCHIVED_CODE && err.message) useArchivedNoticeStore.getState().show(err.message);
    // Manager View was turned on elsewhere (another device): it is on here too (lib/manager-view).
    noteManagerViewRefusal(err);
  },
  // 1.22.4: a request blocked on the way, or a slow one, goes to the Error log.
  onRequestDone: noteRequest,
  // 1.23.14: whether the page was on screen while each request waited (a background or frozen tab isn't slow).
  pageMark,
  // 1.23.23: a dropped read is tried again only on a page on screen, online and not being left.
  networkRetry: { allowed: mayRetryRequest },
  // 1.23.1: the server's database was away for a moment (503 DATABASE_BUSY) — said across the page in its words.
  onDatabaseBusy: (err) => {
    if (err.message) useDatabaseBusyStore.getState().show(err.message);
  },
});
