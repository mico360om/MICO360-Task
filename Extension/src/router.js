/**
 * Tiny hash router for the extension app (works on the chrome-extension:// origin, unlike a
 * history/BrowserRouter). Routes are `{ name, pattern, ... }`; `matchRoute` resolves a hash path to
 * a route + params. Pure matching logic (unit-tested); the DOM wiring lives in app.js.
 */

/** '#/board/p1?tab=team' -> { path: '/board/p1', query: { tab: 'team' } }. */
export function parseHash(hash) {
  const raw = (hash || '').replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const query = {};
  if (qs) {
    for (const pair of qs.split('&')) {
      if (!pair) continue;
      const [k, v] = pair.split('=');
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
  }
  return { path: path || '/', query };
}

function matchPattern(pattern, path) {
  const pp = pattern.split('/').filter(Boolean);
  const cp = path.split('/').filter(Boolean);
  if (pp.length !== cp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i += 1) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(cp[i]);
    else if (pp[i] !== cp[i]) return null;
  }
  return params;
}

/** First route whose pattern matches `path`; returns { route, params } or null. */
export function matchRoute(routes, path) {
  for (const route of routes) {
    const params = matchPattern(route.pattern, path);
    if (params) return { route, params };
  }
  return null;
}

/** Build a hash href from a path (+ optional query object). */
export function href(path, query) {
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  return `#${path}${qs ? `?${qs}` : ''}`;
}
