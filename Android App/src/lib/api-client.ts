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

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current access token (or null). May be async (SecureStore). */
  getToken: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
  /** Attempt to refresh the access token after a 401; resolves true if it succeeded. */
  refreshTokens?: () => Promise<boolean>;
  /** Called when a request is 401 and cannot be recovered (no/failed refresh) — the app logs out. */
  onUnauthorized?: () => void | Promise<void>;
}

export interface ApiClient {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  del<T = unknown>(path: string): Promise<T>;
}

/** Typed API client for the MICO360 API (JSON envelope, header Bearer auth) — mirrors the web client. */
export function createApiClient({ baseUrl, getToken, fetchImpl, refreshTokens, onUnauthorized }: ApiClientOptions): ApiClient {
  const doFetch = fetchImpl ?? fetch;

  // Single-flight refresh: N parallel 401s share ONE /auth/refresh. The server single-uses
  // refresh tokens, so N rotating refreshes would revoke every result but the last.
  let refreshing: Promise<boolean> | null = null;
  function refreshOnce(): Promise<boolean> {
    if (!refreshTokens) return Promise.resolve(false);
    if (!refreshing) {
      refreshing = refreshTokens().finally(() => {
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

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    // Only declare a JSON content-type when there is a JSON body — Fastify rejects an empty body
    // under application/json ("Body cannot be empty…"), which broke every bodyless call
    // (mark-read, mark-all-read, watch). Mirrors the web client's fix.
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return doFetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // A failed login/OTP/reset/refresh is not a token-expiry — never trigger a refresh for /auth/*.
    const canRefresh = !path.startsWith('/auth/');

    let res = await send(method, path, body);

    if (res.status === 401 && canRefresh) {
      const refreshed = await refreshOnce();
      if (refreshed) {
        res = await send(method, path, body); // retry once with the new token
      }
      if (res.status === 401) {
        await onUnauthorized?.();
      }
    }

    const text = await res.text();
    if (!res.ok) throw errorFrom(res.status, text);
    return (text ? JSON.parse(text) : {}) as T;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: (path) => request('DELETE', path),
  };
}
