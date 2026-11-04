import { fileNameFromDisposition } from './download';
import { COMPANY_HEADER, isCompanyGone } from './companies';

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
 * Result of a token refresh. `refreshed` = retry with the new token; `invalid` = the server rejected
 * the refresh token (401/400) and the session is really over; `transient` = offline, a server error
 * or rate limiting (429) — not a verdict on the session, so the user must stay signed in.
 * `true`/`false` are accepted as shorthands for `refreshed`/`invalid`.
 */
export type RefreshOutcome = 'refreshed' | 'invalid' | 'transient';

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => string | null;
  /** Attempt to refresh the access token after a 401 (given the token that was rejected). */
  refreshTokens?: (rejectedToken: string | null) => Promise<RefreshOutcome | boolean>;
  /** Called only when the refresh token itself is rejected — the app should log out. */
  onUnauthorized?: () => void;
  /**
   * Headers sent with every request, uploads and downloads too — the picked company
   * (`X-Company-Id`) while one is picked. Read again for each request.
   */
  getHeaders?: () => Record<string, string>;
  /**
   * The server refused the picked company (403 COMPANY_NOT_AVAILABLE): the request was sent once
   * more without it, and that one wasn't refused, so it was the pick. Given the headers the refused
   * request carried. The app clears the pick and says so.
   */
  onCompanyGone?: (sent: Record<string, string>) => void;
  /**
   * 1.22: a change the server refused, just before it is thrown to the caller — the app says some of
   * them across the page whatever the caller shows (an archived project's "reopen it first").
   */
  onRefused?: (err: ApiError) => void;
  /**
   * 1.22.4 (the Error log): each request's method, path, answer and time — status 0 when it never
   * reached the server — so a request blocked on the way or a slow one can be reported. Told after
   * the fact; nothing it does changes the request.
   */
  onRequestDone?: (info: { method: string; path: string; status: number; ms: number }) => void;
}

export interface RequestOptions {
  /** Extra request headers, e.g. `Idempotency-Key` on a replay-safe POST. */
  headers?: Record<string, string>;
  /** Sent as the page goes (reload, another address, the tab closing): the browser finishes it anyway. */
  keepalive?: boolean;
}

export interface ApiClient {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  del<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  /**
   * POST multipart form data (e.g. file uploads); the browser sets the boundary. With `onProgress`
   * it reports how much has been sent (0–1) as it goes.
   */
  upload<T = unknown>(path: string, form: FormData, opts?: UploadOptions): Promise<T>;
  /** GET a raw text body (e.g. a CSV export) with auth attached. */
  getText(path: string): Promise<string>;
  /** GET a binary body (e.g. an Excel or PDF export) as a Blob, with auth attached. */
  getBlob(path: string): Promise<Blob>;
}

export interface UploadOptions {
  /** Called as the body is sent, with the fraction sent so far (0–1). */
  onProgress?: (fraction: number) => void;
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

/** Is this answer the server refusing the picked company? */
async function refusesCompany(status: number, text: () => Promise<string>): Promise<boolean> {
  if (status !== 403) return false;
  return isCompanyGone(errorFrom(status, await text()));
}

export function createApiClient({ baseUrl, getToken, refreshTokens, onUnauthorized, getHeaders, onCompanyGone, onRefused, onRequestDone }: ApiClientOptions): ApiClient {
  const clock = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
  /** Tell onRequestDone how a request went (never in its way). */
  const told = (method: string, path: string, status: number, started: number) => {
    try {
      onRequestDone?.({ method, path: path.split('?')[0]!, status, ms: Math.max(0, clock() - started) });
    } catch {
      // Reporting must never change what the caller gets.
    }
  };
  /** The error to throw for a refused change, told to onRefused first (never in its way). */
  const refusal = (status: number, text: string): ApiError => {
    const err = errorFrom(status, text);
    try {
      onRefused?.(err);
    } catch {
      // Saying it across the page must never change what the caller gets.
    }
    return err;
  };
  /**
   * The headers every request carries now, and the same without the picked company — for the one
   * retry after the server refuses the pick (null: no company picked, or nobody to tell).
   */
  function sharedHeaders(): { sent: Record<string, string>; withoutPick: Record<string, string> | null } {
    const sent = getHeaders?.() ?? {};
    if (!onCompanyGone || !(COMPANY_HEADER in sent)) return { sent, withoutPick: null };
    const withoutPick = { ...sent };
    delete withoutPick[COMPANY_HEADER];
    return { sent, withoutPick };
  }

  // Single-flight token refresh: parallel 401s share one refresh instead of stampeding /auth/refresh.
  let refreshing: Promise<RefreshOutcome> | null = null;
  function refreshOnce(rejectedToken: string | null): Promise<RefreshOutcome> {
    if (!refreshTokens) return Promise.resolve('invalid');
    if (!refreshing) {
      refreshing = refreshTokens(rejectedToken)
        .then((r): RefreshOutcome => (r === true ? 'refreshed' : r === false ? 'invalid' : r))
        .catch((): RefreshOutcome => 'transient')
        .finally(() => {
          refreshing = null;
        });
    }
    return refreshing;
  }

  type FetchOpts = { body?: unknown; form?: FormData; headers?: Record<string, string>; keepalive?: boolean };

  function doFetch(method: string, path: string, opts: FetchOpts, token: string | null, shared: Record<string, string>): Promise<Response> {
    const headers: Record<string, string> = { ...shared, ...(opts.headers ?? {}) };
    // Only declare a JSON content-type when we actually send a JSON body — a bodyless POST
    // (e.g. watch / mark-all-read / provider sync) with an empty body + this header is rejected
    // by Fastify ("Body cannot be empty when content-type is set to 'application/json'").
    if (!opts.form && opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const started = clock();
    return fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      ...(opts.keepalive ? { keepalive: true } : {}),
    }).then(
      (res) => {
        told(method, path, res.status, started);
        return res;
      },
      (err: unknown) => {
        told(method, path, 0, started);
        throw err;
      },
    );
  }

