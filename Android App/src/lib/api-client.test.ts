import { describe, it, expect, vi } from 'vitest';
import { createApiClient, ApiError } from './api-client';
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
