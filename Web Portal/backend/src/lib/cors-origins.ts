/**
 * CORS origins from CORS_ORIGINS. Besides exact origins, an entry of the form `<scheme>://*`
 * allows every origin of that scheme — used for `chrome-extension://*` on self-hosted servers,
 * where the extension's id isn't known in advance. The API authenticates with bearer tokens, not
 * cookies, so an allowed origin gains nothing without a user's token. Any other `*` (a bare `*`
 * or a host pattern) is ignored rather than widened.
 */

export type CorsOriginMatcher = (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => void;

/** Split a comma-separated CORS_ORIGINS value. */
export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const SCHEME_WILDCARD = /^([a-z][a-z0-9+.-]*):\/\/\*$/i;

/** The `origin` option for @fastify/cors and socket.io: the list itself, or a matcher when it has scheme wildcards. */
export function corsOrigin(origins: string[]): string[] | CorsOriginMatcher {
  const schemes = origins.map((o) => SCHEME_WILDCARD.exec(o)?.[1]?.toLowerCase()).filter((s): s is string => !!s);
  if (schemes.length === 0) return origins;
  const exact = new Set(origins.filter((o) => !o.includes('*')));
  return (origin, cb) => {
    if (!origin) return cb(null, true);
    if (exact.has(origin)) return cb(null, true);
    const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(origin)?.[1]?.toLowerCase();
    cb(null, !!scheme && schemes.includes(scheme));
  };
}
