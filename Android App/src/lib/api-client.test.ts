import { describe, it, expect, vi } from 'vitest';
import { createApiClient, ApiError, NetworkError, isNetworkError, classifyRefreshStatus, readRefreshReply } from './api-client';
import { resolveApiBaseUrl, DEFAULT_API_BASE } from './config';
import { createReadCache } from './read-cache';
import { createMemoryStore } from './storage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('resolveApiBaseUrl', () => {
  it('uses the emulator default when unset', () => {
    expect(resolveApiBaseUrl()).toBe(DEFAULT_API_BASE);
    expect(resolveApiBaseUrl({})).toBe(DEFAULT_API_BASE);
  });
  it('applies an override and trims trailing slashes', () => {
    expect(resolveApiBaseUrl({ apiBaseUrl: 'https://api.co/api/v1/ ' })).toBe('https://api.co/api/v1');
  });
});

describe('api-client', () => {
  it('uploads a multipart form with the token and no JSON content type, retrying once after a refresh', async () => {
    let token = 'old';
    const fetchImpl = vi
      .fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: { id: 'a1' } }, 201)))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401)));
    const refreshTokens = vi.fn(async () => {
      token = 'new';
      return 'ok' as const;
    });
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => token, fetchImpl: fetchImpl as unknown as typeof fetch, refreshTokens });
    const form = new FormData();
    // React Native's multipart file part ({ uri, name, type }).
    form.append('file', { uri: 'file:///cache/hi.txt', name: 'hi.txt', type: 'text/plain' } as unknown as Blob);
    const res = await api.upload<{ data: { id: string } }>('/tasks/t1/attachments', form);
    expect(res.data.id).toBe('a1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe('https://api.test/tasks/t1/attachments');
    expect(init!.method).toBe('POST');
    expect(init!.body).toBe(form);
    const headers = init!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer new');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('returns the parsed body and attaches the bearer token (async getToken)', async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: { ok: true } })));
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: async () => 'tok123', fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await api.get<{ data: { ok: boolean } }>('/health');
    expect(res.data.ok).toBe(true);
    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123');
  });

  it('POSTs a JSON body without a token when none', async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: {} })));
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.post('/auth/login', { identifier: 'ada', password: 'x' });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ identifier: 'ada', password: 'x' });
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('does not set a JSON content-type on a bodyless request (Fastify rejects empty JSON bodies)', async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: {} })));
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.post('/notifications/read-all'); // no body
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('turns a non-JSON error body (e.g. a proxy 502 page) into an ApiError, not a SyntaxError', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = await api.get('/tasks').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
  });

  it('does not attempt a refresh for any /auth/* endpoint (a failed login is not an expiry)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'INVALID_CREDENTIALS' } }, 401));
    const refreshTokens = vi.fn(async () => true);
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch, refreshTokens });
    await expect(api.post('/auth/login', { identifier: 'ada', password: 'x' })).rejects.toBeInstanceOf(ApiError);
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it('shares a single refresh across concurrent 401s (no duplicate rotating refreshes)', async () => {
    let token = 'stale';
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = (init!.headers as Record<string, string>)['Authorization'];
      return auth === 'Bearer fresh' ? jsonResponse({ data: {} }) : jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401);
    });
    const refreshTokens = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      token = 'fresh';
      return true;
    });
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => token, fetchImpl: fetchImpl as unknown as typeof fetch, refreshTokens });
    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it('throws an ApiError carrying the code on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'ACCOUNT_LOCKED', message: 'locked' } }, 423));
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(api.post('/auth/login', {})).rejects.toBeInstanceOf(ApiError);
    await api.post('/auth/login', {}).catch((e: ApiError) => {
      expect(e.code).toBe('ACCOUNT_LOCKED');
      expect(e.status).toBe(423);
    });
  });

  it('refreshes the token on a 401 and retries the request once', async () => {
    let token = 'stale';
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = (init!.headers as Record<string, string>)['Authorization'];
      return auth === 'Bearer fresh' ? jsonResponse({ data: { ok: true } }) : jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401);
    });
    const refreshTokens = vi.fn(async () => {
      token = 'fresh';
      return true;
    });
    const api = createApiClient({
      baseUrl: 'https://api.test',
      getToken: () => token,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      refreshTokens,
    });
    const res = await api.get<{ data: { ok: boolean } }>('/tasks');
    expect(res.data.ok).toBe(true);
    expect(refreshTokens).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2); // original + retry
  });

  it('calls onUnauthorized and throws when refresh fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
    const onUnauthorized = vi.fn();
    const refreshTokens = vi.fn(async () => false);
    const api = createApiClient({
      baseUrl: 'https://api.test',
      getToken: () => 'stale',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      refreshTokens,
      onUnauthorized,
    });
    await expect(api.get('/tasks')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry when refresh fails
  });

  it('calls onUnauthorized on a 401 when no refresh is configured', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
    const onUnauthorized = vi.fn();
    const api = createApiClient({
      baseUrl: 'https://api.test',
      getToken: () => 'stale',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onUnauthorized,
    });
    await expect(api.get('/tasks')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does NOT log out when the refresh is transient (offline / 5xx / 429) and reports a NetworkError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
    const onUnauthorized = vi.fn();
    const api = createApiClient({
      baseUrl: 'https://api.test',
      getToken: () => 'stale',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      refreshTokens: async () => 'transient',
      onUnauthorized,
    });
    const err = await api.get('/tasks').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(isNetworkError(err)).toBe(true);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('treats a refresh that throws as transient (never a logout)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
    const onUnauthorized = vi.fn();
    const api = createApiClient({
      baseUrl: 'https://api.test',
      getToken: () => 'stale',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      refreshTokens: async () => {
        throw new TypeError('Network request failed');
      },
      onUnauthorized,
    });
    await expect(api.get('/tasks')).rejects.toBeInstanceOf(NetworkError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('never logs out on a 429 RATE_LIMITED response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'RATE_LIMITED', message: 'slow down' } }, 429));
    const onUnauthorized = vi.fn();
    const refreshTokens = vi.fn(async () => 'ok' as const);
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 't', fetchImpl: fetchImpl as unknown as typeof fetch, refreshTokens, onUnauthorized });
    const err = await api.post('/tasks', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('RATE_LIMITED');
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it('wraps a fetch failure in a NetworkError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = await api.get('/tasks').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).timedOut).toBe(false);
  });

  it('aborts a hung request after the timeout and reports it as a timed-out NetworkError', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 20 });
    const err = await api.get('/slow').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).timedOut).toBe(true);
  });

  it('says the server is out of reach when a request gets no answer at all', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const onReachable = vi.fn();
    const onUnreachable = vi.fn();
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch, onReachable, onUnreachable });
    await api.get('/tasks').catch(() => {});
    expect(onUnreachable).toHaveBeenCalledOnce();
    expect(onReachable).not.toHaveBeenCalled();
  });

  it('does not call a slow answer (a time-out) or a refusal "out of reach"', async () => {
    const onUnreachable = vi.fn();
    const hung = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const slow = createApiClient({ baseUrl: 'https://api.test', getToken: () => null, fetchImpl: hung as unknown as typeof fetch, timeoutMs: 20, onUnreachable });
    await slow.get('/slow').catch(() => {});
    const refusing = vi.fn(async () => jsonResponse({ error: { code: 'X', message: 'no' } }, 500));
    const busy = createApiClient({ baseUrl: 'https://api.test', getToken: () => null, fetchImpl: refusing as unknown as typeof fetch, onUnreachable });
    await busy.get('/tasks').catch(() => {});
    expect(onUnreachable).not.toHaveBeenCalled();
  });

  it('sends per-request headers (Idempotency-Key) and reports reachability', async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: {} })));
    const onReachable = vi.fn();
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 't', fetchImpl: fetchImpl as unknown as typeof fetch, onReachable });
    await api.post('/tasks', { title: 'x' }, { headers: { 'Idempotency-Key': 'k-1' } });
    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('k-1');
    expect(headers['Authorization']).toBe('Bearer t');
    expect(onReachable).toHaveBeenCalledOnce();
  });

  it('exposes the single-flight refresh for sockets', async () => {
    const refreshTokens = vi.fn(async () => 'ok' as const);
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 't', refreshTokens });
    const [a, b] = await Promise.all([api.refreshSession(), api.refreshSession()]);
    expect([a, b]).toEqual(['ok', 'ok']);
    expect(refreshTokens).toHaveBeenCalledOnce();
  });

  it('classifies /auth/refresh statuses: 401/400 end the session; a 403 alone can’t tell', () => {
    expect(classifyRefreshStatus(200)).toBe('ok');
    expect(classifyRefreshStatus(401)).toBe('invalid');
    expect(classifyRefreshStatus(400)).toBe('invalid');
    // A 403 may be our server (ACCOUNT_INACTIVE) or a firewall in front of it: readRefreshReply decides.
    expect(classifyRefreshStatus(403)).toBe('transient');
    expect(classifyRefreshStatus(429)).toBe('transient');
    expect(classifyRefreshStatus(500)).toBe('transient');
    expect(classifyRefreshStatus(503)).toBe('transient');
  });

  it('does not attempt refresh on the refresh endpoint itself', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
    const refreshTokens = vi.fn(async () => true);
    const api = createApiClient({
      baseUrl: 'https://api.test',
      getToken: () => 't',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      refreshTokens,
    });
    await expect(api.post('/auth/refresh', {})).rejects.toBeInstanceOf(ApiError);
    expect(refreshTokens).not.toHaveBeenCalled(); // avoid infinite refresh recursion
  });
});

