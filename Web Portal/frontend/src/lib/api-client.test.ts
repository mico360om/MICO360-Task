import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiClient, ApiError } from './api-client';
import { fileNameOf } from './download';

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

  describe('upload with progress', () => {
    class FakeXhr {
      static sent: FakeXhr[] = [];
      upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
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
    beforeEach(() => {
      FakeXhr.sent = [];
      vi.stubGlobal('XMLHttpRequest', FakeXhr);
    });
    const tick = () => new Promise((r) => setTimeout(r, 0));

    it('reports how far the upload is, then resolves with the response', async () => {
      const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok123' });
      const fd = new FormData();
      const progress: number[] = [];
      const done = api.upload<{ data: { id: string } }>('/tasks/t1/attachments', fd, { onProgress: (f) => progress.push(f) });
      const xhr = FakeXhr.sent[0]!;
      expect(xhr).toMatchObject({ method: 'POST', url: 'http://api.test/tasks/t1/attachments', body: fd });
      expect(xhr.headers['Authorization']).toBe('Bearer tok123');
      expect(xhr.headers['Content-Type']).toBeUndefined();
      xhr.upload.onprogress?.({ loaded: 25, total: 100, lengthComputable: true });
      xhr.upload.onprogress?.({ loaded: 100, total: 100, lengthComputable: true });
      xhr.respond(201, { data: { id: 'a1' } });
      expect((await done).data.id).toBe('a1');
      expect(progress).toEqual([0.25, 1]);
    });

    it('refreshes an expired token once and sends the file again', async () => {
      let token = 'old';
      const refreshTokens = vi.fn(async () => {
        token = 'new';
        return 'refreshed' as const;
      });
      const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => token, refreshTokens });
      const done = api.upload<{ data: { id: string } }>('/tasks/t1/attachments', new FormData(), { onProgress: () => {} });
      FakeXhr.sent[0]!.respond(401, { error: { code: 'UNAUTHORIZED', message: 'Expired' } });
      await tick();
      await tick();
      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(FakeXhr.sent[1]!.headers['Authorization']).toBe('Bearer new');
      FakeXhr.sent[1]!.respond(201, { data: { id: 'a2' } });
      expect((await done).data.id).toBe('a2');
    });

    it('rejects with the server’s reason, or a network error when the connection drops', async () => {
      const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok' });
      const refused = api.upload('/tasks/t1/attachments', new FormData(), { onProgress: () => {} });
      FakeXhr.sent[0]!.respond(413, { error: { code: 'TOO_LARGE', message: 'File too large.' } });
      await expect(refused).rejects.toMatchObject({ status: 413, message: 'File too large.' });
      const dropped = api.upload('/tasks/t1/attachments', new FormData(), { onProgress: () => {} });
      FakeXhr.sent[1]!.onerror?.();
      await expect(dropped).rejects.toBeInstanceOf(TypeError);
    });

    it('an upload carries the picked company too, and a refused pick is sent again without it', async () => {
      const gone = vi.fn();
      let h: Record<string, string> = { 'X-Company-Id': 'B' };
      const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok', getHeaders: () => h, onCompanyGone: () => { gone(); h = {}; } });
      const done = api.upload<{ data: { id: string } }>('/tasks/t1/attachments', new FormData(), { onProgress: () => {} });
      expect(FakeXhr.sent[0]!.headers['X-Company-Id']).toBe('B');
      FakeXhr.sent[0]!.respond(403, { error: { code: 'COMPANY_NOT_AVAILABLE', message: 'You no longer have access to this company.' } });
      await tick();
      expect(FakeXhr.sent[1]!.headers['X-Company-Id']).toBeUndefined();
      FakeXhr.sent[1]!.respond(201, { data: { id: 'a3' } });
      expect((await done).data.id).toBe('a3');
      expect(gone).toHaveBeenCalledTimes(1);
    });
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
    // Not `toBeInstanceOf(Blob)`: depending on the Node version, fetch's Blob and the test page's
    // Blob are different classes (in a browser they are one), so check what it is instead.
    expect(Object.prototype.toString.call(blob)).toBe('[object Blob]');
    expect(blob.size).toBe(8); // '%PDF-1.4'
    expect(blob.type).toContain('application/pdf');
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123');
  });

  it('getBlob keeps the file name the server gives the download (Content-Disposition)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="tasks-report-ops-2026-10-01.pdf"' } })));
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok' });
    const blob = await api.getBlob('/reports/export.pdf');
    expect(fileNameOf(blob)).toBe('tasks-report-ops-2026-10-01.pdf');
    expect(blob.type).toContain('application/pdf');
    expect(fileNameOf(new Blob(['x']))).toBeNull();
  });

  it('never takes a path from the server, only a file name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 200, headers: { 'content-disposition': 'attachment; filename="../../evil.pdf"' } })));
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok' });
    expect(fileNameOf(await api.getBlob('/reports/export.pdf'))).toBe('evil.pdf');
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

  it('keeps the user signed in when the refresh fails transiently (offline, 5xx, 429)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401)));
    const onUnauthorized = vi.fn();
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'stale', refreshTokens: async () => 'transient', onUnauthorized });
    await expect(api.get('/tasks')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('treats a thrown refresh as transient, never as a logout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401)));
    const onUnauthorized = vi.fn();
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => 'stale',
      refreshTokens: async () => { throw new TypeError('offline'); },
      onUnauthorized,
    });
    await expect(api.get('/tasks')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('never logs out on a 429 from a normal request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'RATE_LIMITED' } }, 429)));
    const onUnauthorized = vi.fn();
    const refreshTokens = vi.fn(async () => true);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok', refreshTokens, onUnauthorized });
    await expect(api.get('/tasks')).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(refreshTokens).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('passes the rejected token to refreshTokens', async () => {
    let token = 'stale';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) =>
      (init!.headers as Record<string, string>)['Authorization'] === 'Bearer fresh' ? jsonResponse({ data: {} }) : jsonResponse({}, 401)));
    const refreshTokens = vi.fn(async (_rejected: string | null) => { token = 'fresh'; return 'refreshed' as const; });
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => token, refreshTokens });
    await api.get('/x');
    expect(refreshTokens).toHaveBeenCalledWith('stale');
  });

  it('sends extra request headers (e.g. Idempotency-Key) on a POST', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ data: {} })));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok' });
    await api.post('/tasks', { title: 'x' }, { headers: { 'Idempotency-Key': 'k-9' } });
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('k-9');
    expect(headers['Authorization']).toBe('Bearer tok');
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('the picked company', () => {
  type Call = [string, RequestInit];
  const goneBody = { error: { code: 'COMPANY_NOT_AVAILABLE', message: 'You no longer have access to this company.' } };
  function stubFetch(status: number, body: unknown) {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(body, status));
    vi.stubGlobal('fetch', f);
    return f as unknown as { mock: { calls: Call[] } };
  }
  function stubFetchSeq(answers: [number, unknown][]) {
    let i = 0;
    const f = vi.fn(async (_url: string, _init?: RequestInit) => {
      const [status, body] = answers[Math.min(i++, answers.length - 1)]!;
      return jsonResponse(body, status);
    });
    vi.stubGlobal('fetch', f);
    return f as unknown as { mock: { calls: Call[] } };
  }
  const client = (opts: { getHeaders?: () => Record<string, string>; onCompanyGone?: () => void }) =>
    createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok', ...opts });
  const headersOf = (call: Call) => call[1].headers as Record<string, string>;

  it('every request carries the picked company', async () => {
    const f = stubFetch(200, {});
    await client({ getHeaders: () => ({ 'X-Company-Id': 'B' }) }).get('/projects');
    expect(headersOf(f.mock.calls[0]!)['X-Company-Id']).toBe('B');
  });

  it('writes, text and file downloads carry it as well; the request’s own headers still go', async () => {
    const f = stubFetch(200, { data: {} });
    const c = client({ getHeaders: () => ({ 'X-Company-Id': 'B' }) });
    await c.post('/tasks', { title: 'x' }, { headers: { 'Idempotency-Key': 'k-1' } });
    await c.getText('/reports/status.csv');
    await c.getBlob('/reports/projects.pdf');
    await c.upload('/tasks/t1/attachments', new FormData());
    for (const call of f.mock.calls) expect(headersOf(call)['X-Company-Id']).toBe('B');
    expect(headersOf(f.mock.calls[0]!)['Idempotency-Key']).toBe('k-1');
    expect(headersOf(f.mock.calls[0]!)['Authorization']).toBe('Bearer tok');
  });

  it('with no company picked nothing is added', async () => {
    const f = stubFetch(200, {});
    await client({ getHeaders: () => ({}) }).get('/projects');
    expect(headersOf(f.mock.calls[0]!)['X-Company-Id']).toBeUndefined();
  });

  it('a refused pick is cleared, retried without it, and noticed', async () => {
    const gone = vi.fn();
    const f = stubFetchSeq([[403, goneBody], [200, { data: [] }]]);
    let h: Record<string, string> = { 'X-Company-Id': 'B' };
    const c = client({ getHeaders: () => h, onCompanyGone: () => { gone(); h = {}; } });
    // The client gives back the whole body (callers take `.data`).
    expect(await c.get('/projects')).toEqual({ data: [] });
    expect(gone).toHaveBeenCalledTimes(1);
    expect(f.mock.calls).toHaveLength(2);
    expect(headersOf(f.mock.calls[1]!)['X-Company-Id']).toBeUndefined();
  });

  it('the retry goes without the pick even while the store still holds it, and is sent once only', async () => {
    const gone = vi.fn();
    const f = stubFetchSeq([[403, goneBody], [200, { data: [] }]]);
    const c = client({ getHeaders: () => ({ 'X-Company-Id': 'B' }), onCompanyGone: gone });
    await c.get('/projects');
    expect(f.mock.calls).toHaveLength(2);
    expect(headersOf(f.mock.calls[1]!)['X-Company-Id']).toBeUndefined();
    expect(gone).toHaveBeenCalledWith({ 'X-Company-Id': 'B' });
  });

  it('a company the request itself names (not the pick) is refused as it is: the pick stays', async () => {
    const gone = vi.fn();
    stubFetchSeq([[403, goneBody], [403, goneBody]]);
    const c = client({ getHeaders: () => ({ 'X-Company-Id': 'B' }), onCompanyGone: gone });
    await expect(c.get('/people/candidates?companyIds=Z')).rejects.toMatchObject({ status: 403, code: 'COMPANY_NOT_AVAILABLE' });
    expect(gone).not.toHaveBeenCalled();
  });

  it('without a pick a COMPANY_NOT_AVAILABLE answer is not retried', async () => {
    const gone = vi.fn();
    const f = stubFetchSeq([[403, goneBody]]);
    const c = client({ getHeaders: () => ({}), onCompanyGone: gone });
    await expect(c.get('/people/candidates?companyIds=Z')).rejects.toMatchObject({ code: 'COMPANY_NOT_AVAILABLE' });
    expect(f.mock.calls).toHaveLength(1);
    expect(gone).not.toHaveBeenCalled();
  });

  it('another 403 is not about the pick', async () => {
    const gone = vi.fn();
    const f = stubFetchSeq([[403, { error: { code: 'FORBIDDEN', message: 'No.' } }]]);
    const c = client({ getHeaders: () => ({ 'X-Company-Id': 'B' }), onCompanyGone: gone });
    await expect(c.get('/projects/p1')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(f.mock.calls).toHaveLength(1);
    expect(gone).not.toHaveBeenCalled();
  });

  it('a refused file download is fetched again without the pick', async () => {
    const gone = vi.fn();
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (n++ === 0 ? jsonResponse(goneBody, 403) : new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }))));
    const blob = await client({ getHeaders: () => ({ 'X-Company-Id': 'B' }), onCompanyGone: gone }).getBlob('/reports/projects.pdf');
    expect(blob.size).toBe(4);
    expect(gone).toHaveBeenCalledTimes(1);
  });
});

