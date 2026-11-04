/**
 * What an error report may say about where it happened (1.22.4, the Error log). The server owns this
 * file; the website keeps an identical copy (src/lib/error-redact.ts, checked by a drift test), so the
 * page reduces a report before sending it and the server reduces it again before keeping it.
 *
 * Kept: the page's route as a pattern, the error's text with addresses shortened. Never kept: query
 * strings and hashes (they carry reset, welcome and sign-in tokens), client share links, anything
 * token-like, email addresses. No look-behind and no Unicode property escapes in these patterns: an
 * older Safari can't even read such a pattern, and the website loads this file on every page.
 */

/** Paths whose next segment is a secret: a client's share link, and reset / welcome / sign-in links. */
const SECRET_PREFIXES = new Set(['client', 'reset', 'welcome', 'login']);

/** A path segment that looks like an id or a token (file names, with a dot, are not). */
function tokenLike(segment: string): boolean {
  if (segment.includes('.')) return false;
  if (segment.length >= 20) return true;
  return segment.length >= 12 && /\d/.test(segment) && /[a-z]/i.test(segment);
}

/**
 * The page's address as a pattern: no query string or hash, `/client/:token` for a client's share
 * link (and nothing after it), `/reset/:token` and the like, `:id` for id- and token-like segments.
 */
export function pagePattern(address: string): string {
  let path = (address || '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
  path = path.split(/[?#]/)[0] ?? '';
  if (!path.startsWith('/') || /\s/.test(path)) return '/';
  const segments = path.split('/').filter(Boolean);
  const first = segments[0];
  if (first && SECRET_PREFIXES.has(first.toLowerCase()) && segments.length > 1) {
    return `/${first}/:token`;
  }
  return `/${segments.map((s) => (tokenLike(s) ? ':id' : s)).join('/')}`;
}

/** Long runs of letters, digits, - and _ that mix letters and digits: keys, hashes, tokens. */
const LONG_RUN = /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{32,})(?=$|[^A-Za-z0-9_-])/g;
const mixed = (s: string) => /\d/.test(s) && /[a-z]/i.test(s);

/**
 * An error's message or stack with its secrets taken out: addresses lose their query and hash (the
 * site's own secret paths become patterns), bearer tokens, JWTs and long keys become `[token]`,
 * email addresses `[email]`, data: addresses only say their type. At most `max` characters.
 */
export function redactText(text: string, max = 4096): string {
  // Only a little more than is kept is looked at; every repeat below is bounded and most patterns
  // may only start where a run of their characters starts, so hostile text stays fast.
  let out = String(text ?? '').slice(0, Math.ceil(max * 1.25) + 64);
  if (out.includes('data:')) out = out.replace(/\bdata:([a-z]{1,40}\/[a-z0-9.+-]{1,80})[;,][^\s'")]{0,20000}/gi, 'data:$1;…');
  if (/bearer/i.test(out)) out = out.replace(/\bBearer\s{1,10}[^\s'",]{1,4096}/gi, 'Bearer [token]');
  if (out.includes('eyJ')) out = out.replace(/(^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{1,4096}\.[A-Za-z0-9_-]{1,4096}\.[A-Za-z0-9_-]{1,4096}/g, '$1[token]');
  // Addresses (full or site-relative): drop the query and the hash — but not a stack frame's :line:column.
  if (/[?#]/.test(out)) {
    out = out.replace(/(https?:\/\/[^\s'"()<>?#]{1,2048}|(?:^|[\s'"(=])\/[^\s'"()<>?#]{0,2048})([?#][^\s'"()<>]{0,4096})/g, (_m, address: string, rest: string) => {
      return address + (/(?::\d{1,9}){1,2}$/.exec(rest)?.[0] ?? '');
    });
  }
  // The site's own secret paths, wherever they appear.
  if (/\/(client|reset|welcome|login)\//i.test(out)) {
    out = out.replace(/\/client\/[^\s/'"()<>?#]{1,2048}(?:\/[^\s'"()<>?#]{0,2048})?/gi, '/client/:token');
    out = out.replace(/\/(reset|welcome|login)\/[^\s/'"()<>?#]{1,2048}/gi, '/$1/:token');
  }
  out = out.replace(LONG_RUN, (whole, before: string, run: string) => (mixed(run) ? `${before}[token]` : whole));
  if (out.includes('@')) {
    out = out.replace(/(^|[^A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g, '$1[email]');
  }
  return out.slice(0, max);
}

/**
 * A message as the error log groups it: ids and numbers normalised, so "Task 12 not found" and
 * "Task 98 not found" are one error. At most 300 characters.
 */
export function normalizeMessage(message: string): string {
  return String(message ?? '')
    .slice(0, 2000)
    .replace(/[A-Za-z0-9_-]{12,}/g, (run) => (mixed(run) ? ':id' : run))
    .replace(/\d+/g, '0')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Code from a browser extension (not the site's): never reported. */
export function isExtensionSource(source: string | null | undefined): boolean {
  return /\b(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i.test(source ?? '');
}