describe('api-client upload with progress', () => {
  class FakeXhr {
    static sent: FakeXhr[] = [];
    upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    timeout = 0;
    status = 0;
    responseText = '';
    method = '';
    url = '';
    headers: Record<string, string> = {};
    body: unknown;
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send(body: unknown) {
      this.body = body;
      FakeXhr.sent.push(this);
    }
    respond(status: number, body: unknown) {
      this.status = status;
      this.responseText = JSON.stringify(body);
      this.onload?.();
    }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('reports how far the upload is, with the token and no JSON content type', async () => {
    FakeXhr.sent = [];
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 'tok', xhrImpl: FakeXhr as unknown as typeof XMLHttpRequest });
    const form = new FormData();
    const progress: number[] = [];
    const done = api.upload<{ data: { id: string } }>('/tasks/t1/attachments', form, { onProgress: (f) => progress.push(f) });
    await tick();
    const xhr = FakeXhr.sent[0]!;
    expect(xhr).toMatchObject({ method: 'POST', url: 'https://api.test/tasks/t1/attachments', body: form });
    expect(xhr.headers['Authorization']).toBe('Bearer tok');
    expect(xhr.headers['Content-Type']).toBeUndefined();
    xhr.upload.onprogress?.({ loaded: 1, total: 4, lengthComputable: true });
    xhr.respond(201, { data: { id: 'a1' } });
    expect((await done).data.id).toBe('a1');
    expect(progress).toEqual([0.25]);
  });

  it('refreshes an expired session once and sends the file again', async () => {
    FakeXhr.sent = [];
    let token = 'old';
    const refreshTokens = vi.fn(async () => {
      token = 'new';
      return 'ok' as const;
    });
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => token, refreshTokens, xhrImpl: FakeXhr as unknown as typeof XMLHttpRequest });
    const done = api.upload<{ data: { id: string } }>('/tasks/t1/attachments', new FormData(), { onProgress: () => {} });
    await tick();
    FakeXhr.sent[0]!.respond(401, { error: { code: 'UNAUTHORIZED', message: 'Expired' } });
    await tick();
    await tick();
    expect(FakeXhr.sent[1]!.headers['Authorization']).toBe('Bearer new');
    FakeXhr.sent[1]!.respond(201, { data: { id: 'a2' } });
    expect((await done).data.id).toBe('a2');
  });

  it('is a network error when the connection drops, a server error with its reason otherwise', async () => {
    FakeXhr.sent = [];
    const onUnreachable = vi.fn();
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 'tok', xhrImpl: FakeXhr as unknown as typeof XMLHttpRequest, onUnreachable });
    const dropped = api.upload('/tasks/t1/attachments', new FormData(), { onProgress: () => {} });
    await tick();
    FakeXhr.sent[0]!.onerror?.();
    const err = await dropped.catch((e) => e);
    expect(isNetworkError(err)).toBe(true);
    expect(onUnreachable).toHaveBeenCalledOnce();
    const refused = api.upload('/tasks/t1/attachments', new FormData(), { onProgress: () => {} });
    await tick();
    FakeXhr.sent[1]!.respond(413, { error: { code: 'TOO_LARGE', message: 'File too large.' } });
    await expect(refused).rejects.toMatchObject({ status: 413, message: 'File too large.' });
  });
});

