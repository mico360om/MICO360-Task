// Extension session/auth helpers. The extension keeps the user signed in by
// silently refreshing the access token with the stored refresh token, so a
// 30-day refresh token means a 30-day session with no repeated logins.

/** Requests abort after this long so the popup never hangs on a slow/unreachable backend. */
export const REQUEST_TIMEOUT_MS = 6000;

/** An AbortSignal that fires after `ms` (when supported), else undefined. */
function timeoutSignal(ms = REQUEST_TIMEOUT_MS) {
  try {
    return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
  } catch {
    return undefined;
  }
}

/** Read the stored tokens from chrome.storage.local. */
export async function getTokens(storage) {
  const { accessToken, refreshToken } = await storage.get(['accessToken', 'refreshToken']);
  return { accessToken: accessToken ?? null, refreshToken: refreshToken ?? null };
}

/**
 * Exchange the stored refresh token for a fresh session and persist the rotated
 * tokens. Returns the new access token, or null if there's no refresh token or
 * the refresh failed (→ the user must sign in again on the web app).
 */
export async function refreshSession(storage, apiBase, fetchImpl = fetch) {
  const { refreshToken } = await getTokens(storage);
  if (!refreshToken) return null;
  try {
    const res = await fetchImpl(`${apiBase}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: timeoutSignal(),
    });
    if (!res.ok) return null;
    const session = (await res.json()).data;
    if (!session?.accessToken) return null;
    await storage.set({
      accessToken: session.accessToken,
      ...(session.refreshToken ? { refreshToken: session.refreshToken } : {}),
    });
    return session.accessToken;
  } catch {
    return null;
  }
}

/**
 * Authenticated fetch that transparently refreshes + retries once on a 401, so an
 * expired access token doesn't sign the user out while the refresh token is valid.
 */
export async function authedFetch(storage, apiBase, path, opts = {}, fetchImpl = fetch) {
  const build = (token) =>
    fetchImpl(`${apiBase}${path}`, {
      signal: timeoutSignal(),
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  const { accessToken } = await getTokens(storage);
  let res = await build(accessToken);
  if (res.status === 401) {
    const fresh = await refreshSession(storage, apiBase, fetchImpl);
    if (fresh) res = await build(fresh);
  }
  return res;
}
