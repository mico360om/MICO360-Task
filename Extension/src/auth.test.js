import { describe, it, expect, vi } from 'vitest';
import { createAuth, createTokenStore, requestHeaders } from './auth.js';
import { AuthUnavailableError } from './errors.js';
import { fakeStorage, jsonRes } from './test-helpers.js';

const API = 'https://task.mico360.com/api/v1';

/** Storage pair for a signed-in user whose access token has expired (a0) and refresh token is r1. */
function signedIn({ accessToken = 'a0', refreshToken = 'r1', apiBase = API } = {}) {
  const local = fakeStorage({ refreshToken, sessionUserId: 'u1', sessionApiBase: apiBase });
  const session = fakeStorage(accessToken ? { accessToken } : {});
  return { local, session };
}

/**
 * A backend with single-use refresh tokens (rotation), like the real one: a spent refresh token is
 * rejected with 401. Access tokens in `access` are valid.
 */
function fakeServer({ access = [], refresh = ['r1'], refreshDelayMs = 5 } = {}) {
  const s = { access: new Set(access), refresh: new Set(refresh), n: 1, calls: [], online: true };
  s.fetch = vi.fn(async (url, init = {}) => {
    if (!s.online) throw new TypeError('Failed to fetch');
    s.calls.push({ url: String(url), init });
    if (String(url).endsWith('/auth/refresh')) {
      const { refreshToken } = JSON.parse(init.body);
      await new Promise((r) => setTimeout(r, refreshDelayMs));
      if (!s.refresh.has(refreshToken)) return jsonRes({ error: { code: 'INVALID_REFRESH_TOKEN' } }, 401);
      s.refresh.delete(refreshToken);
      s.n += 1;
      const pair = { accessToken: `a${s.n}`, refreshToken: `r${s.n}` };
      s.access.add(pair.accessToken);
      s.refresh.add(pair.refreshToken);
      return jsonRes({ data: pair });
    }
    const h = init.headers || {};
    if (!h.Authorization || !s.access.has(h.Authorization.slice(7))) return jsonRes({ error: { code: 'UNAUTHENTICATED' } }, 401);
    return jsonRes({ data: 'ok' });
  });
  s.refreshCalls = () => s.calls.filter((c) => c.url.endsWith('/auth/refresh')).length;
  return s;
}

describe('token storage (EXT-07)', () => {
  it('keeps the access token in session storage and the refresh token + owner in local storage', async () => {
    const local = fakeStorage();
    const session = fakeStorage();
    const t = createTokenStore({ local, session });
    await t.save({ accessToken: 'a', refreshToken: 'r', userId: 'u1', apiBase: API });
    expect(session.data).toEqual({ accessToken: 'a' });
    expect(local.data).toEqual({ refreshToken: 'r', sessionUserId: 'u1', sessionApiBase: API });
    expect(await t.get()).toEqual({ accessToken: 'a', refreshToken: 'r', userId: 'u1', apiBase: API });
    await t.clear();
    expect(session.data).toEqual({});
    expect(local.data).toEqual({});
  });
});

describe('requestHeaders (EXT-02)', () => {
  it('declares a JSON body only when there is one', () => {
    expect(requestHeaders({ method: 'DELETE' }, 't')).toEqual({ Authorization: 'Bearer t' });
    expect(requestHeaders({ method: 'PUT' })).toEqual({});
    expect(requestHeaders({ method: 'POST', body: '{}' }, 't')).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer t' });
  });
});