describe('api-client — plain http only on the office network', () => {
  it('refuses an http request to a public host without calling fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    const api = createApiClient({ baseUrl: 'http://task.mico360.com/api/v1', getToken: () => 't', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(api.get('/tasks')).rejects.toMatchObject({ name: 'InsecureAddressError' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still talks to an office server on plain http', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [1] }));
    const api = createApiClient({ baseUrl: 'http://192.168.1.5:4000/api/v1', getToken: () => 't', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(api.get('/tasks')).resolves.toEqual({ data: [1] });
  });
});

describe('api-client — a Wi-Fi sign-in page is treated as being offline', () => {
  const htmlPage = () => new Response('<html><body>Please sign in to the hotel Wi-Fi</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });

  it('an HTML 200 is a NetworkError (not a SyntaxError) and never signs anyone out', async () => {
    const onUnauthorized = vi.fn();
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 't', fetchImpl: vi.fn(async () => htmlPage()) as unknown as typeof fetch, onUnauthorized });
    const err = (await api.get('/tasks').catch((e: unknown) => e)) as Error;
    expect(isNetworkError(err)).toBe(true);
    expect(String(err.message)).toMatch(/sign in to the Wi-Fi/);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('so a read falls back to the cache', async () => {
    const store = createMemoryStore();
    const cache = createReadCache({ store, getUserId: () => 'u1' });
    await cache.read('projects', async () => [{ id: 'p1' }]);
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 't', fetchImpl: vi.fn(async () => htmlPage()) as unknown as typeof fetch });
    expect(await cache.read('projects', () => api.get('/projects'))).toEqual({ data: [{ id: 'p1' }], stale: true });
  });
});

