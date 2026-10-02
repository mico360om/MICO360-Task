export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * The request never produced an HTTP response: no connection, DNS failure, a timeout, or a session
 * refresh that could not reach the server. Callers treat this as "offline / try again later" —
 * reads may fall back to cached data and writes may be queued — never as a server rejection.
 */
export class NetworkError extends Error {
  readonly timedOut: boolean;
  constructor(message: string, opts: { timedOut?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = 'NetworkError';
    this.timedOut = opts.timedOut ?? false;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

/** True for a failure that means "no usable answer from the server" (offline, timeout). */
export function isNetworkError(error: unknown): boolean {
  return error instanceof NetworkError || (error as { name?: unknown } | null)?.name === 'NetworkError';
}

/**
 * Outcome of a session refresh:
 * - `ok`: new tokens stored — retry the request;
 * - `invalid`: the server really rejected the refresh token (401/400) — the session is over;
 * - `transient`: offline, timeout, 5xx or 429 — the session may still be fine, so do NOT log out.
 */
export type RefreshOutcome = 'ok' | 'invalid' | 'transient';

/** Default per-request timeout: a hung connection must not leave a spinner (or a sign-out) forever. */
export const DEFAULT_TIMEOUT_MS = 20_000;

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current access token (or null). May be async (SecureStore). */
  getToken: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
  /**
   * Attempt to refresh the access token after a 401. Resolve `'ok'` on success, `'invalid'` only
   * when /auth/refresh itself answered 401/400, and `'transient'` for anything else. A boolean is
   * accepted for backwards compatibility (`true` = ok, `false` = invalid).
   */
  refreshTokens?: () => Promise<RefreshOutcome | boolean>;
  /** Called when a request is 401 and the session is definitively over — the app signs out. */
  onUnauthorized?: () => void | Promise<void>;
  /** Called whenever the server answered (any HTTP status) — used to flush the offline queue. */
  onReachable?: () => void;
  /** Per-request timeout in ms (default 20 s). */
  timeoutMs?: number;
}

export interface RequestOptions {
  /** Extra request headers, e.g. `Idempotency-Key`. */
  headers?: Record<string, string>;
}

export interface ApiClient {
  get<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  del<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  /** POST a multipart form (file uploads); the platform sets the multipart boundary. */
  upload<T = unknown>(path: string, form: FormData, opts?: RequestOptions): Promise<T>;
  /** Run (or join) the single-flight session refresh — used by sockets after an auth rejection. */
  refreshSession(): Promise<RefreshOutcome>;
}

function normalizeOutcome(v: RefreshOutcome | boolean): RefreshOutcome {
  if (v === true) return 'ok';
  if (v === false) return 'invalid';
  return v;
}

/** Typed API client for the MICO360 API (JSON envelope, header Bearer auth) — mirrors the web client. */
export function createApiClient({
  baseUrl,
  getToken,
  fetchImpl,
  refreshTokens,
  onUnauthorized,
  onReachable,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ApiClientOptions): ApiClient {
  const doFetch = fetchImpl ?? fetch;

  // Single-flight refresh: N parallel 401s share ONE /auth/refresh. The server single-uses
  // refresh tokens, so N rotating refreshes would revoke every result but the last.
  let refreshing: Promise<RefreshOutcome> | null = null;
  function refreshOnce(): Promise<RefreshOutcome> {
    if (!refreshTokens) return Promise.resolve('invalid');
    if (!refreshing) {
      refreshing = refreshTokens()
        .then(normalizeOutcome, () => 'transient' as const)
        .finally(() => {
          refreshing = null;
        });
    }
    return refreshing;
  }

  /** Build an ApiError from any error body — a proxy/CDN HTML page must not become a SyntaxError. */
  function errorFrom(status: number, text: string): ApiError {
    let code = 'ERROR';
    let message = `Request failed (${status})`;
    let details: unknown;
    try {
      const err = (JSON.parse(text) as { error?: { code?: string; message?: string; details?: unknown } }).error;
      if (err) {
        code = err.code ?? code;
        message = err.message ?? message;
        details = err.details;
      }
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    return new ApiError(status, code, message, details);
  }

  /** One HTTP exchange — headers AND body — bounded by the timeout. */
  async function send(
    method: string,
    path: string,
    body: unknown,
    extraHeaders?: Record<string, string>,
    form?: FormData,
  ): Promise<{ status: number; ok: boolean; text: string }> {
    const headers: Record<string, string> = { ...(extraHeaders ?? {}) };
    // Only declare a JSON content-type when there is a JSON body — Fastify rejects an empty body
    // under application/json ("Body cannot be empty…"), which broke every bodyless call
    // (mark-read, mark-all-read, watch). Mirrors the web client's fix. A multipart form gets its
    // content type (with the boundary) from the platform.
    if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
    // Uploads may be several MB on a slow phone connection: allow longer than an ordinary request.
    const limitMs = form ? Math.max(timeoutMs, 120_000) : timeoutMs;
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timedOut = false;
    const timer = controller
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, limitMs)
      : null;
    let result: { status: number; ok: boolean; text: string };
    try {
      const res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
        ...(controller ? { signal: controller.signal } : {}),
      });
      result = { status: res.status, ok: res.ok, text: await res.text() };
    } catch (e) {
      throw new NetworkError(timedOut ? 'The server took too long to respond.' : 'Network request failed.', {
        timedOut,
        cause: e,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    try {
      onReachable?.();
    } catch {
      /* a listener must never turn a good response into a failure */
    }
    return result;
  }

  async function request<T>(method: string, path: string, body?: unknown, opts?: RequestOptions, form?: FormData): Promise<T> {
    // A failed login/OTP/reset/refresh is not a token-expiry — never trigger a refresh for /auth/*.
    const canRefresh = !path.startsWith('/auth/');

    let res = await send(method, path, body, opts?.headers, form);

    if (res.status === 401 && canRefresh) {
      const outcome = await refreshOnce();
      if (outcome === 'ok') {
        res = await send(method, path, body, opts?.headers, form); // retry once with the new token
        if (res.status === 401) await onUnauthorized?.();
      } else if (outcome === 'invalid') {
        await onUnauthorized?.();
      } else {
        // Could not reach /auth/refresh (offline, 5xx, 429): the session may be fine — keep it and
        // report the request as a network failure so reads use the cache and writes are queued.
        throw new NetworkError('Could not renew the session — check your connection.');
      }
    }

    if (!res.ok) throw errorFrom(res.status, res.text);
    return (res.text ? JSON.parse(res.text) : {}) as T;
  }

  return {
    get: (path, opts) => request('GET', path, undefined, opts),
    post: (path, body, opts) => request('POST', path, body, opts),
    put: (path, body, opts) => request('PUT', path, body, opts),
    patch: (path, body, opts) => request('PATCH', path, body, opts),
    del: (path, opts) => request('DELETE', path, undefined, opts),
    upload: (path, form, opts) => request('POST', path, undefined, opts, form),
    refreshSession: () => refreshOnce(),
  };
}

/**
 * Classify a failed /auth/refresh HTTP status. Only a real rejection of the token (401/400) ends
 * the session; 429 (rate limited), 5xx and anything unexpected are transient.
 */
export function classifyRefreshStatus(status: number): RefreshOutcome {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 400) return 'invalid';
  return 'transient';
}
