import { describe, it, expect, vi } from 'vitest';
import { createApiClient, ApiError, NetworkError, isNetworkError, classifyRefreshStatus } from './api-client';
import { resolveApiBaseUrl, DEFAULT_API_BASE } from './config';

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
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => token, fetchImpl: fetchImpl as unknown as typeof fetch, refreshTokens });
    const form = new FormData();
    // React Native's multipart file part ({ uri, name, type }).
    form.append('file', { uri: 'file:///cache/hi.txt', name: 'hi.txt', type: 'text/plain' } as unknown as Blob);
    const res = await api.upload<{ data: { id: string } }>('/tasks/t1/attachments', form);
    expect(res.data.id).toBe('a1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe('http://api.test/tasks/t1/attachments');
    expect(init!.method).toBe('POST');
    expect(init!.body).toBe(form);
    const headers = init!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer new');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('returns the parsed body and attaches the bearer token (async getToken)', async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: { ok: true } })));
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: async () => 'tok123', fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await api.get<{ data: { ok: boolean } }>('/health');
    expect(res.data.ok).toBe(true);
    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123');
  });

  it('POSTs a JSON body without a token when none', async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: {} })));
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.post('/auth/login', { identifier: 'ada', password: 'x' });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ identifier: 'ada', password: 'x' });
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('does not set a JSON content-type on a bodyless request (Fastify rejects empty JSON bodies)', async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: {} })));
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.post('/notifications/read-all'); // no body
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('turns a non-JSON error body (e.g. a proxy 502 page) into an ApiError, not a SyntaxError', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = await api.get('/tasks').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
  });

  it('does not attempt a refresh for any /auth/* endpoint (a failed login is not an expiry)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'INVALID_CREDENTIALS' } }, 401));
    const refreshTokens = vi.fn(async () => true);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch, refreshTokens });
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
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => token, fetchImpl: fetchImpl as unknown as typeof fetch, refreshTokens });
    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it('throws an ApiError carrying the code on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'ACCOUNT_LOCKED', message: 'locked' } }, 423));
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch });
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
      baseUrl: 'http://api.test',
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
      baseUrl: 'http://api.test',
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
      baseUrl: 'http://api.test',
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
      baseUrl: 'http://api.test',
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
      baseUrl: 'http://api.test',
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
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 't', fetchImpl: fetchImpl as unknown as typeof fetch, refreshTokens, onUnauthorized });
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
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch });
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
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 20 });
    const err = await api.get('/slow').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).timedOut).toBe(true);
  });

  it('sends per-request headers (Idempotency-Key) and reports reachability', async () => {
    const fetchImpl = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: {} })));
    const onReachable = vi.fn();
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 't', fetchImpl: fetchImpl as unknown as typeof fetch, onReachable });
    await api.post('/tasks', { title: 'x' }, { headers: { 'Idempotency-Key': 'k-1' } });
    const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('k-1');
    expect(headers['Authorization']).toBe('Bearer t');
    expect(onReachable).toHaveBeenCalledOnce();
  });

  it('exposes the single-flight refresh for sockets', async () => {
    const refreshTokens = vi.fn(async () => 'ok' as const);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 't', refreshTokens });
    const [a, b] = await Promise.all([api.refreshSession(), api.refreshSession()]);
    expect([a, b]).toEqual(['ok', 'ok']);
    expect(refreshTokens).toHaveBeenCalledOnce();
  });

  it('classifies /auth/refresh statuses: only 401/400 end the session', () => {
    expect(classifyRefreshStatus(200)).toBe('ok');
    expect(classifyRefreshStatus(401)).toBe('invalid');
    expect(classifyRefreshStatus(400)).toBe('invalid');
    expect(classifyRefreshStatus(429)).toBe('transient');
    expect(classifyRefreshStatus(500)).toBe('transient');
    expect(classifyRefreshStatus(503)).toBe('transient');
  });

  it('does not attempt refresh on the refresh endpoint itself', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
    const refreshTokens = vi.fn(async () => true);
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => 't',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      refreshTokens,
    });
    await expect(api.post('/auth/refresh', {})).rejects.toBeInstanceOf(ApiError);
    expect(refreshTokens).not.toHaveBeenCalled(); // avoid infinite refresh recursion
  });
});
