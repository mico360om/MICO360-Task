// Batch 2 (review findings 4, 5, 6, 7 and the poll's unread marker): every renewal, request, replay and
// saved copy belongs to the person — and the server — it was made for. Built from the verification repros
// (verify35/repro/B/ext), turned round to the fixed behaviour; Android's design is the model.
import { describe, it, expect, vi } from 'vitest';
import { createAuth, createTokenStore } from './auth.js';
import { signOut, startSession, clearUserData } from './session.js';
import { createReadCache } from './read-cache.js';
import { enqueue, flushQueue, makePerformMutation } from './queue.js';
import { pollNotifications } from './background-poll.js';
import { SessionChangedError } from './errors.js';
import { fakeStorage, jsonRes, fakeJwt } from './test-helpers.js';

const API = 'https://task.mico360.com/api/v1';
const OTHER = 'https://staging.example.com/api/v1';
const A = { id: 'uA', email: 'a@x.test', username: 'ann', roles: [], avatarUrl: null };
const B = { id: 'uB', email: 'b@x.test', username: 'bob', roles: [], avatarUrl: null };

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}
function signedInAsA({ accessToken = 'aA0' } = {}) {
  const local = fakeStorage({ refreshToken: 'rA1', sessionUserId: 'uA', sessionApiBase: API, sessionUser: A, cacheOwner: 'uA', apiBase: API });
  const session = fakeStorage(accessToken ? { accessToken } : {});
  return { local, session };
}
const startB = (s) => startSession(s, { accessToken: 'aB', refreshToken: 'rB', userId: 'uB', apiBase: API, user: B });
const logoutBodies = (calls) => calls.filter((c) => c.url.endsWith('/auth/logout')).map((c) => JSON.parse(c.body).refreshToken);
const until = (fn) => vi.waitFor(fn, { timeout: 2000 });

