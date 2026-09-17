import { describe, it, expect } from 'vitest';
import { getTokens, refreshSession, authedFetch } from './auth.js';

/** Minimal in-memory chrome.storage.local stand-in. */
function fakeStorage(initial = {}) {
  let data = { ...initial };
  return {
    async get(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(arr.map((k) => [k, data[k]]));
    },
    async set(patch) { data = { ...data, ...patch }; },
    _data: () => data,
  };
}
function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

describe('extension auth', () => {
  it('reads stored tokens', async () => {
    const s = fakeStorage({ accessToken: 'a', refreshToken: 'r' });
    expect(await getTokens(s)).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('refreshes the session and persists the rotated tokens', async () => {
    const s = fakeStorage({ accessToken: 'old', refreshToken: 'r1' });
    const fetchImpl = async () => jsonResponse({ data: { accessToken: 'new', refreshToken: 'r2' } });
    const token = await refreshSession(s, 'http://api', fetchImpl);
    expect(token).toBe('new');
    expect(s._data().accessToken).toBe('new');
    expect(s._data().refreshToken).toBe('r2');
  });

  it('returns null when there is no refresh token or the refresh fails', async () => {
    expect(await refreshSession(fakeStorage({}), 'http://api', async () => jsonResponse({}, 200))).toBeNull();
    const s = fakeStorage({ refreshToken: 'r' });
    expect(await refreshSession(s, 'http://api', async () => jsonResponse({ error: 'x' }, 401))).toBeNull();
  });

  it('authedFetch refreshes + retries once on a 401', async () => {
    const s = fakeStorage({ accessToken: 'expired', refreshToken: 'r1' });
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, auth: opts.headers?.Authorization });
      if (url.endsWith('/auth/refresh')) return jsonResponse({ data: { accessToken: 'fresh', refreshToken: 'r2' } });
      // first data call (expired) → 401, second (fresh) → 200
      return opts.headers?.Authorization === 'Bearer fresh' ? jsonResponse({ data: [] }) : jsonResponse({}, 401);
    };
    const res = await authedFetch(s, 'http://api', '/tasks', {}, fetchImpl);
    expect(res.status).toBe(200);
    expect(s._data().accessToken).toBe('fresh');
    // called: /tasks(401) → /auth/refresh → /tasks(200)
    expect(calls.map((c) => c.url)).toEqual(['http://api/tasks', 'http://api/auth/refresh', 'http://api/tasks']);
  });

  it('does not retry when the first call succeeds', async () => {
    const s = fakeStorage({ accessToken: 'good', refreshToken: 'r' });
    let n = 0;
    const fetchImpl = async () => { n++; return jsonResponse({ data: [] }); };
    await authedFetch(s, 'http://api', '/tasks', {}, fetchImpl);
    expect(n).toBe(1);
  });
});