describe('api-client — the fingerprint key request carries the refresh token itself', () => {
  it('a 401 on /auth/biometric-credential is not "renewed and retried" (that would resend a spent token); like every /auth/* call', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } }, 401));
    const refreshTokens = vi.fn(async () => 'ok' as const);
    const onUnauthorized = vi.fn();
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 't', fetchImpl: fetchImpl as unknown as typeof fetch, refreshTokens, onUnauthorized });
    await expect(api.post('/auth/biometric-credential', { refreshToken: 'rt' })).rejects.toBeInstanceOf(ApiError);
    await expect(api.post('/auth/login', { identifier: 'x', password: 'y' })).rejects.toBeInstanceOf(ApiError);
    expect(refreshTokens).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe('api-client — the app says which version it is', () => {
  it('sends the app headers on every request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 't', fetchImpl: fetchImpl as unknown as typeof fetch, appHeaders: { 'X-App-Version': '1.2.1', 'X-App-Build': '10' } });
    await api.get('/tasks');
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers['X-App-Version']).toBe('1.2.1');
    expect(headers['X-App-Build']).toBe('10');
    expect(headers.Authorization).toBe('Bearer t');
  });
});

describe('api-client — a request may wait longer than usual (the AI helpers)', () => {
  /** A server that answers after `ms`, unless the request is aborted first. */
  const answersAfter = (ms: number) =>
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const t = setTimeout(() => resolve(jsonResponse({ data: { ok: true } })), ms);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('aborted'));
          });
        }),
    );

  it('waits for the request’s own timeout instead of the default', async () => {
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 't', fetchImpl: answersAfter(60) as unknown as typeof fetch, timeoutMs: 20 });
    await expect(api.post('/ai/breakdown', { title: 'x' }, { timeoutMs: 1000 })).resolves.toEqual({ data: { ok: true } });
  });

  it('still gives up at that timeout, as a timed-out NetworkError', async () => {
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 't', fetchImpl: answersAfter(1000) as unknown as typeof fetch, timeoutMs: 5000 });
    const err = await api.post('/ai/breakdown', { title: 'x' }, { timeoutMs: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).timedOut).toBe(true);
  });

  it('keeps the normal timeout for every other request', async () => {
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 't', fetchImpl: answersAfter(60) as unknown as typeof fetch, timeoutMs: 20 });
    const err = await api.get('/tasks').catch((e: unknown) => e);
    expect((err as NetworkError).timedOut).toBe(true);
  });
});

