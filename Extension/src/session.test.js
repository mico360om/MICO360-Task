import { describe, it, expect, vi } from 'vitest';
import { signOut, startSession, ensureSession, clearUserData } from './session.js';
import { fakeStorage, jsonRes, fakeJwt } from './test-helpers.js';

const API = 'https://task.mico360.com/api/v1';
const OTHER = 'https://staging.example.com/api/v1';

/** A signed-in device with cached data, queued work and notification markers. */
function busyDevice(extra = {}) {
  const local = fakeStorage({
    refreshToken: 'r1',
    sessionUserId: 'u1',
    sessionApiBase: API,
    apiBase: API,
    appBase: 'https://task.mico360.com',
    'mico360.theme': 'dark',
    companyTimeZone: 'Asia/Muscat',
    syncQueue: [{ id: 'q1', kind: 'comment.add', userId: 'u1', payload: { id: 't', body: 'hi' } }],
    'cache:tasks:mine': { data: [{ id: 't1', title: 'Payroll' }], cachedAt: 1 },
    'cache:conversations': { data: [], cachedAt: 1 },
    cacheOwner: 'u1',
    lastUnread: 4,
    lastUnreadUser: 'u1',
    lastSync: 123,
    ...extra,
  });
  const session = fakeStorage({ accessToken: 'a1' });
  return { local, session };
}

const USER_KEYS = ['refreshToken', 'sessionUserId', 'sessionApiBase', 'syncQueue', 'cache:tasks:mine', 'cache:conversations', 'cacheOwner', 'lastUnread', 'lastUnreadUser', 'lastSync'];

