import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiClient, ApiError } from './api-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('api client', () => {
  it('returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: { ok: true } })));
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null });
    const res = await api.get<{ data: { ok: boolean } }>('/health');
    expect(res.data.ok).toBe(true);
  });

  it('attaches a bearer token when available', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: {} })));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok123' });
    await api.get('/me');
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123');
  });

  it('POSTs a JSON body', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: {} })));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null });
    await api.post('/auth/login', { identifier: 'ada', password: 'x' });
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ identifier: 'ada', password: 'x' });
  });

  it('does not set a JSON content-type on a bodyless POST (Fastify rejects empty JSON bodies)', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: {} })));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok123' });
    await api.post('/tasks/t1/watch'); // no body
    const init = fetchMock.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(init.body).toBeUndefined();
    expect(headers['Content-Type']).toBeUndefined(); // no body -> no JSON content-type
    expect(headers['Authorization']).toBe('Bearer tok123');
  });

  it('still sets a JSON content-type when a body is present', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: {} })));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null });
    await api.post('/conversations/x/read', {});
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('uploads FormData without forcing a JSON content-type (browser sets the boundary)', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: { id: 'a1' } })));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok123' });
    const fd = new FormData();
    fd.append('file', new Blob(['hi'], { type: 'text/plain' }), 'hi.txt');
    const res = await api.upload<{ data: { id: string } }>('/tasks/t1/attachments', fd);
    expect(res.data.id).toBe('a1');
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(fd); // FormData passed straight through
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined(); // let the browser set multipart boundary
    expect(headers['Authorization']).toBe('Bearer tok123'); // auth still attached
  });

  it('getText returns the raw response body and attaches the bearer token', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response('a,b\r\n1,2', { status: 200, headers: { 'content-type': 'text/csv' } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok123' });
    const text = await api.getText('/reports/status.csv');
    expect(text).toBe('a,b\r\n1,2');
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123');
  });

  it('getText throws an ApiError on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null });
    await expect(api.getText('/reports/status.csv')).rejects.toBeInstanceOf(ApiError);
  });

  it('getBlob returns the response body as a Blob with auth attached', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok123' });
    const blob = await api.getBlob('/reports/projects.pdf');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(8); // '%PDF-1.4'
    expect(blob.type).toContain('application/pdf');
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123');
  });

  it('getBlob throws an ApiError on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null });
    await expect(api.getBlob('/reports/projects.pdf')).rejects.toBeInstanceOf(ApiError);
  });

  it('throws an ApiError carrying the error code on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'INVALID_CREDENTIALS', message: 'nope' } }, 401)));
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null });
    await expect(api.post('/auth/login', {})).rejects.toBeInstanceOf(ApiError);
    await api.post('/auth/login', {}).catch((e: ApiError) => {
      expect(e.code).toBe('INVALID_CREDENTIALS');
      expect(e.status).toBe(401);
    });
  });

  it('refreshes the token on a 401, then retries and returns the data', async () => {
    let token = 'stale';
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = (init!.headers as Record<string, string>)['Authorization'];
      return auth === 'Bearer fresh' ? jsonResponse({ data: { ok: true } }) : jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401);
    });
    vi.stubGlobal('fetch', fetchMock);
    const refreshTokens = vi.fn(async () => { token = 'fresh'; return true; });
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => token, refreshTokens });
    const res = await api.get<{ data: { ok: boolean } }>('/tasks');
    expect(res.data.ok).toBe(true);
    expect(refreshTokens).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('logs out (onUnauthorized) and throws when the refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401)));
    const onUnauthorized = vi.fn();
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'stale', refreshTokens: async () => false, onUnauthorized });
    await expect(api.get('/tasks')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('shares a single refresh across concurrent 401s (no duplicate refresh calls)', async () => {
    let token = 'stale';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = (init!.headers as Record<string, string>)['Authorization'];
      return auth === 'Bearer fresh' ? jsonResponse({ data: {} }) : jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401);
    }));
    const refreshTokens = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      token = 'fresh';
      return true;
    });
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => token, refreshTokens });
    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(refreshTokens).toHaveBeenCalledOnce(); // single-flight
  });

  it('does not attempt a refresh for auth endpoints (a failed login is not an expiry)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'INVALID_CREDENTIALS' } }, 401)));
    const refreshTokens = vi.fn(async () => true);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, refreshTokens });
    await expect(api.post('/auth/login', {})).rejects.toBeInstanceOf(ApiError);
    expect(refreshTokens).not.toHaveBeenCalled();
  });
});