describe('readRefreshReply — only a real session is ever stored', () => {
  const session = { user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['EMPLOYEE'] }, accessToken: 'at-2', refreshToken: 'rt-2' };
  const reply = (status: number, body: unknown) => ({ status, json: async () => body });

  it('a 200 with both tokens and the user’s id is the new session', async () => {
    expect(await readRefreshReply(reply(200, { data: session }))).toEqual({ outcome: 'ok', session });
  });

  it('a 200 that isn’t a session (a proxy page, a cut-off reply) is transient, never stored', async () => {
    expect(await readRefreshReply(reply(200, { data: { ...session, refreshToken: '' } }))).toEqual({ outcome: 'transient' });
    expect(await readRefreshReply(reply(200, { data: { accessToken: 'at-2', refreshToken: 'rt-2' } }))).toEqual({ outcome: 'transient' });
    expect(await readRefreshReply(reply(200, { data: { ...session, user: { ...session.user, id: '' } } }))).toEqual({ outcome: 'transient' });
    expect(await readRefreshReply(reply(200, { ok: true }))).toEqual({ outcome: 'transient' });
    expect(await readRefreshReply(reply(200, null))).toEqual({ outcome: 'transient' });
    expect(await readRefreshReply({ status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } })).toEqual({ outcome: 'transient' });
  });

  it('a refusal ends the session — a deactivated account (403) too; 429 and 5xx don’t', async () => {
    expect(await readRefreshReply(reply(401, { error: { code: 'INVALID_REFRESH_TOKEN' } }))).toEqual({ outcome: 'invalid' });
    // The account was turned off: the session won't come back by waiting.
    expect(await readRefreshReply(reply(403, { error: { code: 'ACCOUNT_INACTIVE', message: 'This account is not active.' } }))).toEqual({ outcome: 'invalid' });
    // A firewall or proxy page in front of the server (not our answer) signs nobody out.
    expect(await readRefreshReply({ status: 403, json: async () => { throw new SyntaxError('Unexpected token <'); } })).toEqual({ outcome: 'transient' });
    expect(await readRefreshReply(reply(403, { message: 'Forbidden' }))).toEqual({ outcome: 'transient' });
    expect(await readRefreshReply(reply(403, { error: { code: 'ACCOUNT_INACTIVE' } }))).toEqual({ outcome: 'invalid' });
    expect(await readRefreshReply(reply(429, {}))).toEqual({ outcome: 'transient' });
    expect(await readRefreshReply(reply(502, {}))).toEqual({ outcome: 'transient' });
  });
});

