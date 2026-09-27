/** Production API/app URLs. A different server can be chosen on the login screen ("Advanced") or in Settings. */
export const DEFAULTS = { apiBase: 'https://task.mico360.com/api/v1', appBase: 'https://task.mico360.com' };

/** Company time zone used until GET /config answers (the server is the source of truth). */
export const DEFAULT_TIME_ZONE = 'Asia/Muscat';

/** Origins covered by the manifest's `host_permissions`; any other API host needs a runtime grant. */
export const BUILT_IN_ORIGINS = ['https://task.mico360.com'];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLocalHost(hostname) {
  return LOCAL_HOSTS.has(String(hostname || '').toLowerCase());
}

/**
 * This machine, or an address that only exists inside a private network: 10/8, 172.16/12,
 * 192.168/16, 127/8, or an mDNS `.local` name. A self-hosted Windows server is reached this way.
 */
export function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (isLocalHost(h) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(h)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Validate a server URL typed by the user. Only https is accepted, except plain http to this
 * machine or a private office-network address (a self-hosted server) — tokens and passwords must
 * never cross the internet in clear text or go to a host the user did not mean. Returns
 * `{ ok: true, url }` with the URL normalized (no trailing slash, no query/hash) or `{ ok: false, error }`.
 */
export function checkBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { ok: false, error: 'Enter a server address.' };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: 'That is not a valid address (it should start with https://).' };
  }
  if (u.username || u.password) return { ok: false, error: 'The address must not contain a user name or password.' };
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isPrivateHost(u.hostname))) {
    return { ok: false, error: 'Use a secure https:// address (http is only allowed for this computer or an office-network server).' };
  }
  const path = u.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${u.origin}${path}` };
}

/**
 * Resolve the configured API/app bases. Missing, blank or unsafe stored values fall back to the
 * production defaults, so a bad value can never route tokens to an insecure host.
 */
export function resolveBases(stored = {}) {
  const pick = (v, d) => {
    const c = checkBaseUrl(v);
    return c.ok ? c.url : d;
  };
  return {
    apiBase: pick(stored.apiBase, DEFAULTS.apiBase),
    appBase: pick(stored.appBase, DEFAULTS.appBase),
  };
}

/** The origin (scheme://host:port) of a URL, or null when it can't be parsed. */
export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Whether two URLs point at the same host (same origin). */
export function sameOrigin(a, b) {
  const oa = originOf(a);
  return oa !== null && oa === originOf(b);
}

/**
 * Turn the login screen's single "Server" field into API + web-app bases. Accepts either the site
 * (https://tasks.example.com) or the API base (https://tasks.example.com/api/v1).
 */
export function basesFromServer(input) {
  const c = checkBaseUrl(input);
  if (!c.ok) return c;
  if (/\/api\/v\d+$/.test(c.url)) return { ok: true, apiBase: c.url, appBase: c.url.replace(/\/api\/v\d+$/, '') };
  return { ok: true, apiBase: `${c.url}/api/v1`, appBase: c.url };
}

/** Host-permission match patterns to request at runtime before talking to `apiBase` (none for production). */
export function runtimeOriginsFor(apiBase) {
  const o = originOf(apiBase);
  if (!o || BUILT_IN_ORIGINS.includes(o)) return [];
  const u = new URL(o);
  // Match patterns ignore the port, so localhost:4000 is covered by http://localhost/*.
  return [`${u.protocol}//${u.hostname}/*`];
}

/** A usable IANA time zone name, or the company default. */
export function safeTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
