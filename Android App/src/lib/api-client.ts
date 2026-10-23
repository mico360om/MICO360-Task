import { assertAllowedUrl } from './server-address';
import { isSession } from './session-store';
import type { Session } from './types';

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
  /**
   * The request may have reached the server before its answer was lost (final review A1): it timed
   * out, or its connection dropped while it was on its way — over a connection that was working a
   * moment before (WORKING_CONNECTION_MS). False when it can't have: no connection at all, a Wi-Fi
   * sign-in page instead of the server, a session that couldn't be renewed (its 401 saved nothing).
   */
  readonly mayHaveArrived: boolean;
  constructor(message: string, opts: { timedOut?: boolean; mayHaveArrived?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = 'NetworkError';
    this.timedOut = opts.timedOut ?? false;
    this.mayHaveArrived = opts.mayHaveArrived ?? this.timedOut;
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
 * - `invalid`: the server really rejected the refresh token (401/400), or the account is no longer
 *   active (our server's 403 ACCOUNT_INACTIVE) — the session is over;
 * - `transient`: offline, timeout, 5xx, 429, a 403 from something in front of the server (a firewall
 *   page) or a reply that isn't a session — the session may still be fine, so do NOT log out;
 * - `changed`: someone else signed in on this phone while it was on its way — the request is not
 *   tried with their session, and nobody is signed out (6a review).
 */
export type RefreshOutcome = 'ok' | 'invalid' | 'transient' | 'changed';

/** A request stopped because the phone now holds someone else's session (never sent with it). */
export function sessionChangedError(): ApiError {
  return new ApiError(401, 'SESSION_CHANGED', 'You’re signed in as someone else now, so this wasn’t sent.');
}

/** Default per-request timeout: a hung connection must not leave a spinner (or a sign-out) forever. */
export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * A request sent this soon after the server answered — with no request failing to connect since —
 * went over a connection that was working: when it then fails without an answer, it may have
 * reached the server first (NetworkError mayHaveArrived). One sent with no answer yet in this run,
 * after a try that couldn't connect, or long after the last answer most likely never left the phone.
 */
export const WORKING_CONNECTION_MS = 60_000;

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current access token (or null). May be async (SecureStore). */
  getToken: () => string | null | Promise<string | null>;
  /**
   * Whose session the phone holds now (the user id, or null). A request remembers whose session it
   * was sent with, and a 401 is renewed only for that person (5b review): once someone else is
   * signed in, it fails with SESSION_CHANGED and is never sent with their session.
   */
  getUserId?: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
  /**
   * Attempt to refresh the access token after a 401. Resolve `'ok'` on success, `'invalid'` only
   * when /auth/refresh itself answered 401/400 or ACCOUNT_INACTIVE, and `'transient'` for anything else. A boolean is
   * accepted for backwards compatibility (`true` = ok, `false` = invalid).
   */
  refreshTokens?: () => Promise<RefreshOutcome | boolean>;
  /** Called when a request is 401 and the session is definitively over — the app signs out. */
  onUnauthorized?: () => void | Promise<void>;
  /** Called whenever the server answered (any HTTP status) — used to flush the offline queue. */
  onReachable?: () => void;
  /**
   * Called when a request got no answer at all (no connection). A time-out isn't counted: the
   * server may only be slow.
   */
  onUnreachable?: () => void;
  /** Per-request timeout in ms (default 20 s). */
  timeoutMs?: number;
  /** XMLHttpRequest for uploads that report progress (injectable for tests; fetch can't report it). */
  xhrImpl?: typeof XMLHttpRequest;
  /** Sent with every request: which app version is talking (see app-version versionHeaders). */
  appHeaders?: Record<string, string>;
  /** The clock (tests). */
  now?: () => number;
}

export interface RequestOptions {
  /** Extra request headers, e.g. `Idempotency-Key`. */
  headers?: Record<string, string>;
  /** Uploads: hear how much has been sent so far (0–1). */
  onProgress?: (fraction: number) => void;
  /**
   * This request's own time limit in ms, instead of the client's — for the few that the server
   * itself may take minutes to answer (the AI helpers wait for a model that is still loading).
   */
  timeoutMs?: number;
  /** The person this request is for (forUser): not sent at all while anyone else is signed in. */
  asUser?: string;
  /**
   * Its caller calling it off (a list read TanStack cancels — final review A2): the download stops,
   * and it fails as an AbortError — never as a lost connection (nothing is kept or counted offline).
   */
  signal?: AbortSignal;
}

/** A request its caller called off (RequestOptions signal). */
function calledOffError(cause?: unknown): Error {
  const e = new Error('The request was called off.');
  e.name = 'AbortError';
  if (cause !== undefined) (e as { cause?: unknown }).cause = cause;
  return e;
}

export interface ApiClient {
  get<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  del<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  /** POST a multipart form (file uploads); the platform sets the multipart boundary. */
  upload<T = unknown>(path: string, form: FormData, opts?: RequestOptions): Promise<T>;
  /**
   * Run (or join) the single-flight session refresh — used by sockets and exports after an auth
   * rejection. `expectedUserId`: the person it is for; 'changed' when someone else is signed in
   * before or after it (5b review), so their session is never used for it.
   */
  refreshSession(expectedUserId?: string | null): Promise<RefreshOutcome>;
  /**
   * The same client for one person's requests (the offline queue replays a person's changes):
   * each is sent only while that person is signed in, and renewed only for them (5b review).
   */
  forUser(userId: string): ApiClient;
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
  getUserId,
  fetchImpl,
  refreshTokens,
  onUnauthorized,
  onReachable,
  onUnreachable,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  xhrImpl,
  appHeaders,
  now: clock = Date.now,
}: ApiClientOptions): ApiClient {
  const doFetch = fetchImpl ?? fetch;
  const Xhr = xhrImpl ?? (typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest : undefined);
  /** Tell a listener; a listener must never turn a good response into a failure (or change an error). */
  const notify = (listener: (() => void) | undefined) => {
    try {
      listener?.();
    } catch {
      /* ignored */
    }
  };

  /** When the server last answered — null before its first answer and after a request that couldn't connect. */
  let answeredAt: number | null = null;
  const answered = () => {
    answeredAt = clock();
    notify(onReachable);
  };
  const noConnection = () => {
    answeredAt = null;
    notify(onUnreachable);
  };
  /** Does a request going now go over a connection that was working (WORKING_CONNECTION_MS)? */
  const connectionWorking = () => answeredAt !== null && clock() - answeredAt <= WORKING_CONNECTION_MS;

  /** A multipart POST over XMLHttpRequest, reporting progress — same timeout and errors as `send`. */
  function sendWithProgress(
    path: string,
    form: FormData,
    headers: Record<string, string>,
    limitMs: number,
    onProgress: (fraction: number) => void,
  ): Promise<{ status: number; ok: boolean; text: string }> {
    const working = connectionWorking();
    return new Promise((resolve, reject) => {
      const xhr = new Xhr!();
      xhr.open('POST', `${baseUrl}${path}`);
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
      xhr.timeout = limitMs;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => resolve({ status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, text: xhr.responseText });
      xhr.onerror = () => {
        noConnection();
        reject(new NetworkError('Network request failed.', { mayHaveArrived: working }));
      };
      xhr.ontimeout = () => reject(new NetworkError('The server took too long to respond.', { timedOut: true }));
      xhr.send(form);
    });
  }

  // Single-flight refresh: N parallel 401s share ONE /auth/refresh. The server single-uses
  // refresh tokens, so N rotating refreshes would revoke every result but the last. Each refresh
  // is for one person: only their requests join it (4b review #16).
  let refreshing: { promise: Promise<RefreshOutcome>; owner: string | null | undefined } | null = null;
  function sharedRefresh(owner: string | null | undefined): Promise<RefreshOutcome> {
    if (!refreshTokens) return Promise.resolve('invalid');
    if (!refreshing) {
      const promise: Promise<RefreshOutcome> = refreshTokens()
        .then(normalizeOutcome, () => 'transient' as const)
        .finally(() => {
          if (refreshing?.promise === promise) refreshing = null;
        });
      refreshing = { promise, owner };
    }
    return refreshing.promise;
  }

  /** Whose session the phone holds now (undefined: the app doesn't say — no check). */
  const holder = async (): Promise<string | null | undefined> => (getUserId ? ((await getUserId()) ?? null) : undefined);

  /**
   * The refresh for one person's request (5b review): never for someone else's session — when
   * another person is signed in before it starts, it isn't run for them; when one is by the time it
   * ends, the request isn't tried with it ('changed', nobody signed out).
   */
  async function refreshOnce(expected?: string | null): Promise<RefreshOutcome> {
    const check = !!expected && !!getUserId;
    if (check && (await holder()) !== expected) return 'changed';
    // A refresh still on its way for someone else (the person before): its end is waited for, then
    // one for this person — never its "someone else is signed in" (4b review #16).
    while (check && refreshing && refreshing.owner !== expected) {
      await refreshing.promise.catch(() => undefined);
      if ((await holder()) !== expected) return 'changed';
    }
    const outcome = await sharedRefresh(check ? expected : await holder());
    if (check && outcome === 'ok' && (await holder()) !== expected) return 'changed';
    return outcome;
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
    opts: RequestOptions | undefined,
    form?: FormData,
  ): Promise<{ status: number; ok: boolean; text: string }> {
    const extraHeaders = opts?.headers;
    const onProgress = opts?.onProgress;
    // Never send the session over plain http to the internet (only to an office-network server).
    assertAllowedUrl(`${baseUrl}${path}`);
    const headers: Record<string, string> = { ...(appHeaders ?? {}), ...(extraHeaders ?? {}) };
    // Only declare a JSON content-type when there is a JSON body — Fastify rejects an empty body
    // under application/json ("Body cannot be empty…"), which broke every bodyless call
    // (mark-read, mark-all-read, watch). Mirrors the web client's fix. A multipart form gets its
    // content type (with the boundary) from the platform.
    if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
    // Uploads may be several MB on a slow phone connection: allow longer than an ordinary request.
    // A request that names its own limit (the AI helpers) gets exactly that.
    const limitMs = opts?.timeoutMs ?? (form ? Math.max(timeoutMs, 120_000) : timeoutMs);
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    if (form && onProgress && Xhr) {
      const result = await sendWithProgress(path, form, headers, limitMs, onProgress);
      answered();
      return result;
    }

    // Whether it went over a working connection, as it goes (a failure below says so: final review A1).
    const working = connectionWorking();

    const calledOff = opts?.signal;
    if (calledOff?.aborted) throw calledOffError();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timedOut = false;
    const timer = controller
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, limitMs)
      : null;
    const stop = () => controller?.abort();
    calledOff?.addEventListener('abort', stop);
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
      if (calledOff?.aborted && !timedOut) throw calledOffError(e);
      if (!timedOut) noConnection();
      throw new NetworkError(timedOut ? 'The server took too long to respond.' : 'Network request failed.', {
        timedOut,
        mayHaveArrived: timedOut || working,
        cause: e,
      });
    } finally {
      if (timer) clearTimeout(timer);
      calledOff?.removeEventListener('abort', stop);
    }
    answered();
    return result;
  }

  async function request<T>(method: string, path: string, body?: unknown, opts?: RequestOptions, form?: FormData): Promise<T> {
    // A failed login/OTP/reset/refresh/fingerprint call is not a token-expiry — never trigger a
    // refresh for /auth/* (the fingerprint key calls carry the refresh token itself).
    const canRefresh = !path.startsWith('/auth/');

    // Whose session this goes with: one person's request (forUser) is never sent with another's.
    const now = await holder();
    if (opts?.asUser && now !== undefined && now !== opts.asUser) throw sessionChangedError();
    const sentAs = opts?.asUser ?? now ?? null;

    let res = await send(method, path, body, opts, form);

    if (res.status === 401 && canRefresh) {
      const outcome = await refreshOnce(sentAs);
      if (outcome === 'ok') {
        res = await send(method, path, body, opts, form); // retry once with the new token
        if (res.status === 401) await onUnauthorized?.();
      } else if (outcome === 'invalid') {
        await onUnauthorized?.();
      } else if (outcome === 'changed') {
        throw sessionChangedError();
      } else {
        // Could not reach /auth/refresh (offline, 5xx, 429): the session may be fine — keep it and
        // report the request as a network failure so reads use the cache and writes are queued.
        throw new NetworkError('Could not renew the session — check your connection.');
      }
    }

    if (!res.ok) throw errorFrom(res.status, res.text);
    if (!res.text) return {} as T;
    try {
      return JSON.parse(res.text) as T;
    } catch (e) {
      // A 200 that isn't our JSON is a network in the way (a Wi-Fi sign-in page): treat it as being
      // offline, so reads use the cache and writes are queued — never as a server answer.
      throw new NetworkError('The network returned a web page instead of data — you may need to sign in to the Wi-Fi.', { cause: e });
    }
  }

  function clientFor(asUser?: string): ApiClient {
    const o = (opts?: RequestOptions): RequestOptions | undefined => (asUser ? { ...opts, asUser } : opts);
    return {
      get: (path, opts) => request('GET', path, undefined, o(opts)),
      post: (path, body, opts) => request('POST', path, body, o(opts)),
      put: (path, body, opts) => request('PUT', path, body, o(opts)),
      patch: (path, body, opts) => request('PATCH', path, body, o(opts)),
      del: (path, opts) => request('DELETE', path, undefined, o(opts)),
      upload: (path, form, opts) => request('POST', path, undefined, o(opts), form),
      refreshSession: (expectedUserId) => refreshOnce(expectedUserId === undefined ? asUser : expectedUserId),
      forUser: (userId) => clientFor(userId),
    };
  }

  return clientFor();
}

