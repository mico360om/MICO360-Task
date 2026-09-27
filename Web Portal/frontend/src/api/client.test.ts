import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, refreshTokens, refreshSession } from './client';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const user = { id: 'u1', email: 'a@x.test', username: 'ada', roles: [] as string[] };

beforeEach(() => {
  useAuthStore.getState().logout('remote');
  localStorage.clear();
  sessionStorage.clear();
  useAuthStore.getState().setSession({ user, accessToken: 'at1', refreshToken: 'rt1' }, { remember: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('refreshTokens (shared across tabs)', () => {
  it('uses a pair another tab already rotated instead of spending the stale refresh token', async () => {
    const fetchMock = vi.fn(async () => json({}, 401));
    vi.stubGlobal('fetch', fetchMock);
    // Another tab refreshed: localStorage now holds the new pair, this tab's memory is stale.
    localStorage.setItem('mico360.refreshToken', 'rt2');
    localStorage.setItem('mico360.accessToken', 'at2');
    expect(await refreshTokens('at1')).toBe('refreshed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().accessToken).toBe('at2');
    expect(useAuthStore.getState().refreshToken).toBe('rt2');
  });

  it('refreshes with the latest refresh token and stores the new pair', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({ data: { user, accessToken: 'at9', refreshToken: 'rt9' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await refreshTokens('at1')).toBe('refreshed');
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ refreshToken: 'rt1' });
    expect(localStorage.getItem('mico360.refreshToken')).toBe('rt9');
  });

  it('serializes refreshes with a Web Lock when the browser has one', async () => {
    const request = vi.fn(async (_name: string, cb: () => Promise<unknown>) => cb());
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { user, accessToken: 'at9', refreshToken: 'rt9' } })));
    await refreshTokens('at1');
    expect(request).toHaveBeenCalledWith('mico360-auth-refresh', expect.any(Function));
  });

  it.each([
    ['a network error', () => Promise.reject(new TypeError('offline'))],
    ['a 5xx', () => Promise.resolve(json({}, 503))],
    ['a 429', () => Promise.resolve(json({ error: { code: 'RATE_LIMITED' } }, 429))],
  ])('treats %s from /auth/refresh as transient and stays signed in', async (_label, respond) => {
    vi.stubGlobal('fetch', vi.fn(respond));
    expect(await refreshTokens('at1')).toBe('transient');
    expect(await refreshSession()).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('logs out only when /auth/refresh rejects the token (401)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'INVALID_REFRESH_TOKEN' } }, 401)));
    expect(await refreshSession()).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('a 401 on an API call followed by a 429 on refresh keeps the session', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).endsWith('/auth/refresh') ? json({ error: { code: 'RATE_LIMITED' } }, 429) : json({ error: { code: 'UNAUTHORIZED' } }, 401)));
    await expect(apiClient.get('/tasks')).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('after a 401 from /auth/refresh, retries once with a newer refresh token another tab stored', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)) as { refreshToken: string };
      bodies.push(body.refreshToken);
      if (body.refreshToken === 'rt1') {
        // Meanwhile another tab rotated rt1 → rt2 but its access token hasn't reached us (only the refresh token did).
        localStorage.setItem('mico360.refreshToken', 'rt2');
        return json({ error: { code: 'INVALID_REFRESH_TOKEN' } }, 401);
      }
      return json({ data: { user, accessToken: 'at3', refreshToken: 'rt3' } });
    }));
    expect(await refreshTokens('at1')).toBe('refreshed');
    expect(bodies).toEqual(['rt1', 'rt2']);
    expect(useAuthStore.getState().accessToken).toBe('at3');
  });
});