describe('#4 a renewal that comes back after the session changed', () => {
  function refreshHeld() {
    const reply = deferred();
    const calls = [];
    const fetchImpl = vi.fn((url, init = {}) => {
      calls.push({ url: String(url), body: init.body });
      if (String(url).endsWith('/auth/refresh')) return reply.promise;
      return Promise.resolve(jsonRes({ data: { ok: true } }));
    });
    return { reply, calls, fetchImpl };
  }

  it('signing out waits for a renewal on its way, then ends the renewed session: B then signs in and stays B', async () => {
    const s = signedInAsA();
    const { reply, calls, fetchImpl } = refreshHeld();
    const auth = createAuth({ ...s, apiBase: API, fetchImpl });
    const p = auth.refresh('aA0');
    await until(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    const out = signOut({ ...s, fetchImpl }); // under the renewal lock: it waits
    await new Promise((r) => setTimeout(r, 10));
    expect(logoutBodies(calls)).toEqual([]);
    reply.resolve(jsonRes({ data: { accessToken: 'aA2', refreshToken: 'rA2', user: A } }));
    await p;
    await out;
    expect(logoutBodies(calls)).toEqual(['rA2']); // the session the server holds now, not the spent rA1
    expect(s.local.data.refreshToken).toBeUndefined();
    expect(s.session.data.accessToken).toBeUndefined();
    await startB(s);
    expect(s.local.data).toMatchObject({ sessionUserId: 'uB', refreshToken: 'rB', sessionUser: B });
    expect(s.session.data.accessToken).toBe('aB');
  });

  it('a session changed without the lock (another server picked, an older context): the late renewal is discarded and ended', async () => {
    const s = signedInAsA();
    const { reply, calls, fetchImpl } = refreshHeld();
    const auth = createAuth({ ...s, apiBase: API, fetchImpl });
    const p = auth.refresh('aA0');
    await until(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    await clearUserData(s); // not under the lock
    await createTokenStore(s).save({ accessToken: 'aB', refreshToken: 'rB', userId: 'uB', apiBase: API, user: B });
    reply.resolve(jsonRes({ data: { accessToken: 'aA2', refreshToken: 'rA2', user: A } }));
    const r = await p;
    expect(r.token).toBeNull();
    expect(r.expired).toBe(false);
    expect(s.local.data).toMatchObject({ sessionUserId: 'uB', refreshToken: 'rB', sessionUser: B });
    expect(s.session.data.accessToken).toBe('aB');
    expect(logoutBodies(calls)).toEqual(['rA2']);
  });

  it('signed out without the lock and nobody signs in: the late renewal never signs A back in', async () => {
    const s = signedInAsA();
    const { reply, calls, fetchImpl } = refreshHeld();
    const auth = createAuth({ ...s, apiBase: API, fetchImpl });
    const p = auth.refresh('aA0');
    await until(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    await clearUserData(s);
    reply.resolve(jsonRes({ data: { accessToken: 'aA2', refreshToken: 'rA2', user: A } }));
    await p;
    expect(s.local.data.refreshToken).toBeUndefined();
    expect(s.session.data.accessToken).toBeUndefined();
    expect(logoutBodies(calls)).toEqual(['rA2']);
  });

  it('a context outside the lock already stored the very same new pair: it is used and never revoked', async () => {
    const s = signedInAsA();
    const { reply, calls, fetchImpl } = refreshHeld();
    const auth = createAuth({ ...s, apiBase: API, fetchImpl });
    const p = auth.refresh('aA0');
    await until(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    // Since 1.23.25 a logout ends the whole rotation family: revoking the pair held would end the session.
    await createTokenStore(s).saveRotated({ accessToken: 'aA2', refreshToken: 'rA2', user: A });
    reply.resolve(jsonRes({ data: { accessToken: 'aA2', refreshToken: 'rA2', user: A } }));
    const r = await p;
    expect(r.token).toBe('aA2');
    expect(logoutBodies(calls)).toEqual([]);
  });

  it('the session moved to another server meanwhile: the renewal is not kept', async () => {
    const s = signedInAsA();
    const { reply, calls, fetchImpl } = refreshHeld();
    const auth = createAuth({ ...s, apiBase: API, fetchImpl });
    const p = auth.refresh('aA0');
    await until(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    await s.local.set({ sessionApiBase: OTHER });
    reply.resolve(jsonRes({ data: { accessToken: 'aA2', refreshToken: 'rA2', user: A } }));
    await p;
    expect(s.local.data.refreshToken).toBe('rA1');
    expect(logoutBodies(calls)).toEqual(['rA2']);
  });

  it('a rejected renewal never clears a session someone started meanwhile', async () => {
    const s = signedInAsA();
    const { reply, calls, fetchImpl } = refreshHeld();
    const onExpired = vi.fn();
    const auth = createAuth({ ...s, apiBase: API, fetchImpl, onExpired });
    const p = auth.refresh('aA0');
    await until(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    await clearUserData(s);
    await createTokenStore(s).save({ accessToken: 'aB', refreshToken: 'rB', userId: 'uB', apiBase: API, user: B });
    reply.resolve(jsonRes({ error: { code: 'INVALID_REFRESH_TOKEN' } }, 401));
    const r = await p;
    expect(r.expired).toBe(false);
    expect(s.local.data).toMatchObject({ sessionUserId: 'uB', refreshToken: 'rB' });
    expect(s.session.data.accessToken).toBe('aB');
  });

  it('starting a session waits for a renewal on its way, so the renewal can never land on top of it', async () => {
    const s = signedInAsA();
    const { reply, calls, fetchImpl } = refreshHeld();
    const auth = createAuth({ ...s, apiBase: API, fetchImpl });
    const p = auth.refresh('aA0');
    await until(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    const started = startB(s);
    await new Promise((r) => setTimeout(r, 10));
    expect(s.local.data.sessionUserId).toBe('uA'); // still waiting for the lock
    reply.resolve(jsonRes({ data: { accessToken: 'aA2', refreshToken: 'rA2', user: A } }));
    await p;
    await started;
    expect(s.local.data).toMatchObject({ sessionUserId: 'uB', refreshToken: 'rB', sessionUser: B });
    expect(s.session.data.accessToken).toBe('aB');
  });
});

describe('#5 a request is only ever sent again as the person who sent it', () => {
  it('A’s POST got 401 after B signed in: not re-sent as B, the 401 stands and nobody is signed out', async () => {
    const s = signedInAsA();
    const first = deferred();
    const posts = [];
    const fetchImpl = vi.fn((url, init = {}) => {
      const u = String(url);
      if (u.endsWith('/auth/logout')) return Promise.resolve(jsonRes({ data: { ok: true } }));
      if (u.endsWith('/auth/refresh')) return Promise.resolve(jsonRes({ data: { accessToken: 'aB2', refreshToken: 'rB2', user: B } }));
      posts.push({ auth: init.headers && init.headers.Authorization, body: init.body });
      if (posts.length === 1) return first.promise;
      return Promise.resolve(jsonRes({ data: { id: 't1' } }, 201));
    });
    const onExpired = vi.fn();
    const auth = createAuth({ ...s, apiBase: API, fetchImpl, onExpired });
    const p = auth.authedFetch('/tasks', { method: 'POST', body: JSON.stringify({ projectId: 'p1', title: 'Ann’s task' }) });
    await until(() => expect(posts.length).toBe(1));
    await signOut({ ...s, fetchImpl });
    await startB(s);
    first.resolve(jsonRes({ error: { code: 'UNAUTHENTICATED' } }, 401));
    const res = await p;
    expect(res.status).toBe(401);
    expect(posts.map((x) => x.auth)).toEqual(['Bearer aA0']);
    expect(fetchImpl.mock.calls.some(([u]) => String(u).endsWith('/auth/refresh'))).toBe(false); // B’s token never spent for it
    expect(onExpired).not.toHaveBeenCalled();
    expect(s.local.data).toMatchObject({ sessionUserId: 'uB', refreshToken: 'rB' });
  });

  it('a renewed token issued to someone else (its sub) is never used to send the request again', async () => {
    const s = signedInAsA({ accessToken: fakeJwt('uA', { n: 0 }) });
    const sent = [];
    const fetchImpl = vi.fn(async (url, init = {}) => {
      if (String(url).endsWith('/auth/refresh')) return jsonRes({ data: { accessToken: fakeJwt('uB'), refreshToken: 'rX', user: A } });
      sent.push(init.headers.Authorization);
      return jsonRes({}, 401);
    });
    const auth = createAuth({ ...s, apiBase: API, fetchImpl });
    const res = await auth.authedFetch('/tasks');
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(1);
  });

  it('bound to a person (asUser) while someone else is signed in: never sent at all', async () => {
    const s = signedInAsA();
    await startB(s);
    const fetchImpl = vi.fn();
    const auth = createAuth({ ...s, apiBase: API, fetchImpl });
    const err = await auth.authedFetch('/tasks', { method: 'POST', body: '{}' }, { asUser: 'uA' }).catch((e) => e);
    expect(err).toBeInstanceOf(SessionChangedError);
    expect(err.outcome).toBe('pause');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('the same person’s renewal still sends the request again (as before)', async () => {
    const s = signedInAsA();
    const fetchImpl = vi.fn(async (url, init = {}) => {
      if (String(url).endsWith('/auth/refresh')) return jsonRes({ data: { accessToken: 'aA2', refreshToken: 'rA2', user: A } });
      return init.headers.Authorization === 'Bearer aA2' ? jsonRes({ data: 'ok' }) : jsonRes({}, 401);
    });
    const auth = createAuth({ ...s, apiBase: API, fetchImpl });
    expect((await auth.authedFetch('/tasks', {}, { asUser: 'uA' })).status).toBe(200);
  });
});

describe('#6 saved pages belong to the person and server they were read for', () => {
  it('A’s late answer lands after B’s sign-in: not saved, so B never sees it offline', async () => {
    const s = signedInAsA();
    const cache = createReadCache(s.local);
    const answer = deferred();
    const p = cache.read('tasks:mine', () => answer.promise);
    await signOut({ ...s, fetchImpl: vi.fn(async () => jsonRes({ data: { ok: true } })) });
    await startB(s);
    answer.resolve([{ id: 't-ann', title: 'Ann’s private task' }]);
    await p;
    expect(s.local.data['cache:tasks:mine']).toBeUndefined();
    await expect(cache.read('tasks:mine', () => Promise.reject(new TypeError('Failed to fetch')))).rejects.toThrow('Failed to fetch');
  });

  it('a late answer after sign-out (nobody signed in yet) is not saved either', async () => {
    const s = signedInAsA();
    const cache = createReadCache(s.local);
    const answer = deferred();
    const p = cache.read('tasks:mine', () => answer.promise);
    await signOut({ ...s, fetchImpl: vi.fn(async () => jsonRes({ data: { ok: true } })) });
    answer.resolve([{ id: 't-ann' }]);
    await p;
    expect(s.local.data['cache:tasks:mine']).toBeUndefined();
  });

  it('each copy is stamped with its person and server, and served only to them', async () => {
    const s = signedInAsA();
    const cache = createReadCache(s.local, { now: () => 7 });
    await cache.read('tasks:mine', async () => ['ann’s']);
    expect(s.local.data['cache:tasks:mine']).toEqual({ data: ['ann’s'], cachedAt: 7, owner: 'uA', apiBase: API });
    const offline = () => Promise.reject(new TypeError('Failed to fetch'));
    expect((await cache.read('tasks:mine', offline)).data).toEqual(['ann’s']);
    // Another person signed in without the copies being wiped: nothing of A's is served, peeked or changed.
    await s.local.set({ sessionUserId: 'uB' });
    await expect(cache.read('tasks:mine', offline)).rejects.toThrow('Failed to fetch');
    expect(await cache.peek('tasks:mine')).toBeUndefined();
    expect(await cache.merge('tasks:mine', { x: 1 })).toBe(false);
    expect(await cache.update('tasks:mine', () => ['changed'])).toBe(false);
    // The same person on another server: not served either.
    await s.local.set({ sessionUserId: 'uA', sessionApiBase: OTHER });
    await expect(cache.read('tasks:mine', offline)).rejects.toThrow('Failed to fetch');
  });

  it('a copy kept by an older version (no person on it) is never served', async () => {
    const s = signedInAsA();
    await s.local.set({ 'cache:tasks:mine': { data: ['whose?'], cachedAt: 1 } });
    const cache = createReadCache(s.local);
    await expect(cache.read('tasks:mine', () => Promise.reject(new TypeError('Failed to fetch')))).rejects.toThrow('Failed to fetch');
    expect(await cache.peek('tasks:mine')).toBeUndefined();
  });
});

describe('#7 a replay sends a person’s changes only as them', () => {
  async function setup() {
    const s = signedInAsA();
    await enqueue(s.local, { kind: 'task.create', payload: { projectId: 'p1', title: 'A item 1' }, userId: 'uA' });
    await enqueue(s.local, { kind: 'task.create', payload: { projectId: 'p1', title: 'A item 2' }, userId: 'uA' });
    const first = deferred();
    const posts = [];
    const fetchImpl = vi.fn((url, init = {}) => {
      const u = String(url);
      if (u.endsWith('/auth/logout')) return Promise.resolve(jsonRes({ data: { ok: true } }));
      posts.push({ auth: init.headers && init.headers.Authorization, title: JSON.parse(init.body).title });
      if (posts.length === 1) return first.promise;
      return Promise.resolve(jsonRes({ data: { id: `t${posts.length}` } }, 201));
    });
    const auth = createAuth({ ...s, apiBase: API, fetchImpl });
    // As the service worker and the app wire it: each item's requests go only as its owner.
    const perform = makePerformMutation((path, init, as) => auth.authedFetch(path, init, as));
    return { s, first, posts, fetchImpl, perform };
  }

  it('A’s session ends (queue kept) and B signs in mid-flush: A’s next change pauses, never sent as B', async () => {
    const { s, first, posts, perform } = await setup();
    const p = flushQueue(s.local, perform, { userId: 'uA' });
    await until(() => expect(posts.length).toBe(1));
    await s.session.remove('accessToken');
    await s.local.remove(['refreshToken', 'sessionUserId', 'sessionApiBase', 'sessionUser']);
    await startB(s);
    first.resolve(jsonRes({ data: { id: 't1' } }, 201));
    const result = await p;
    expect(posts.map((x) => [x.auth, x.title])).toEqual([['Bearer aA0', 'A item 1']]);
    expect(result.paused).toBe(true);
    expect(s.local.data.syncQueue.map((i) => [i.userId, i.payload.title])).toEqual([['uA', 'A item 2']]);
  });

  it('explicit sign-out empties the queue, so nothing more is sent', async () => {
    const { s, first, posts, perform, fetchImpl } = await setup();
    const p = flushQueue(s.local, perform, { userId: 'uA' });
    await until(() => expect(posts.length).toBe(1));
    await signOut({ ...s, fetchImpl });
    await startB(s);
    first.resolve(jsonRes({ data: { id: 't1' } }, 201));
    await p;
    expect(posts.map((x) => x.auth)).toEqual(['Bearer aA0']);
  });
});

describe('the background poll’s unread marker', () => {
  it('a count read while the session changed is not stamped with the person the poll began for', async () => {
    const s = signedInAsA();
    await s.local.set({ lastUnread: 2, lastUnreadUser: 'uA' });
    const setBadge = vi.fn();
    const authedFetch = vi.fn(async (path) => {
      if (path === '/notifications/unread-count') {
        await startB(s); // B signs in while A's poll waits for its answer
        return jsonRes({ data: { count: 9 } });
      }
      return jsonRes({ data: [] });
    });
    const r = await pollNotifications({ authedFetch, local: s.local, session: s.session, notifications: { create: vi.fn() }, setBadge, userId: 'uA' });
    expect(r).toBeNull();
    expect(setBadge).not.toHaveBeenCalled();
    expect(s.local.data.lastUnreadUser === 'uA' && s.local.data.lastUnread === 9).toBe(false);
  });

  it('its requests go only as the person it is for (a switch before it asks: nothing read, nothing stamped)', async () => {
    const s = signedInAsA();
    const authedFetch = vi.fn(async () => { throw new SessionChangedError(); });
    const r = await pollNotifications({ authedFetch, local: s.local, session: s.session, notifications: { create: vi.fn() }, setBadge: vi.fn(), userId: 'uA' });
    expect(r).toBeNull();
    expect(s.local.data.lastUnreadUser).toBeUndefined();
  });
});