  /**
   * Fetch with automatic token refresh + retry on a 401 (except for auth endpoints). Only a rejected
   * refresh token ends the session; a refresh that fails for any other reason (offline, 5xx, 429)
   * leaves the user signed in and just surfaces this request's error.
   */
  async function fetchRefreshing(method: string, path: string, opts: FetchOpts, shared: Record<string, string>): Promise<Response> {
    // A failed login/OTP/refresh is not a token-expiry — never trigger a refresh for those.
    const canRefresh = !path.startsWith('/auth/');
    const token = getToken();
    let res = await doFetch(method, path, opts, token, shared);
    if (res.status === 401 && canRefresh) {
      const outcome = await refreshOnce(token);
      if (outcome === 'refreshed') res = await doFetch(method, path, opts, getToken(), shared);
      else if (outcome === 'invalid') onUnauthorized?.();
    }
    return res;
  }

  /**
   * …and when the server refuses the picked company (taken away, archived), the request goes once
   * more without it. Only if that one isn't refused too was it the pick (a company the request names
   * itself, e.g. a picker's `companyIds`, is refused the same way) — then the app is told.
   */
  async function authedFetch(method: string, path: string, opts: FetchOpts = {}): Promise<Response> {
    const { sent, withoutPick } = sharedHeaders();
    const res = await fetchRefreshing(method, path, opts, sent);
    if (!withoutPick || !(await refusesCompany(res.status, () => res.clone().text()))) return res;
    const retry = await fetchRefreshing(method, path, opts, withoutPick);
    if (!(await refusesCompany(retry.status, () => retry.clone().text()))) onCompanyGone?.(sent);
    return retry;
  }

  async function request<T>(method: string, path: string, body?: unknown, reqOpts?: RequestOptions): Promise<T> {
    const res = await authedFetch(method, path, { body, headers: reqOpts?.headers, ...(reqOpts?.keepalive ? { keepalive: true } : {}) });
    const text = await res.text();
    if (!res.ok) throw method === 'GET' ? errorFrom(res.status, text) : refusal(res.status, text);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** One multipart POST over XMLHttpRequest — fetch can't report upload progress. */
  function sendWithProgress(path: string, form: FormData, token: string | null, onProgress: (fraction: number) => void, shared: Record<string, string>) {
    return new Promise<{ status: number; text: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${baseUrl}${path}`);
      for (const [name, value] of Object.entries(shared)) xhr.setRequestHeader(name, value);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
      };
      const started = clock();
      xhr.onload = () => {
        told('POST', path, xhr.status, started);
        resolve({ status: xhr.status, text: xhr.responseText });
      };
      // Same as a failed fetch, so callers report it as a connection problem.
      xhr.onerror = () => {
        told('POST', path, 0, started);
        reject(new TypeError('Network request failed'));
      };
      xhr.send(form);
    });
  }

  async function upload<T>(path: string, form: FormData, opts?: UploadOptions): Promise<T> {
    const onProgress = opts?.onProgress;
    if (!onProgress || typeof XMLHttpRequest === 'undefined') {
      const res = await authedFetch('POST', path, { form });
      const text = await res.text();
      if (!res.ok) throw refusal(res.status, text);
      return (text ? JSON.parse(text) : {}) as T;
    }
    // The same refresh-once-on-401 and refused-pick rules as every other request.
    const send = async (shared: Record<string, string>) => {
      const token = getToken();
      let answer = await sendWithProgress(path, form, token, onProgress, shared);
      if (answer.status === 401) {
        const outcome = await refreshOnce(token);
        if (outcome === 'refreshed') answer = await sendWithProgress(path, form, getToken(), onProgress, shared);
        else if (outcome === 'invalid') onUnauthorized?.();
      }
      return answer;
    };
    const { sent, withoutPick } = sharedHeaders();
    let res = await send(sent);
    if (withoutPick && (await refusesCompany(res.status, async () => res.text))) {
      res = await send(withoutPick);
      if (!(await refusesCompany(res.status, async () => res.text))) onCompanyGone?.(sent);
    }
    if (res.status < 200 || res.status >= 300) throw refusal(res.status, res.text);
    return (res.text ? JSON.parse(res.text) : {}) as T;
  }

  async function getText(path: string): Promise<string> {
    const res = await authedFetch('GET', path);
    const text = await res.text();
    if (!res.ok) throw errorFrom(res.status, text);
    return text;
  }

  /** A download; when the server names the file (Content-Disposition) it comes back as a File with that name. */
  async function getBlob(path: string): Promise<Blob> {
    const res = await authedFetch('GET', path);
    if (!res.ok) throw errorFrom(res.status, await res.text());
    const blob = await res.blob();
    const name = fileNameFromDisposition(res.headers.get('content-disposition'));
    return name ? new File([blob], name, { type: blob.type }) : blob;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body, opts) => request('POST', path, body, opts),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: (path, opts) => request('DELETE', path, undefined, opts),
    upload,
    getText,
    getBlob,
  };
}
