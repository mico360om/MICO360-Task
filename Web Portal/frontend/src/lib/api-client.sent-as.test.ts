// Batch 2: createApiClient's person binding (sentAs, forUser, the token's own `sub`), unit level.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApiClient, SessionChangedError, tokenSubject, ApiError } from './api-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
/** An unsigned JWT-shaped token with the given `sub` (the client never verifies signatures). */
function jwt(sub: string, extra: Record<string, unknown> = {}): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, ...extra })}.sig`;
}
const auths = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => ((c[1] as RequestInit).headers as Record<string, string>)['Authorization'] ?? null);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('tokenSubject', () => {
  it('reads a token’s sub, and nothing from anything else', () => {
    expect(tokenSubject(jwt('u1'))).toBe('u1');
    expect(tokenSubject(jwt('cmh7x0abc000108l4'))).toBe('cmh7x0abc000108l4');
    for (const t of [null, undefined, '', 'opaque', 'a.b.c', `x.${btoa('[1]')}.y`]) expect(tokenSubject(t)).toBeNull();
  });
});

describe('SessionChangedError', () => {
  it('is a 401 (SESSION_CHANGED), as the app’s: whatever reads a 401 as "signed out, keep it" does so for it', () => {
    const e = new SessionChangedError();
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 401, code: 'SESSION_CHANGED', name: 'SessionChangedError' });
  });
});

describe('a request bound to a person (forUser)', () => {
  it('a 401 that stands because someone else signed in meanwhile rejects as SessionChangedError (a pause, not a failure)', async () => {
    let holder: string | null = 'A';
    const fetchMock = vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const refreshTokens = vi.fn(async () => {
      holder = 'B';
      return 'changed' as const;
    });
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok', getUserId: () => holder, refreshTokens });
    await expect(api.forUser('A').post('/tasks', {})).rejects.toBeInstanceOf(SessionChangedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('…and the same when the 401 itself arrives after the switch', async () => {
    let holder: string | null = 'A';
    vi.stubGlobal('fetch', vi.fn(async () => {
      holder = 'B';
      return jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401);
    }));
    const refreshTokens = vi.fn(async () => 'refreshed' as const);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok', getUserId: () => holder, refreshTokens });
    await expect(api.forUser('A').get('/x')).rejects.toBeInstanceOf(SessionChangedError);
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it('a refused company pick whose retry would go as someone else rejects as SessionChangedError, never as the 403', async () => {
    let holder: string | null = 'A';
    const fetchMock = vi.fn(async () => {
      holder = 'B'; // B signs in while the refusal is on its way back
      return jsonResponse({ error: { code: 'COMPANY_NOT_AVAILABLE', message: 'No longer yours.' } }, 403);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onCompanyGone = vi.fn();
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok', getUserId: () => holder, getHeaders: () => ({ 'X-Company-Id': 'c1' }), onCompanyGone });
    await expect(api.forUser('A').post('/tasks', {})).rejects.toBeInstanceOf(SessionChangedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onCompanyGone).not.toHaveBeenCalled();
  });

  it('an unbound request in the same case keeps the old answer (the 403 stands; nothing re-sent)', async () => {
    let holder: string | null = 'A';
    const fetchMock = vi.fn(async () => {
      holder = 'B';
      return jsonResponse({ error: { code: 'COMPANY_NOT_AVAILABLE' } }, 403);
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok', getUserId: () => holder, getHeaders: () => ({ 'X-Company-Id': 'c1' }), onCompanyGone: vi.fn() });
    await expect(api.post('/tasks', {})).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('the session ends only for the person it was', () => {
  it('a refused renewal signs nobody out when someone else is signed in by the time it is told', async () => {
    let holder: string | null = 'A';
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401)));
    const onUnauthorized = vi.fn();
    const refreshTokens = vi.fn(async () => {
      holder = 'B';
      return 'invalid' as const;
    });
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok', getUserId: () => holder, refreshTokens, onUnauthorized });
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('…and still signs the same person out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401)));
    const onUnauthorized = vi.fn();
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => 'tok', getUserId: () => 'A', refreshTokens: async () => 'invalid' as const, onUnauthorized });
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

describe('the token’s own sub', () => {
  it('the app says A, but the renewed token is B’s: never sent with it', async () => {
    let token = jwt('A', { n: 1 });
    const fetchMock = vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const refreshTokens = vi.fn(async () => {
      token = jwt('B');
      return 'refreshed' as const;
    });
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => token, getUserId: () => 'A', refreshTokens });
    await expect(api.get('/x')).rejects.toMatchObject({ status: 401 });
    expect(auths(fetchMock)).toEqual([`Bearer ${jwt('A', { n: 1 })}`]);
  });

  it('without getUserId the token’s sub is the person: re-sent with the same person’s new token only', async () => {
    let token = jwt('A', { n: 1 });
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) =>
      ((init!.headers as Record<string, string>)['Authorization'] === `Bearer ${jwt('A', { n: 2 })}` ? jsonResponse({ data: 'ok' }) : jsonResponse({}, 401)));
    vi.stubGlobal('fetch', fetchMock);
    let next = jwt('A', { n: 2 });
    const refreshTokens = vi.fn(async () => {
      token = next;
      return 'refreshed' as const;
    });
    const api = createApiClient({ baseUrl: 'http://api.test', getToken: () => token, refreshTokens });
    expect(await api.get('/x')).toEqual({ data: 'ok' });
    // Someone else's token after the renewal: the 401 stands.
    token = jwt('A', { n: 3 });
    next = jwt('B');
    fetchMock.mockClear();
    await expect(api.get('/y')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