describe('authedFetch', () => {
  it('sends no Content-Type on a body-less DELETE ("Unassign me") and does on a POST', async () => {
    const { local, session } = signedIn({ accessToken: 'good' });
    const fetchImpl = vi.fn(async () => jsonRes({ data: null }));
    const auth = createAuth({ local, session, apiBase: API, fetchImpl });
    await auth.authedFetch('/tasks/t1/assignees/u1', { method: 'DELETE' });
    await auth.authedFetch('/tasks', { method: 'POST', body: '{"title":"x"}' });
    const [del, post] = fetchImpl.mock.calls.map((c) => c[1].headers);
    expect(del).toEqual({ Authorization: 'Bearer good' });
    expect(del['Content-Type']).toBeUndefined();
    expect(post['Content-Type']).toBe('application/json');
  });

  it('refreshes + retries once on a 401 and stores the rotated pair', async () => {
    const server = fakeServer();
    const { local, session } = signedIn();
    const auth = createAuth({ local, session, apiBase: API, fetchImpl: server.fetch });
    const res = await auth.authedFetch('/tasks');
    expect(res.status).toBe(200);
    expect(server.calls.map((c) => c.url)).toEqual([`${API}/tasks`, `${API}/auth/refresh`, `${API}/tasks`]);
    expect(session.data.accessToken).toBe('a2');
    expect(local.data.refreshToken).toBe('r2');
    expect(local.data.accessToken).toBeUndefined();
  });

  it('does not retry when the first call succeeds', async () => {
    const server = fakeServer({ access: ['a0'] });
    const { local, session } = signedIn();
    const auth = createAuth({ local, session, apiBase: API, fetchImpl: server.fetch });
    await auth.authedFetch('/tasks');
    expect(server.calls).toHaveLength(1);
  });

  it('mints an access token first when there is none (browser restart cleared session storage)', async () => {
    const server = fakeServer();
    const { local, session } = signedIn({ accessToken: null });
    const auth = createAuth({ local, session, apiBase: API, fetchImpl: server.fetch });
    const res = await auth.authedFetch('/tasks');
    expect(res.status).toBe(200);
    expect(server.calls.map((c) => c.url)).toEqual([`${API}/auth/refresh`, `${API}/tasks`]);
  });

  it('XP-04: parallel requests in one tab spend the refresh token once', async () => {
    const server = fakeServer();
    const { local, session } = signedIn();
    const onExpired = vi.fn();
    const auth = createAuth({ local, session, apiBase: API, fetchImpl: server.fetch, onExpired });
    const results = await Promise.all([auth.authedFetch('/a'), auth.authedFetch('/b'), auth.authedFetch('/c')]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(server.refreshCalls()).toBe(1);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('XP-04: the app tab and the service worker share one refresh (the second re-reads the rotated token)', async () => {
    const server = fakeServer({ refreshDelayMs: 20 });
    const { local, session } = signedIn();
    const onExpired = vi.fn();
    const page = createAuth({ local, session, apiBase: API, fetchImpl: server.fetch, onExpired });
    const worker = createAuth({ local, session, apiBase: API, fetchImpl: server.fetch, onExpired });
    const [a, b] = await Promise.all([page.authedFetch('/tasks/mine'), worker.authedFetch('/notifications/unread-count')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(server.refreshCalls()).toBe(1);
    expect(onExpired).not.toHaveBeenCalled();
    expect(local.data.refreshToken).toBe('r2');
  });

  it('shares the refresh across contexts with the in-process lock fallback too', async () => {
    const server = fakeServer({ refreshDelayMs: 20 });
    const { local, session } = signedIn();
    const page = createAuth({ local, session, apiBase: API, fetchImpl: server.fetch, locks: null });
    const worker = createAuth({ local, session, apiBase: API, fetchImpl: server.fetch, locks: null });
    const [a, b] = await Promise.all([page.authedFetch('/x'), worker.authedFetch('/y')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(server.refreshCalls()).toBe(1);
  });

  it('XP-04: a rejected refresh ends the session (tokens cleared, onExpired) — not "offline"', async () => {
    const server = fakeServer({ refresh: [] }); // r1 no longer valid (revoked / expired)
    const { local, session } = signedIn();
    const onExpired = vi.fn();
    const auth = createAuth({ local, session, apiBase: API, fetchImpl: server.fetch, onExpired });
    const res = await auth.authedFetch('/tasks');
    expect(res.status).toBe(401);
    expect(onExpired).toHaveBeenCalled();
    expect(local.data.refreshToken).toBeUndefined();
    expect(session.data.accessToken).toBeUndefined();
  });

  it('a network failure while renewing is NOT an expiry: tokens are kept and the call rejects like offline', async () => {
    const { local, session } = signedIn();
    const onExpired = vi.fn();
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith('/auth/refresh')) throw new TypeError('Failed to fetch');
      return jsonRes({}, 401);
    });
    const auth = createAuth({ local, session, apiBase: API, fetchImpl, onExpired });
    await expect(auth.authedFetch('/tasks')).rejects.toBeInstanceOf(AuthUnavailableError);
    expect(onExpired).not.toHaveBeenCalled();
    expect(local.data.refreshToken).toBe('r1');
  });

  it('a 5xx from /auth/refresh is transient too', async () => {
    const { local, session } = signedIn();
    const fetchImpl = vi.fn(async (url) => (String(url).endsWith('/auth/refresh') ? jsonRes({}, 503) : jsonRes({}, 401)));
    const auth = createAuth({ local, session, apiBase: API, fetchImpl });
    await expect(auth.authedFetch('/tasks')).rejects.toBeInstanceOf(AuthUnavailableError);
    expect(local.data.refreshToken).toBe('r1');
  });

  it('EXT-04: never sends a session to a server other than the one that issued it', async () => {
    const { local, session } = signedIn({ accessToken: 'good', apiBase: API });
    const fetchImpl = vi.fn(async () => jsonRes({ data: 'ok' }));
    const onExpired = vi.fn();
    const auth = createAuth({ local, session, apiBase: 'https://evil.example.com/api/v1', fetchImpl, onExpired });
    const res = await auth.authedFetch('/tasks');
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onExpired).toHaveBeenCalled();
  });

  it('treats a missing session as signed out', async () => {
    const fetchImpl = vi.fn();
    const onExpired = vi.fn();
    const auth = createAuth({ local: fakeStorage(), session: fakeStorage(), apiBase: API, fetchImpl, onExpired });
    expect((await auth.authedFetch('/tasks')).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onExpired).toHaveBeenCalled();
  });
});