/**
 * Classify a failed /auth/refresh HTTP status. Only a real rejection of the token (401/400) ends the
 * session by status alone; 429 (rate limited), 5xx and anything unexpected are transient. A 403 is
 * decided by readRefreshReply: our server's ACCOUNT_INACTIVE ends it, a firewall page in front of the
 * server doesn't.
 */
export function classifyRefreshStatus(status: number): Exclude<RefreshOutcome, 'changed'> {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 400) return 'invalid';
  return 'transient';
}

/**
 * What a /auth/refresh reply means, with the new session when there is one. A 200 that isn't a
 * real session (both tokens and the user's id) — a proxy or Wi-Fi page, a reply cut short — says
 * nothing about the session and must never replace it, so it is transient (as on the web).
 */
export async function readRefreshReply(res: {
  status: number;
  json: () => Promise<unknown>;
}): Promise<{ outcome: 'ok'; session: Session } | { outcome: 'invalid' | 'transient' }> {
  if (res.status === 403) {
    // The account was turned off (our server says so): the session won't come back by waiting.
    const code = await res.json().then((b) => (b as { error?: { code?: unknown } } | null)?.error?.code, () => undefined);
    return { outcome: code === 'ACCOUNT_INACTIVE' ? 'invalid' : 'transient' };
  }
  const outcome = classifyRefreshStatus(res.status);
  if (outcome !== 'ok') return { outcome };
  let data: unknown;
  try {
    data = ((await res.json()) as { data?: unknown } | null)?.data;
  } catch {
    return { outcome: 'transient' };
  }
  return isSession(data) ? { outcome: 'ok', session: data } : { outcome: 'transient' };
}