describe('a refresh that finds someone else signed in meanwhile (6a review)', () => {
  it('fails the request plainly: never sent with the other person’s session, and nobody is signed out', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401));
    const onUnauthorized = vi.fn();
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => 'old', fetchImpl: fetchImpl as unknown as typeof fetch, refreshTokens: async () => 'changed', onUnauthorized });
    const e = await api.post('/tasks', { title: 'x' }).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 401, code: 'SESSION_CHANGED' });
    expect(isNetworkError(e)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe('a request is renewed only for the person it was sent for (5b review #3)', () => {
  /** A phone where A signs out and B signs in while A's request is on its way. */
  function phone() {
    let user: string | null = 'ann';
    let token = 'ann-token';
    const refreshTokens = vi.fn(async () => 'ok' as const);
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (auth === 'Bearer ann-token') {
        // While A's request is on its way, A signs out and B signs in.
        user = 'bob';
        token = 'bob-token';
        return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'expired' } }, 401);
      }
      return jsonResponse({ data: { ok: true } });
    });
    const api = createApiClient({
      baseUrl: 'https://api.test',
      getToken: () => token,
      getUserId: () => user,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      refreshTokens,
      onUnauthorized,
    });
    return { api, fetchImpl, refreshTokens, onUnauthorized, signInAs: (u: string, t: string) => ((user = u), (token = t)) };
  }

  it('A’s 401 that arrives once B is signed in: B’s session is not refreshed for it, and A’s request is never sent with it', async () => {
    const { api, fetchImpl, refreshTokens, onUnauthorized } = phone();
    const e = await api.post('/tasks', { title: 'Ann’s task' }).catch((err: unknown) => err);
    expect(e).toMatchObject({ status: 401, code: 'SESSION_CHANGED' });
    expect(refreshTokens).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('a refresh asked for someone who is no longer signed in answers "changed" (sockets, exports)', async () => {
    const { api, refreshTokens, signInAs } = phone();
    signInAs('bob', 'bob-token');
    expect(await api.refreshSession('ann')).toBe('changed');
    expect(refreshTokens).not.toHaveBeenCalled();
    expect(await api.refreshSession('bob')).toBe('ok');
  });

  it('a refresh that ends with someone else signed in answers "changed", even when it worked', async () => {
    let user: string | null = 'ann';
    const api = createApiClient({
      baseUrl: 'https://api.test',
      getToken: () => 't',
      getUserId: () => user,
      refreshTokens: async () => {
        user = 'bob';
        return 'ok';
      },
    });
    expect(await api.refreshSession('ann')).toBe('changed');
  });

  it('a client kept for one person (the offline queue’s) never sends while someone else is signed in', async () => {
    const { api, fetchImpl, signInAs } = phone();
    signInAs('bob', 'bob-token');
    const e = await api.forUser('ann').put('/tasks/t1', { title: 'x' }).catch((err: unknown) => err);
    expect(e).toMatchObject({ status: 401, code: 'SESSION_CHANGED' });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(api.forUser('bob').get('/tasks')).resolves.toEqual({ data: { ok: true } });
  });
});

describe('every refresh caller says whose request it is (5b review #3)', () => {
  it('the app passes the person to the API client, the exporter, the live sockets and the offline queue', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const services = readFileSync(resolve(__dirname, '../core/services.ts'), 'utf8');
    const socket = readFileSync(resolve(__dirname, '../core/authed-socket.ts'), 'utf8');
    expect(services.match(/getUserId: currentUserId,/g)?.length).toBeGreaterThanOrEqual(2); // API client + exporter
    expect(services).toMatch(/refreshSession: \(expectedUserId\) => api\.refreshSession\(expectedUserId\)/);
    expect(services).toMatch(/performMutation\(resourcesApi\(api\.forUser\(m\.userId\)\), m\)/);
    expect(socket).toMatch(/const owner = services\.session\.getSession\(\)\?\.user\.id \?\? null;/);
    expect(socket).toMatch(/refresh: \(\) => services\.api\.refreshSession\(owner\)/);
  });
});

describe('a refresh is joined only by its own person’s requests (4b review #16)', () => {
  it('B’s 401 while A’s refresh is still on its way waits for it, then gets its own — never “signed in as someone else”', async () => {
    let user: string | null = 'ann';
    let token = 'ann-old';
    let releaseAnn!: () => void;
    const refreshTokens = vi.fn(async () => {
      if (user === 'ann') {
        await new Promise<void>((r) => (releaseAnn = r));
        return 'changed' as const; // Ann signed out meanwhile: her refresh ends for nobody
      }
      token = 'bob-new';
      return 'ok' as const;
    });
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (auth === 'Bearer ann-old' || auth === 'Bearer bob-old') return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'expired' } }, 401);
      return jsonResponse({ data: { ok: auth } });
    });
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: () => token, getUserId: () => user, fetchImpl: fetchImpl as unknown as typeof fetch, refreshTokens });
    // Ann's request gets a 401 and starts a refresh; she signs out and Bob signs in meanwhile.
    const ann = api.get('/tasks').catch((e: unknown) => e);
    await vi.waitFor(() => expect(refreshTokens).toHaveBeenCalledTimes(1));
    user = 'bob';
    token = 'bob-old';
    const bob = api.get('/tasks/mine');
    await new Promise((r) => setTimeout(r, 0));
    releaseAnn();
    await expect(bob).resolves.toEqual({ data: { ok: 'Bearer bob-new' } });
    expect(refreshTokens).toHaveBeenCalledTimes(2);
    expect(await ann).toMatchObject({ code: 'SESSION_CHANGED' });
  });
});
