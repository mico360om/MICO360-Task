/**
 * 1.23.2 — a steady connection pool. Without `connection_limit` in DATABASE_URL, Prisma opens up to
 * (CPUs × 2 + 1) connections; on shared hosting that can pass the host's connections-per-user limit, and
 * the database then refuses connections (P1001 "Can't reach database server"). A URL without one gets
 * connection_limit=10 (and pool_timeout=20, unless set). A value already in the URL is never changed.
 * Text in, text out: the URL is never parsed apart, printed or logged (its password stays as written).
 */
export const DEFAULT_CONNECTION_LIMIT = 10;
export const DEFAULT_POOL_TIMEOUT = 20;

const queryOf = (url: string) => {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(q + 1).split('#')[0]! : '';
};

/** DATABASE_URL with the pool's defaults added where it has none. */
export function withPoolDefaults(url: string | undefined): string | undefined {
  if (!url) return url;
  const params = new URLSearchParams(queryOf(url));
  if (params.has('connection_limit')) return url;
  const add = [`connection_limit=${DEFAULT_CONNECTION_LIMIT}`, ...(params.has('pool_timeout') ? [] : [`pool_timeout=${DEFAULT_POOL_TIMEOUT}`])].join('&');
  if (!url.includes('?')) return `${url}?${add}`;
  return url.endsWith('?') || url.endsWith('&') ? `${url}${add}` : `${url}&${add}`;
}

/** The pool size a URL asks for (its connection_limit), or null. */
export function poolSizeOf(url: string | undefined): number | null {
  if (!url) return null;
  const n = Number(new URLSearchParams(queryOf(url)).get('connection_limit'));
  return Number.isInteger(n) && n > 0 ? n : null;
}
