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
 * `changed` (batch 2, as on Android) = the session is no longer the one the request was sent with —
 * signed out, or someone else signed in, while it was on its way: the request is not sent again and
 * nobody is signed out. `true`/`false` are accepted as shorthands for `refreshed`/`invalid`.
 */
export type RefreshOutcome = 'refreshed' | 'invalid' | 'transient' | 'changed';

/**
 * Batch 2: a request made for one person (forUser — a replayed offline change) while someone else's
 * session, or none, is held. It is never sent; the caller keeps it for its person.
 */
export class SessionChangedError extends Error {
  constructor(message = 'Signed in as someone else: this change waits for the person who made it.') {
    super(message);
    this.name = 'SessionChangedError';
  }
}

/**
 * The person an access token was issued to (its `sub`), or null when it can't be read. Never verified —
 * the server does that on every request; it only tells whose token is about to be sent.
 */
export function tokenSubject(token: string | null | undefined): string | null {
  if (!token || typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const claims = JSON.parse(atob(b64)) as { sub?: unknown } | null;
    return claims && typeof claims.sub === 'string' && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => string | null;
  /**
   * Attempt to refresh the access token after a 401 (given the token that was rejected). With getUserId,
   * also given whose request it was: a refresh is never run, or its result used, for anyone else.
   */
  refreshTokens?: (rejectedToken: string | null, expectedUserId?: string | null) => Promise<RefreshOutcome | boolean>;
  /** Called only when the refresh token itself is rejected — the app should log out. */
  onUnauthorized?: () => void;
  /**
   * Batch 2 (as on Android): whose session the app holds now (null: nobody). With it, each request
   * remembers who sent it (`sentAs`, before its first send) and is sent again after a 401 — or without a
   * refused company pick — only while that person (and their token) is still the one held; otherwise the
   * first answer stands and nobody is signed out. Without it, the access token's own `sub` is the word.
   */
  getUserId?: () => string | null;
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
   * the fact; nothing it does changes the request. 1.23.3: with the answer's Server-Timing header when it
   * has one (the server's time and its time in the database: where a slow request's time went).
   */
  onRequestDone?: (info: RequestDone) => void;
  /**
   * 1.23.14: a mark of the page taken as each request starts (whether it is on screen — the Error log's
   * page-lifecycle), told back with the request so it can say whether the page was away meanwhile.
   */
  pageMark?: () => unknown;
  /**
   * 1.23.1: the server answered DATABASE_BUSY (503 — its database was away for a moment, a deploy
   * restart) to a read or a change — just before it is thrown to the caller; the app says so across the
   * page in the server's words.
   */
  onDatabaseBusy?: (err: ApiError) => void;
  /**
   * 1.23.23: a read (GET, HEAD) whose connection dropped on the way — the fetch failed, not an abort — is
   * tried again: up to READ_TRIES tries in all, about 400 ms and then about 1.2 s apart, only while the page
   * is on screen and the browser isn't offline. A change is never sent twice. On by default; `false` turns it
   * off; the rest is for tests.
   */
  networkRetry?: NetworkRetryOptions | false;
}

/** 1.23.23: how a dropped read is tried again (createApiClient's networkRetry). */
export interface NetworkRetryOptions {
  /** The waits before the 2nd and 3rd tries (ms), each jittered by up to a quarter either way. */
  delaysMs?: readonly number[];
  /** Whether another try may go now (default: the page is visible and the browser doesn't say it is offline). */
  allowed?: () => boolean;
  /** Waits that long (default: a timer). */
  wait?: (ms: number) => Promise<void>;
  /** 0–1, for the jitter (default Math.random). */
  random?: () => number;
}

/** 1.23.23: a dropped read is sent this many times in all (the first try and two more). */
export const READ_TRIES = 3;
/** The waits before the 2nd and 3rd tries (ms), before the jitter. */
export const NETWORK_RETRY_DELAYS_MS: readonly number[] = [400, 1200];
/** Each wait is moved by up to this share of it, either way, so many tabs don't all try again at once. */
const RETRY_JITTER = 0.25;
/**
 * A blip fails fast: a try that failed only after this long (a timeout, a long export cut on the way) isn't
 * sent again — the person would wait 3 times as long, and the server would do the work again.
 */
export const QUICK_FAILURE_MS = 5000;

/** How many tries a failed request took (the error as thrown to the caller; 0 when not known). */
const triesByError = new WeakMap<object, number>();
export function networkTries(err: unknown): number {
  return err !== null && typeof err === 'object' ? (triesByError.get(err) ?? 0) : 0;
}

/** The page is on screen and the browser doesn't say it is offline (outside a browser: yes). */
function pageMayRetry(): boolean {
  try {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    return true;
  } catch {
    return false;
  }
}

const isAbort = (err: unknown) => (err as { name?: unknown } | null)?.name === 'AbortError';

/** How one request went (onRequestDone). */
export interface RequestDone {
  method: string;
  path: string;
  status: number;
  ms: number;
  /** 1.23.3: the answer's Server-Timing ("app;dur=9912.3, db;dur=9700.1"); absent when it had none. */
  serverTiming?: string;
  /**
   * 1.23.14: the address fetched (its Resource Timing entry is named by it), when it started on the page's
   * clock (performance.now) and the wall clock, the page's mark then (pageMark), and whether it was
   * aborted on purpose (an AbortError is not "blocked on the way").
   */
  url?: string;
  startedAt?: number;
  wallStart?: number;
  mark?: unknown;
  aborted?: boolean;
  /**
   * 1.23.23: a read tried again after its connection dropped — how many tries it took (absent: one). An
   * answer is told with the start and time of the try that got it; a read that failed every try with the
   * first try's start (and status 0).
   */
  tries?: number;
}

/** The code the server answers a database blip with (lib/db-connection.ts there). */
export const DATABASE_BUSY_CODE = 'DATABASE_BUSY';

export interface RequestOptions {
  /** Extra request headers, e.g. `Idempotency-Key` on a replay-safe POST. */
  headers?: Record<string, string>;
  /** Sent as the page goes (reload, another address, the tab closing): the browser finishes it anyway. */
  keepalive?: boolean;
  /** 'include': this browser's cookies go with it, and a cookie the answer sets is kept (also across origins). */
  credentials?: RequestCredentials;
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

/** The app's client: also one bound to a person (a replayed offline change), sent only as them. */
export interface SessionApiClient extends ApiClient {
  /**
   * A client whose every request goes only while `userId` is the person signed in (and their token is the
   * one sent): otherwise it is never sent and rejects with SessionChangedError. As Android's forUser.
   */
  forUser(userId: string): ApiClient;
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

export function createApiClient({ baseUrl, getToken, refreshTokens, onUnauthorized, getUserId, getHeaders, onCompanyGone, onRefused, onRequestDone, onDatabaseBusy, pageMark, networkRetry }: ApiClientOptions): SessionApiClient {
  const clock = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
  /** 1.23.23: how a dropped read is tried again (null: never). */
  const retry =
    networkRetry === false
      ? null
      : {
          delays: networkRetry?.delaysMs ?? NETWORK_RETRY_DELAYS_MS,
          allowed: networkRetry?.allowed ?? pageMayRetry,
          wait: networkRetry?.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
          random: networkRetry?.random ?? Math.random,
        };
  /**
   * After a read's try number `tries` dropped: wait and say whether to try again — only while the page is on
   * screen and online, before the wait and after it. Never throws (a broken check is a no).
   */
  async function mayTryAgain(tries: number): Promise<boolean> {
    try {
      if (!retry || tries >= READ_TRIES || !retry.allowed()) return false;
      const base = retry.delays[Math.min(tries - 1, retry.delays.length - 1)] ?? 0;
      const r = Math.min(1, Math.max(0, Number(retry.random()) || 0));
      await retry.wait(Math.max(0, Math.round(base * (1 - RETRY_JITTER + 2 * RETRY_JITTER * r))));
      return retry.allowed();
    } catch {
      return false;
    }
  }
  /** 1.23.14: a request's start — the page's clock and the wall clock, and the page's mark (never in its way). */
  type Start = { at: number; wall: number; mark?: unknown; url: string };
  const begin = (url: string): Start => {
    const start: Start = { at: clock(), wall: Date.now(), url };
    try {
      if (pageMark) start.mark = pageMark();
    } catch {
      // Without a mark the request is told as before.
    }
    return start;
  };
  /** Tell onRequestDone how a request went (never in its way); `header` reads one of the answer's headers. */
  const told = (method: string, path: string, status: number, started: Start, header?: (name: string) => string | null, failure?: unknown, tries = 1) => {
    try {
      const info: RequestDone = { method, path: path.split('?')[0]!, status, ms: Math.max(0, clock() - started.at), url: started.url, startedAt: started.at, wallStart: started.wall };
      if (started.mark !== undefined) info.mark = started.mark;
      if (status === 0 && isAbort(failure)) info.aborted = true;
      if (tries > 1) info.tries = tries;
      try {
        const serverTiming = header?.('server-timing');
        if (serverTiming) info.serverTiming = serverTiming;
      } catch {
        // An answer whose headers can't be read is told without them.
      }
      onRequestDone?.(info);
    } catch {
      // Reporting must never change what the caller gets.
    }
  };
  /** 1.23.1: an error answer, told to onDatabaseBusy first when it is the database being away (never in its way). */
  const failure = (status: number, text: string): ApiError => {
    const err = errorFrom(status, text);
    if (err.code === DATABASE_BUSY_CODE) {
      try {
        onDatabaseBusy?.(err);
      } catch {
        // Saying it across the page must never change what the caller gets.
      }
    }
    return err;
  };
  /** The error to throw for a refused change, told to onRefused first (never in its way). */
  const refusal = (status: number, text: string): ApiError => {
    const err = failure(status, text);
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

  /**
   * Batch 2: whose session is held now — the app's word (getUserId), or, without it, the access token's own
   * `sub` — and whether a request sent as `sentAs` may go (again) now: that person is still the one held,
   * and the token that would go is theirs (a token that can't be read is left to the app's word).
   */
  const holder = (): string | null => (getUserId ? (getUserId() ?? null) : tokenSubject(getToken()));
  const stillSender = (sentAs: string | null): boolean => {
    if (holder() !== sentAs) return false;
    const sub = tokenSubject(getToken());
    return sub === null || sub === sentAs;
  };

  // Single-flight token refresh: parallel 401s share one refresh instead of stampeding /auth/refresh.
  // Each refresh is for one person: only their requests join it (as on Android).
  let refreshing: { promise: Promise<RefreshOutcome>; owner: string | null } | null = null;
  async function refreshOnce(rejectedToken: string | null, sentAs: string | null): Promise<RefreshOutcome> {
    if (!refreshTokens) return 'invalid';
    // A refresh still on its way for someone else (the person before): its end is waited for first.
    while (refreshing && refreshing.owner !== sentAs) await refreshing.promise.catch(() => undefined);
    if (!refreshing) {
      const promise: Promise<RefreshOutcome> = (getUserId ? refreshTokens(rejectedToken, sentAs) : refreshTokens(rejectedToken))
        .then((r): RefreshOutcome => (r === true ? 'refreshed' : r === false ? 'invalid' : r))
        .catch((): RefreshOutcome => 'transient')
        .finally(() => {
          if (refreshing?.promise === promise) refreshing = null;
        });
      refreshing = { promise, owner: sentAs };
    }
    return refreshing.promise;
  }

  type FetchOpts = { body?: unknown; form?: FormData; headers?: Record<string, string>; keepalive?: boolean; credentials?: RequestCredentials };

  function doFetch(method: string, path: string, opts: FetchOpts, token: string | null, shared: Record<string, string>): Promise<Response> {
    const headers: Record<string, string> = { ...shared, ...(opts.headers ?? {}) };
    // Only declare a JSON content-type when we actually send a JSON body — a bodyless POST
    // (e.g. watch / mark-all-read / provider sync) with an empty body + this header is rejected
    // by Fastify ("Body cannot be empty when content-type is set to 'application/json'").
    if (!opts.form && opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const url = `${baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      ...(opts.keepalive ? { keepalive: true } : {}),
      ...(opts.credentials ? { credentials: opts.credentials } : {}),
    };
    // 1.23.23: only a read is ever sent again when its connection drops — a change could happen twice.
    const read = method === 'GET' || method === 'HEAD';
    let first: Start | null = null;
    const attempt = (tries: number): Promise<Response> => {
      const started = begin(url);
      if (!first) first = started;
      return fetch(url, init).then(
        (res) => {
          // The try that got an answer is the one timed (its own start; the failed tries and waits aren't in it).
          told(method, path, res.status, started, (name) => res.headers.get(name), undefined, tries);
          return res;
        },
        async (err: unknown) => {
          const quick = clock() - started.at < QUICK_FAILURE_MS;
          if (read && quick && !isAbort(err) && (await mayTryAgain(tries))) return attempt(tries + 1);
          // Every try failed (or no more may go): told once, from the first try's start — the whole request.
          told(method, path, 0, first ?? started, undefined, err, tries);
          if (err !== null && typeof err === 'object') triesByError.set(err, tries);
          throw err;
        },
      );
    };
    return attempt(1);
  }

  /**
   * Fetch with automatic token refresh + retry on a 401 (except for auth endpoints). Only a rejected
   * refresh token ends the session; a refresh that fails for any other reason (offline, 5xx, 429)
   * leaves the user signed in and just surfaces this request's error. Batch 2: sent again only as the
   * person who sent it (`sentAs`): when the session changed meanwhile, the 401 stands and nobody is
   * signed out.
   */
  async function fetchRefreshing(method: string, path: string, opts: FetchOpts, shared: Record<string, string>, sentAs: string | null): Promise<Response> {
    // A failed login/OTP/refresh is not a token-expiry — never trigger a refresh for those.
    const canRefresh = !path.startsWith('/auth/');
    const token = getToken();
    let res = await doFetch(method, path, opts, token, shared);
    if (res.status === 401 && canRefresh) {
      // Signed out, or someone else signed in, while it was on its way: never renewed or sent as them.
      if (!stillSender(sentAs)) return res;
      const outcome = await refreshOnce(token, sentAs);
      if (outcome === 'refreshed') {
        if (stillSender(sentAs)) res = await doFetch(method, path, opts, getToken(), shared);
      } else if (outcome === 'invalid') onUnauthorized?.();
    }
    return res;
  }

  /**
   * …and when the server refuses the picked company (taken away, archived), the request goes once
   * more without it. Only if that one isn't refused too was it the pick (a company the request names
   * itself, e.g. a picker's `companyIds`, is refused the same way) — then the app is told.
   * `asUser` (forUser): sent only while that person is the one held — checked as it goes, nothing awaited between.
   */
  async function authedFetch(method: string, path: string, opts: FetchOpts = {}, asUser?: string): Promise<Response> {
    if (asUser !== undefined && !stillSender(asUser)) throw new SessionChangedError();
    const sentAs = asUser ?? holder();
    const { sent, withoutPick } = sharedHeaders();
    const res = await fetchRefreshing(method, path, opts, sent, sentAs);
    if (!withoutPick || !(await refusesCompany(res.status, () => res.clone().text()))) return res;
    // The same request once more, only as the same person.
    if (!stillSender(sentAs)) return res;
    const retry = await fetchRefreshing(method, path, opts, withoutPick, sentAs);
    if (!(await refusesCompany(retry.status, () => retry.clone().text()))) onCompanyGone?.(sent);
    return retry;
  }

  async function request<T>(method: string, path: string, body?: unknown, reqOpts?: RequestOptions, asUser?: string): Promise<T> {
    const res = await authedFetch(method, path, { body, headers: reqOpts?.headers, ...(reqOpts?.keepalive ? { keepalive: true } : {}), ...(reqOpts?.credentials ? { credentials: reqOpts.credentials } : {}) }, asUser);
    const text = await res.text();
    if (!res.ok) throw method === 'GET' ? failure(res.status, text) : refusal(res.status, text);
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
      const started = begin(`${baseUrl}${path}`);
      xhr.onload = () => {
        told('POST', path, xhr.status, started, (name) => xhr.getResponseHeader(name));
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

  async function upload<T>(path: string, form: FormData, opts?: UploadOptions, asUser?: string): Promise<T> {
    const onProgress = opts?.onProgress;
    if (!onProgress || typeof XMLHttpRequest === 'undefined') {
      const res = await authedFetch('POST', path, { form }, asUser);
      const text = await res.text();
      if (!res.ok) throw refusal(res.status, text);
      return (text ? JSON.parse(text) : {}) as T;
    }
    // The same refresh-once-on-401 and refused-pick rules as every other request — the file is sent
    // again only as the person who sent it (batch 2).
    if (asUser !== undefined && !stillSender(asUser)) throw new SessionChangedError();
    const sentAs = asUser ?? holder();
    const send = async (shared: Record<string, string>) => {
      const token = getToken();
      let answer = await sendWithProgress(path, form, token, onProgress, shared);
      if (answer.status === 401 && stillSender(sentAs)) {
        const outcome = await refreshOnce(token, sentAs);
        if (outcome === 'refreshed') {
          if (stillSender(sentAs)) answer = await sendWithProgress(path, form, getToken(), onProgress, shared);
        } else if (outcome === 'invalid') onUnauthorized?.();
      }
      return answer;
    };
    const { sent, withoutPick } = sharedHeaders();
    let res = await send(sent);
    if (withoutPick && (await refusesCompany(res.status, async () => res.text)) && stillSender(sentAs)) {
      res = await send(withoutPick);
      if (!(await refusesCompany(res.status, async () => res.text))) onCompanyGone?.(sent);
    }
    if (res.status < 200 || res.status >= 300) throw refusal(res.status, res.text);
    return (res.text ? JSON.parse(res.text) : {}) as T;
  }

  async function getText(path: string, asUser?: string): Promise<string> {
    const res = await authedFetch('GET', path, {}, asUser);
    const text = await res.text();
    if (!res.ok) throw failure(res.status, text);
    return text;
  }

  /** A download; when the server names the file (Content-Disposition) it comes back as a File with that name. */
  async function getBlob(path: string, asUser?: string): Promise<Blob> {
    const res = await authedFetch('GET', path, {}, asUser);
    if (!res.ok) throw failure(res.status, await res.text());
    const blob = await res.blob();
    const name = fileNameFromDisposition(res.headers.get('content-disposition'));
    return name ? new File([blob], name, { type: blob.type }) : blob;
  }

  /** The client's calls, as whoever is signed in (asUser undefined) or only as one person (forUser). */
  function clientFor(asUser?: string): ApiClient {
    return {
      get: (path) => request('GET', path, undefined, undefined, asUser),
      post: (path, body, opts) => request('POST', path, body, opts, asUser),
      put: (path, body) => request('PUT', path, body, undefined, asUser),
      patch: (path, body) => request('PATCH', path, body, undefined, asUser),
      del: (path, opts) => request('DELETE', path, undefined, opts, asUser),
      upload: (path, form, opts) => upload(path, form, opts, asUser),
      getText: (path) => getText(path, asUser),
      getBlob: (path) => getBlob(path, asUser),
    };
  }

  return { ...clientFor(), forUser: (userId: string) => clientFor(userId) };
}
