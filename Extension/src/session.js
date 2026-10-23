/**
 * Session lifecycle shared by the app tab and the service worker: start a session after sign-in,
 * check it at boot, and end it (sign-out, server change, legacy upgrade).
 *
 * Storage keys tied to a user (all in chrome.storage.local unless noted):
 *   accessToken (chrome.storage.session), refreshToken, sessionUserId, sessionApiBase, sessionUser,
 *   syncQueue, cache:*, cacheOwner, lastUnread, lastUnreadUser, lastSync, quickAddLastProject,
 *   quickAddRecent, desktopAlerts (what the desktop alerts may say), and the popup's unsent form,
 *   right-click capture, what the last desktop alert was about and chat text not sent yet
 *   (chrome.storage.session).
 * Settings (apiBase, appBase, theme) and the company time zone are not user data and are kept.
 */
import { createTokenStore, requestHeaders, timeoutSignal } from './auth.js';
import { checkBaseUrl, sameOrigin } from './config.js';
import { decodeJwtSub } from './jwt.js';
import { assignOwnerlessItems } from './queue.js';
import { CACHE_PREFIX } from './read-cache.js';
import { LAST_PROJECT_KEY, RECENT_KEY, QUICK_ADD_SESSION_KEYS, PANEL_DRAFT_PREFIX } from './quick-add.js';
import { DESKTOP_ALERTS_KEY, ALERT_TARGET_KEY, clearDesktopAlert } from './notify.js';
import { CHAT_DRAFTS_KEY } from './chat-drafts.js';

export const USER_DATA_KEYS = ['syncQueue', 'cacheOwner', 'lastUnread', 'lastUnreadUser', 'lastSync', LAST_PROJECT_KEY, RECENT_KEY, DESKTOP_ALERTS_KEY];

/**
 * One person's own settings and leftovers on this device (not their queue, which keeps its owner on
 * each change): what the desktop alerts may say, the popup's last project, recent tasks, unsent form
 * and right-click capture, what the last alert was about, and chat text not sent yet. They go when
 * someone else signs in — after a session that ended rather than a sign-out, they are still there.
 */
const PERSON_LOCAL_KEYS = [DESKTOP_ALERTS_KEY, LAST_PROJECT_KEY, RECENT_KEY];
const PERSON_SESSION_KEYS = [...QUICK_ADD_SESSION_KEYS, ALERT_TARGET_KEY, CHAT_DRAFTS_KEY];

/** Take one person's leftovers out of session storage — with each window's side-panel form. */
async function removePersonSession(session) {
  let kept = [];
  try {
    kept = Object.keys((await session.get(null)) || {}).filter((k) => k.startsWith(PANEL_DRAFT_PREFIX));
  } catch {
    kept = [];
  }
  await session.remove([...PERSON_SESSION_KEYS, ...kept]);
}

/** Delete every cached API response (`cache:*`). */
export async function clearCache(local) {
  const all = (await local.get(null)) || {};
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length) await local.remove(keys);
}

/**
 * Remove the session and everything cached/queued for it from this device. `notifications`
 * (chrome.notifications): the last desktop alert goes too.
 */
export async function clearUserData({ local, session, notifications }) {
  clearDesktopAlert(notifications);
  await createTokenStore({ local, session }).clear();
  await local.remove(USER_DATA_KEYS);
  // The popup's and the side panels' unsent forms, what the right-click menu captured for it, what
  // the last desktop alert was about, and chat text not sent yet (memory only).
  await removePersonSession(session);
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
export async function signOut({ local, session, fetchImpl = (...a) => fetch(...a), notifications }) {
  clearDesktopAlert(notifications);
  const t = await createTokenStore({ local, session }).get();
  await revoke(t, fetchImpl);
  await clearUserData({ local, session, notifications });
}

/**
 * Start a session after a successful POST /auth/login. Cached data belonging to a different user
 * is wiped — with that person's own settings on this device (PERSON_*_KEYS: "Say what it's about"
 * must not carry over to the next person after a session ended) — and the unread-notification
 * baseline is reset so the first poll doesn't announce every existing unread item as new (EXT-06).
 * The profile in the reply (`user`: email, username, roles) is kept with the session, so the app
 * knows who is signed in even when it starts offline (M12).
 */
export async function startSession({ local, session }, { accessToken, refreshToken, userId, apiBase, user }) {
  const uid = userId || decodeJwtSub(accessToken);
  if (!accessToken || !refreshToken || !uid || !apiBase) throw new Error('Incomplete sign-in response.');
  const { cacheOwner } = (await local.get('cacheOwner')) || {};
  if (cacheOwner !== uid) {
    await clearCache(local);
    await local.remove(PERSON_LOCAL_KEYS);
    await removePersonSession(session);
  }
  await local.remove(['lastUnread', 'lastUnreadUser', 'lastSync']);
  await local.set({ cacheOwner: uid });
  await createTokenStore({ local, session }).save({ accessToken, refreshToken, userId: uid, apiBase, user });
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
    await session.remove('accessToken');
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
  if (stored.accessToken) {
    const cur = (await session.get('accessToken')) || {};
    if (!cur.accessToken) await session.set({ accessToken: stored.accessToken });
    await local.remove('accessToken');
  }
  return { userId: sessionUserId, apiBase: sessionApiBase };
}