describe('signOut (XP-01)', () => {
  it('revokes the session at its server and wipes tokens, queue, cache and markers — keeping settings', async () => {
    const { local, session } = busyDevice();
    const fetchImpl = vi.fn(async () => jsonRes({ data: { ok: true } }));
    await signOut({ local, session, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${API}/auth/logout`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ refreshToken: 'r1' });
    expect(init.headers['Content-Type']).toBe('application/json');

    for (const k of USER_KEYS) expect(local.data[k]).toBeUndefined();
    expect(session.data.accessToken).toBeUndefined();
    expect(local.data.apiBase).toBe(API);
    expect(local.data['mico360.theme']).toBe('dark');
    expect(local.data.companyTimeZone).toBe('Asia/Muscat');
  });

  it('still wipes the device when the server can’t be reached', async () => {
    const { local, session } = busyDevice();
    await signOut({ local, session, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    for (const k of USER_KEYS) expect(local.data[k]).toBeUndefined();
  });

  it('clearUserData also removes a pre-upgrade access token left in local storage', async () => {
    const { local, session } = busyDevice({ accessToken: 'legacy' });
    await clearUserData({ local, session });
    expect(local.data.accessToken).toBeUndefined();
  });
});

describe('startSession', () => {
  it('stores the access token in session storage, the refresh token + owner + server in local storage', async () => {
    const local = fakeStorage();
    const session = fakeStorage();
    const r = await startSession({ local, session }, { accessToken: 'a', refreshToken: 'r', userId: 'u1', apiBase: API });
    expect(r).toEqual({ userId: 'u1' });
    expect(session.data).toEqual({ accessToken: 'a' });
    expect(local.data).toMatchObject({ refreshToken: 'r', sessionUserId: 'u1', sessionApiBase: API, cacheOwner: 'u1' });
    expect(local.data.accessToken).toBeUndefined();
  });

  it('XP-01: a different user never sees the previous user’s cached data', async () => {
    const { local, session } = busyDevice();
    await clearUserData({ local, session }); // e.g. session expired: tokens gone
    local.data['cache:tasks:mine'] = { data: ['A’s task'], cachedAt: 1 };
    local.data.cacheOwner = 'u1';
    await startSession({ local, session }, { accessToken: 'b', refreshToken: 'rb', userId: 'u2', apiBase: API });
    expect(local.data['cache:tasks:mine']).toBeUndefined();
    expect(local.data.cacheOwner).toBe('u2');
  });

  it('keeps the cache when the same user signs back in', async () => {
    const local = fakeStorage({ 'cache:tasks:mine': { data: [1], cachedAt: 1 }, cacheOwner: 'u1' });
    await startSession({ local, session: fakeStorage() }, { accessToken: 'a', refreshToken: 'r', userId: 'u1', apiBase: API });
    expect(local.data['cache:tasks:mine']).toBeDefined();
  });

  it('EXT-06: resets the unread baseline so the first poll does not announce old items', async () => {
    const local = fakeStorage({ lastUnread: 9, lastUnreadUser: 'u1', lastSync: 5 });
    await startSession({ local, session: fakeStorage() }, { accessToken: 'a', refreshToken: 'r', userId: 'u2', apiBase: API });
    expect(local.data.lastUnread).toBeUndefined();
    expect(local.data.lastUnreadUser).toBeUndefined();
    expect(local.data.lastSync).toBeUndefined();
  });

  it('falls back to the token’s subject for the user id', async () => {
    const local = fakeStorage();
    const r = await startSession({ local, session: fakeStorage() }, { accessToken: fakeJwt('u7'), refreshToken: 'r', apiBase: API });
    expect(r.userId).toBe('u7');
  });

  it('rejects an incomplete sign-in response', async () => {
    await expect(startSession({ local: fakeStorage(), session: fakeStorage() }, { accessToken: 'a', userId: 'u', apiBase: API })).rejects.toThrow();
  });
});

describe('ensureSession', () => {
  it('returns null when signed out', async () => {
    expect(await ensureSession({ local: fakeStorage(), session: fakeStorage(), apiBase: API })).toBeNull();
  });

  it('returns the user for a session issued by the configured server', async () => {
    const { local, session } = busyDevice();
    const fetchImpl = vi.fn();
    expect(await ensureSession({ local, session, apiBase: API, fetchImpl })).toEqual({ userId: 'u1', apiBase: API });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('EXT-04: after a server change, the old session is revoked at the OLD server and everything is wiped', async () => {
    const { local, session } = busyDevice();
    const fetchImpl = vi.fn(async () => jsonRes({ data: { ok: true } }));
    expect(await ensureSession({ local, session, apiBase: OTHER, fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${API}/auth/logout`);
    expect(fetchImpl.mock.calls.some(([u]) => String(u).startsWith('https://staging.example.com'))).toBe(false);
    for (const k of USER_KEYS) expect(local.data[k]).toBeUndefined();
    expect(session.data.accessToken).toBeUndefined();
  });

  it('a path change on the same server keeps the session', async () => {
    const { local, session } = busyDevice();
    expect(await ensureSession({ local, session, apiBase: 'https://task.mico360.com/api/v2', fetchImpl: vi.fn() })).not.toBeNull();
  });

  it('upgrade: a legacy session from the old localhost default must sign in again (nothing sent anywhere)', async () => {
    const local = fakeStorage({
      accessToken: fakeJwt('u1'),
      refreshToken: fakeJwt('u1', { typ: 'refresh' }),
      syncQueue: [{ id: 'old', kind: 'comment.add', payload: {} }],
      'cache:tasks:mine': { data: [], cachedAt: 1 },
    });
    const session = fakeStorage();
    const fetchImpl = vi.fn();
    expect(await ensureSession({ local, session, apiBase: API, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(local.data.accessToken).toBeUndefined();
    expect(local.data.refreshToken).toBeUndefined();
    expect(local.data.syncQueue).toBeUndefined();
    expect(local.data['cache:tasks:mine']).toBeUndefined();
  });

  it('upgrade: a legacy session for an explicitly configured server is kept and hardened', async () => {
    const access = fakeJwt('u1');
    const local = fakeStorage({
      apiBase: API,
      accessToken: access,
      refreshToken: fakeJwt('u1', { typ: 'refresh' }),
      syncQueue: [{ id: 'old', kind: 'comment.add', payload: { id: 't', body: 'x' } }],
      'cache:conversations': { data: [{ lastMessage: { body: 'secret', deletedAt: '2026-01-01' } }], cachedAt: 1 },
    });
    const session = fakeStorage();
    expect(await ensureSession({ local, session, apiBase: API, fetchImpl: vi.fn() })).toEqual({ userId: 'u1', apiBase: API });
    expect(session.data.accessToken).toBe(access); // moved off disk
    expect(local.data.accessToken).toBeUndefined();
    expect(local.data).toMatchObject({ sessionUserId: 'u1', sessionApiBase: API, cacheOwner: 'u1' });
    expect(local.data.syncQueue[0].userId).toBe('u1'); // queued work gets its owner
    expect(local.data['cache:conversations']).toBeUndefined(); // may hold deleted chat text (CHAT-01)
  });

  it('upgrade: an insecure explicitly configured server (http, not localhost) is not trusted', async () => {
    const local = fakeStorage({ apiBase: 'http://tasks.example.com/api/v1', accessToken: fakeJwt('u1'), refreshToken: 'r' });
    expect(await ensureSession({ local, session: fakeStorage(), apiBase: API, fetchImpl: vi.fn() })).toBeNull();
    expect(local.data.refreshToken).toBeUndefined();
  });
});
