/**
 * Session lifecycle shared by the app tab and the service worker: start a session after sign-in,
 * check it at boot, and end it (sign-out, server change, legacy upgrade).
 *
 * Storage keys tied to a user (all in chrome.storage.local unless noted):
 *   accessToken (chrome.storage.session), refreshToken, sessionUserId, sessionApiBase,
 *   syncQueue, cache:*, cacheOwner, lastUnread, lastUnreadUser, lastSync.
 * Settings (apiBase, appBase, theme) and the company time zone are not user data and are kept.
 */
import { createTokenStore, requestHeaders, timeoutSignal } from './auth.js';
import { checkBaseUrl, sameOrigin } from './config.js';
import { decodeJwtSub } from './jwt.js';
import { assignOwnerlessItems } from './queue.js';
import { CACHE_PREFIX } from './read-cache.js';

export const USER_DATA_KEYS = ['syncQueue', 'cacheOwner', 'lastUnread', 'lastUnreadUser', 'lastSync'];

/** Delete every cached API response (`cache:*`). */
export async function clearCache(local) {
  const all = (await local.get(null)) || {};
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length) await local.remove(keys);
}

/** Remove the session and everything cached/queued for it from this device. */
export async function clearUserData({ local, session }) {
  await createTokenStore({ local, session }).clear();
  await local.remove(USER_DATA_KEYS);
  await clearCache(local);
}

/** Revoke the refresh token at the server that issued it. Best effort: never blocks signing out. */
async function revoke({ refreshToken, apiBase }, fetchImpl) {
  if (!refreshToken || !apiBase) return;
  try {
    const init = { method: 'POST', body: JSON.stringify({ refreshToken }), signal: timeoutSignal() };
    await fetchImpl(`${apiBase}/auth/logout`, { ...init, headers: requestHeaders(init) });
  } catch {
    /* offline — the local copy is still wiped */
  }
}

/**
 * Explicit sign-out (XP-01): revoke the session server-side (POST /auth/logout to the server that
 * issued it — never to a newly configured one), then wipe tokens, the offline queue, every cached
 * response and the unread/sync markers so the next person on this device starts clean.
 */
export async function signOut({ local, session, fetchImpl = (...a) => fetch(...a) }) {
  const t = await createTokenStore({ local, session }).get();
  await revoke(t, fetchImpl);
  await clearUserData({ local, session });
}

/**
 * Start a session after a successful POST /auth/login. Cached data belonging to a different user
 * is wiped, and the unread-notification baseline is reset so the first poll doesn't announce every
 * existing unread item as new (EXT-06).
 */
export async function startSession({ local, session }, { accessToken, refreshToken, userId, apiBase }) {
  const uid = userId || decodeJwtSub(accessToken);
  if (!accessToken || !refreshToken || !uid || !apiBase) throw new Error('Incomplete sign-in response.');
  const { cacheOwner } = (await local.get('cacheOwner')) || {};
  if (cacheOwner !== uid) await clearCache(local);
  await local.remove(['lastUnread', 'lastUnreadUser', 'lastSync']);
  await local.set({ cacheOwner: uid });
  await createTokenStore({ local, session }).save({ accessToken, refreshToken, userId: uid, apiBase });
  return { userId: uid };
}

/**
 * Boot check for the app and the service worker. Resolves `{ userId }` when there is a usable
 * session for `apiBase`, or null (→ sign in). Also:
 *  - EXT-04: a session issued by a different server than the configured one is ended (revoked at
 *    its own server) and all local user data is wiped — tokens never follow a host change;
 *  - upgrades a pre-hardening session (tokens in chrome.storage.local, no owner/host recorded).
 */
export async function ensureSession({ local, session, apiBase, fetchImpl = (...a) => fetch(...a) }) {
  const stored = (await local.get(['refreshToken', 'sessionUserId', 'sessionApiBase', 'accessToken', 'apiBase'])) || {};
  if (!stored.refreshToken) {
    // Signed out: no stray access token may linger anywhere.
    if (stored.accessToken) await local.remove('accessToken');
    if (session && session !== local) await session.remove('accessToken');
    return null;
  }

  let { sessionApiBase, sessionUserId } = stored;
  if (!sessionApiBase || !sessionUserId) {
    // Legacy session. Its tokens came from the server the user had configured explicitly — or, if
    // none, from the old http://localhost default, which is no longer the default: sign in again.
    const explicit = checkBaseUrl(stored.apiBase);
    const uid = decodeJwtSub(stored.accessToken) || decodeJwtSub(stored.refreshToken);
    if (!explicit.ok || !uid) {
      await clearUserData({ local, session });
      return null;
    }
    sessionApiBase = explicit.url;
    sessionUserId = uid;
    await local.set({ sessionApiBase, sessionUserId, cacheOwner: uid });
    await clearCache(local); // may hold deleted chat text cached by older versions (CHAT-01)
    await assignOwnerlessItems(local, uid);
  }

  if (!sameOrigin(sessionApiBase, apiBase)) {
    await signOut({ local, session, fetchImpl });
    return null;
  }

  // Move a pre-hardening access token out of persistent storage.
  if (stored.accessToken && session && session !== local) {
    const cur = (await session.get('accessToken')) || {};
    if (!cur.accessToken) await session.set({ accessToken: stored.accessToken });
    await local.remove('accessToken');
  }
  return { userId: sessionUserId, apiBase: sessionApiBase };
}