// 1.22: a change the server refused is told to onRefused (an archived project's refusal is said across
// the page), then thrown to the caller as before; a read never is.
describe('onRefused', () => {
  const ARCHIVED = { error: { code: 'PROJECT_ARCHIVED', message: 'This project is archived — reopen it first.' } };

  it('is told about a refused change, which the caller still gets', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(ARCHIVED, 409)));
    const refused: ApiError[] = [];
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 't', onRefused: (e) => refused.push(e) });
    const err = await api.put('/tasks/t1', { title: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('PROJECT_ARCHIVED');
    expect(refused.map((e) => [e.status, e.code, e.message])).toEqual([[409, 'PROJECT_ARCHIVED', 'This project is archived — reopen it first.']]);
    await api.post('/tasks/t1/comments', { body: 'x' }).catch(() => undefined);
    await api.patch('/tasks/t1/move', { columnId: 'c' }).catch(() => undefined);
    const form = new FormData();
    await api.upload('/tasks/t1/attachments', form).catch(() => undefined);
    expect(refused).toHaveLength(4);
  });

  it('is not told about a read, and a listener that fails changes nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(ARCHIVED, 409)));
    const seen: string[] = [];
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 't', onRefused: (e) => { seen.push(e.code); throw new Error('boom'); } });
    await expect(api.get('/tasks/t1')).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    expect(seen).toEqual([]);
    await expect(api.del('/tasks/t1')).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    expect(seen).toEqual(['PROJECT_ARCHIVED']);
  });
});

