// Extension session/auth helpers. The extension keeps the user signed in by silently refreshing the
// short-lived access token with the stored refresh token (a 30-day session, no repeated logins).
//
// Where tokens live (EXT-07):
//   - the access token in chrome.storage.session — memory only, never written to disk, gone after a
//     browser restart (it is re-minted from the refresh token on first use);
//   - the refresh token, plus which user and which server the session belongs to, in
//     chrome.storage.local so the session survives restarts.
//
// Refresh tokens are single-use (the server rotates them). The app tab(s) and the background service
// worker share one refresh at a time through a cross-context lock (XP-04); whoever waits re-reads the
// freshly rotated token instead of spending the old one a second time.

import { withLock } from './locks.js';
import { AuthUnavailableError } from './errors.js';
import { sameOrigin } from './config.js';

/** Requests abort after this long so the app never hangs on a slow/unreachable backend. */
export const REQUEST_TIMEOUT_MS = 6000;
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

/** Token persistence split across chrome.storage.session (access) and chrome.storage.local (the rest). */
export function createTokenStore({ local, session }) {
  const mem = session || local; // fall back to local only where storage.session doesn't exist
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
    async saveRotated({ accessToken, refreshToken }) {
      if (refreshToken) await local.set({ refreshToken });
      await mem.set({ accessToken });
    },
    /** New session. The access token is written first: other contexts treat the refresh token as "signed in". */
    async save({ accessToken, refreshToken, userId, apiBase }) {
      await mem.set({ accessToken });
      await local.set({ refreshToken, sessionUserId: userId, sessionApiBase: apiBase });
    },
    async clear() {
      await mem.remove('accessToken');
      if (mem !== local) await local.remove('accessToken'); // pre-hardening location
      await local.remove(['refreshToken', 'sessionUserId', 'sessionApiBase']);
    },
  };
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
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        await tokens.clear(); // the server said no: this session is over
        return { token: null, expired: true };
      }
      if (!res.ok) return { token: null, expired: false }; // 429 / 5xx — transient
      let data = null;
      try {
        data = (await res.json())?.data ?? null;
      } catch {
        data = null;
      }
      if (!data || !data.accessToken) return { token: null, expired: false };
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
