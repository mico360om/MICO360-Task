// Minimal, dependency-free JWT payload reader. The extension never verifies the
// signature (the backend does that on every request) — it only needs the caller's
// own user id from the access token to support "assign to me".

/** Base64url-decode a string to UTF-8 (browser + test environments). */
function base64UrlDecode(part) {
  let s = String(part).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
  try {
    // Recover UTF-8 (usernames/ids are ASCII in practice, but be safe).
    return decodeURIComponent(
      bin
        .split('')
        .map((ch) => '%' + ch.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
  } catch {
    return bin;
  }
}

/** Return the `sub` (subject = user id) claim of a JWT, or null if it can't be read. */
export function decodeJwtSub(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return payload && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
