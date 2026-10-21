// Extension session/auth helpers. The extension keeps the user signed in by silently refreshing the
// short-lived access token with the stored refresh token (a 30-day session, no repeated logins).
//
// Where tokens live (EXT-07):
//   - the access token in chrome.storage.session — memory only, never written to disk, gone after a
//     browser restart (it is re-minted from the refresh token on first use);
//   - the refresh token, plus which user and which server the session belongs to (and that person's
//     profile and roles from the server, M12), in chrome.storage.local so the session survives restarts.
//
// Refresh tokens are single-use (the server rotates them). The app tab(s) and the background service
// worker share one refresh at a time through a cross-context lock (XP-04); whoever waits re-reads the
// freshly rotated token instead of spending the old one a second time.

import { withLock } from './locks.js';
import { AuthUnavailableError } from './errors.js';
import { sameOrigin } from './config.js';

/** Requests abort after this long so the app never hangs on a slow/unreachable backend. */
export const REQUEST_TIMEOUT_MS = 6000;
/** A file (an Excel or PDF export) may take much longer to build and download (M4). */
export const DOWNLOAD_TIMEOUT_MS = 120000;
export const REFRESH_LOCK = 'mico360:auth-refresh';

/** An AbortSignal that fires after `ms` (when supported), else undefined. */
export function timeoutSignal(ms = REQUEST_TIMEOUT_MS) {
  try {
    return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Headers for an API call. `Content-Type: application/json` is sent only when there is a body:
 * Fastify rejects a body-less DELETE/PUT that declares JSON with 400 (EXT-02).
 */
export function requestHeaders(opts = {}, token = null) {
  return {
    ...(opts.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(opts.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * A usable session from /auth/login or /auth/refresh (M5): both tokens and the person's id. Anything
 * else — a proxy or Wi-Fi sign-in page answering 200 — is never stored, so the session we have stays.
 */
export function isSession(data) {
  return !!data && typeof data.accessToken === 'string' && !!data.accessToken
    && typeof data.refreshToken === 'string' && !!data.refreshToken
    && !!data.user && typeof data.user.id === 'string' && !!data.user.id;
}

/**
 * The profile kept with the session (M12): who is signed in and their roles, from the server's
 * sign-in and refresh replies. Only these fields are kept; the server checks roles on every call.
 */
export function publicUser(u) {
  if (!u || typeof u.id !== 'string' || !u.id) return null;
  return {
    id: u.id,
    email: typeof u.email === 'string' ? u.email : '',
    username: typeof u.username === 'string' ? u.username : '',
    roles: Array.isArray(u.roles) ? u.roles.filter((r) => typeof r === 'string') : [],
    avatarUrl: typeof u.avatarUrl === 'string' ? u.avatarUrl : null,
  };
}

/** The signed-in person's profile from the last sign-in or refresh, or null. */
export async function readSessionUser(local) {
  const o = (await local.get('sessionUser')) || {};
  return publicUser(o.sessionUser);
}

/**
 * Token persistence split across chrome.storage.session (access) and chrome.storage.local (the rest).
 * Session storage is always there from Chrome 102 (the manifest needs 116), so the access token is
 * never written to disk: without it there is no token store at all.
 */
export function createTokenStore({ local, session }) {
  if (!session || session === local) throw new Error('The access token needs Chrome’s session storage (chrome.storage.session).');
  const mem = session;
  return {
    async get() {
      const [a, b] = await Promise.all([
        mem.get('accessToken'),
        local.get(['refreshToken', 'sessionUserId', 'sessionApiBase']),
      ]);
      return {
        accessToken: (a && a.accessToken) || null,
        refreshToken: (b && b.refreshToken) || null,
        userId: (b && b.sessionUserId) || null,
        apiBase: (b && b.sessionApiBase) || null,
      };
    },
    /** Persist a rotated pair. The refresh token goes first: the old one is already spent. */
    async saveRotated({ accessToken, refreshToken, user }) {
      const profile = publicUser(user);
      if (refreshToken) await local.set({ refreshToken, ...(profile ? { sessionUser: profile } : {}) });
      await mem.set({ accessToken });
    },
    /** New session. The access token is written first: other contexts treat the refresh token as "signed in". */
    async save({ accessToken, refreshToken, userId, apiBase, user }) {
      const profile = publicUser(user);
      await mem.set({ accessToken });
      await local.set({ refreshToken, sessionUserId: userId, sessionApiBase: apiBase, ...(profile && profile.id === userId ? { sessionUser: profile } : {}) });
    },
    async clear() {
      await mem.remove('accessToken');
      // 'accessToken' in local storage: where versions before EXT-07 kept it.
      await local.remove(['accessToken', 'refreshToken', 'sessionUserId', 'sessionApiBase', 'sessionUser']);
    },
  };
}

/** The error code in a reply's JSON body, or undefined when it has none (a proxy's own page). */
async function errorCode(res) {
  try {
    return (await res.json())?.error?.code;
  } catch {
    return undefined;
  }
}

function unauthorizedResponse() {
  const body = JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in again.' } });
  return new Response(body, { status: 401, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Authenticated access to `apiBase` for one extension context (the app tab or the service worker).
 *
 * `onExpired()` fires when the session is definitively over (the server rejected the refresh token,
 * or the session belongs to another server) so the UI can return to the sign-in screen instead of
 * pretending to be offline. A network/server hiccup while renewing is NOT an expiry: the request
 * rejects with AuthUnavailableError and callers treat it like being offline.
 */
export function createAuth({ local, session, apiBase, fetchImpl = (...a) => fetch(...a), onExpired, locks } = {}) {
  const tokens = createTokenStore({ local, session });
  let inflight = null;

  function expired() {
    try {
      if (onExpired) onExpired();
    } catch {
      /* listener errors must not break the request path */
    }
  }

  /** Tokens are only ever sent to the server that issued them (EXT-04). */
  const boundHere = (t) => !!t.refreshToken && !!t.apiBase && sameOrigin(t.apiBase, apiBase);

  async function refreshUnderLock(failedToken) {
    const run = await withLock(REFRESH_LOCK, async () => {
      const t = await tokens.get();
      if (!boundHere(t)) return { token: null, expired: true };
      // Another tab / the service worker already renewed while we waited: use its token.
      if (t.accessToken && t.accessToken !== failedToken) return { token: t.accessToken, expired: false };
      let res;
      try {
        res = await fetchImpl(`${apiBase}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: t.refreshToken }),
          signal: timeoutSignal(),
        });
      } catch {
        return { token: null, expired: false }; // offline / timeout — try again later
      }
      // M5, as on the web: only 400/401 mean the server ended this session. A 403 is a passing
      // problem (a proxy or firewall in the way), like 429 and 5xx: stay signed in and try again later —
      // unless our server says the account was turned off (ACCOUNT_INACTIVE), as on Android. It has
      // spent the refresh token by then, and sending it again would look like a stolen token.
      if (res.status === 400 || res.status === 401 || (res.status === 403 && (await errorCode(res)) === 'ACCOUNT_INACTIVE')) {
        await tokens.clear(); // the server said no: this session is over
        return { token: null, expired: true };
      }
      if (!res.ok) return { token: null, expired: false }; // 403 / 429 / 5xx — transient
      let data = null;
      try {
        data = (await res.json())?.data ?? null;
      } catch {
        data = null;
      }
      // A 200 that isn't a real session for this person (a portal page, a token or the user missing)
      // is no verdict either, and must never replace the session we have.
      if (!isSession(data) || data.user.id !== t.userId) return { token: null, expired: false };
      await tokens.saveRotated(data);
      return { token: data.accessToken, expired: false };
    }, { locks });
    return run.value;
  }

  /** One renewal at a time: concurrent callers in this context share the same promise. */
  function refresh(failedToken = null) {
    if (!inflight) {
      inflight = refreshUnderLock(failedToken).finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  async function authedFetch(path, opts = {}) {
    const t = await tokens.get();
    if (!boundHere(t)) {
      expired();
      return unauthorizedResponse();
    }
    let token = t.accessToken;
    if (!token) {
      // e.g. after a browser restart wiped chrome.storage.session.
      const r = await refresh(null);
      if (r.expired) {
        expired();
        return unauthorizedResponse();
      }
      if (!r.token) throw new AuthUnavailableError();
      token = r.token;
    }
    const send = (tok) => fetchImpl(`${apiBase}${path}`, { signal: timeoutSignal(), ...opts, headers: requestHeaders(opts, tok) });
    const res = await send(token);
    if (res.status !== 401) return res;
    const r = await refresh(token);
    if (r.expired) {
      expired();
      return res;
    }
    if (!r.token) throw new AuthUnavailableError();
    return send(r.token);
  }

  return { authedFetch, refresh, getTokens: () => tokens.get(), tokens };
}
