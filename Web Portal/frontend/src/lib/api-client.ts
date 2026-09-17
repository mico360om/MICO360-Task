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
  getToken: () => string | null;
  /** Attempt to refresh the access token after a 401; resolves true if it succeeded. */
  refreshTokens?: () => Promise<boolean>;
  /** Called when a request stays 401 after a failed/absent refresh — the app should log out. */
  onUnauthorized?: () => void;
}

export interface ApiClient {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  del<T = unknown>(path: string): Promise<T>;
  /** POST multipart form data (e.g. file uploads); the browser sets the boundary. */
  upload<T = unknown>(path: string, form: FormData): Promise<T>;
  /** GET a raw text body (e.g. a CSV export) with auth attached. */
  getText(path: string): Promise<string>;
  /** GET a binary body (e.g. an Excel or PDF export) as a Blob, with auth attached. */
  getBlob(path: string): Promise<Blob>;
}

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
    /* non-JSON error body */
  }
  return new ApiError(status, code, message, details);
}

export function createApiClient({ baseUrl, getToken, refreshTokens, onUnauthorized }: ApiClientOptions): ApiClient {
  // Single-flight token refresh: parallel 401s share one refresh instead of stampeding /auth/refresh.
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

  function doFetch(method: string, path: string, opts: { body?: unknown; form?: FormData }): Promise<Response> {
    const headers: Record<string, string> = {};
    // Only declare a JSON content-type when we actually send a JSON body — a bodyless POST
    // (e.g. watch / mark-all-read / provider sync) with an empty body + this header is rejected
    // by Fastify ("Body cannot be empty when content-type is set to 'application/json'").
    if (!opts.form && opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  }

  /** Fetch with automatic token refresh + retry on a 401 (except for auth endpoints). */
  async function authedFetch(method: string, path: string, opts: { body?: unknown; form?: FormData } = {}): Promise<Response> {
    // A failed login/OTP/refresh is not a token-expiry — never trigger a refresh for those.
    const canRefresh = !path.startsWith('/auth/');
    let res = await doFetch(method, path, opts);
    if (res.status === 401 && canRefresh) {
      const refreshed = await refreshOnce();
      if (refreshed) res = await doFetch(method, path, opts);
      if (res.status === 401) onUnauthorized?.();
    }
    return res;
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await authedFetch(method, path, { body });
    const text = await res.text();
    if (!res.ok) throw errorFrom(res.status, text);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async function upload<T>(path: string, form: FormData): Promise<T> {
    const res = await authedFetch('POST', path, { form });
    const text = await res.text();
    if (!res.ok) throw errorFrom(res.status, text);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async function getText(path: string): Promise<string> {
    const res = await authedFetch('GET', path);
    const text = await res.text();
    if (!res.ok) throw errorFrom(res.status, text);
    return text;
  }

  async function getBlob(path: string): Promise<Blob> {
    const res = await authedFetch('GET', path);
    if (!res.ok) throw errorFrom(res.status, await res.text());
    return res.blob();
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: (path) => request('DELETE', path),
    upload,
    getText,
    getBlob,
  };
}
