// Minimal, dependency-free JWT payload reader. The extension never verifies the
// signature (the backend does that on every request) — it only needs the caller's
// own user id from the access token to support "assign to me".

/** Base64url-decode a string to UTF-8 (`atob` is there in Chrome, its service worker and Node 16+). */
function base64UrlDecode(part) {
  let s = String(part).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
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

/** The token's claims object, or null if it can't be read. */
function decodeClaims(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/** Return the `sub` (subject = user id) claim of a JWT, or null if it can't be read. */
export function decodeJwtSub(token) {
  const claims = decodeClaims(token);
  return claims && typeof claims.sub === 'string' ? claims.sub : null;
}

/**
 * The caller's role names (e.g. ['ADMIN']) — only to decide which screens to offer; the server
 * checks the role on every request.
 */
export function decodeJwtRoles(token) {
  const roles = decodeClaims(token)?.roles;
  return Array.isArray(roles) ? roles.filter((r) => typeof r === 'string') : [];
}