// 1.22.4 (the Error log): each request's answer and time is told to onRequestDone — a request that
// never reached the server as status 0 — and nothing the listener does changes the request.
describe('onRequestDone', () => {
  it('tells the method, path, status and time of each request; a failed fetch is status 0 and still throws', async () => {
    const seen: { method: string; path: string; status: number; ms: number }[] = [];
    let fail = false;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (fail) throw new TypeError('Failed to fetch');
      return jsonResponse({ data: {} }, 201);
    }));
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, onRequestDone: (i) => seen.push(i) });
    await api.post('/tasks', { title: 'x' });
    fail = true;
    await expect(api.get('/tasks/t1')).rejects.toBeInstanceOf(TypeError);
    expect(seen.map((s) => [s.method, s.path, s.status])).toEqual([['POST', '/tasks', 201], ['GET', '/tasks/t1', 0]]);
    expect(seen.every((s) => typeof s.ms === 'number' && s.ms >= 0)).toBe(true);
  });

  it('a listener that throws changes nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: { ok: true } })));
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => null, onRequestDone: () => { throw new Error('reporter broke'); } });
    await expect(api.get('/x')).resolves.toEqual({ data: { ok: true } });
  });
});

// 1.23.1 — the server answers 503 DATABASE_BUSY while its database is away for a moment (a deploy
// restart): told to onDatabaseBusy for a read and a change alike, so the page can say so in its words.
describe('onDatabaseBusy', () => {
  const BUSY = { error: { code: 'DATABASE_BUSY', message: 'The database is busy — please try again in a moment.' } };

  it('is told for a read, a change, an upload and a download; the caller still gets the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(BUSY, 503)));
    const told: ApiError[] = [];
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 't', onDatabaseBusy: (e) => told.push(e) });
    await expect(api.get('/tasks')).rejects.toMatchObject({ status: 503, code: 'DATABASE_BUSY', message: 'The database is busy — please try again in a moment.' });
    await api.post('/tasks', { title: 'x' }).catch(() => undefined);
    await api.upload('/tasks/t1/attachments', new FormData()).catch(() => undefined);
    await api.getBlob('/reports/tasks.xlsx').catch(() => undefined);
    await api.getText('/reports/tasks.csv').catch(() => undefined);
    expect(told.map((e) => e.code)).toEqual(['DATABASE_BUSY', 'DATABASE_BUSY', 'DATABASE_BUSY', 'DATABASE_BUSY', 'DATABASE_BUSY']);
  });

  it('is not told for any other answer (a proxy’s own 503 page, a 500), and a listener that fails changes nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Service Unavailable</html>', { status: 503 })));
    const told: unknown[] = [];
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 't', onDatabaseBusy: (e) => { told.push(e); throw new Error('boom'); } });
    await expect(api.get('/tasks')).rejects.toMatchObject({ status: 503 });
    expect(told).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(BUSY, 503)));
    await expect(api.get('/tasks')).rejects.toMatchObject({ code: 'DATABASE_BUSY' });
    expect(told).toHaveLength(1);
  });
});
