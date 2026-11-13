// Batch 2 (review findings 4, 5, 7, 9 + N5): every request, refresh, replay and saved chat text belongs
// to the person who started it. Built from the verification repros (verify35/repro/B/web), turned round
// to the fixed behaviour. The Android app's design (sentAs, the 'changed' refresh outcome, forUser) is the model.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, refreshTokens, REFRESH_TIMEOUT_MS } from '../api/client';
import { handleAuthMessage, useAuthStore } from '../stores/auth-store';
import { enqueueOffline, flushOfflineQueue } from './offline-replay';
import { loadDraft, saveDraft } from './chat-model';
import { keepInOutbox, loadOutbox } from './chat-outbox';
import { unsentChangeCount } from './useSignOut';
import { ApiError } from './api-client';
import { inspectionOutbox } from './inspection-sync';
import type { InspectionDetail } from '../api/inspections';

const A = { id: 'userA', email: 'a@x.test', username: 'ann', roles: [] as string[] };
const B = { id: 'userB', email: 'b@x.test', username: 'bob', roles: [] as string[] };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
type Call = { url: string; method: string; auth: string | null; body: string | null };
const header = (init: RequestInit | undefined, name: string) => ((init?.headers ?? {}) as Record<string, string>)[name] ?? null;
const revoked = (calls: Call[]) => calls.filter((c) => c.url.endsWith('/auth/logout')).map((c) => (JSON.parse(c.body!) as { refreshToken: string }).refreshToken);

/** A fetch that holds /auth/refresh until `reply` resolves and records every call. */
function stubFetch(reply: Promise<Response>, other: (url: string, init?: RequestInit) => Response = () => json({ data: { ok: true } })) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', auth: header(init, 'Authorization'), body: (init?.body as string) ?? null });
    if (String(url).endsWith('/auth/refresh')) return reply;
    return Promise.resolve(other(String(url), init));
  }));
  return calls;
}

beforeEach(() => {
  useAuthStore.getState().logout('remote');
  localStorage.clear();
  sessionStorage.clear();
  useAuthStore.getState().setSession({ user: A, accessToken: 'atA', refreshToken: 'rtA' }, { remember: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('#4 a renewal that comes back after the session changed', () => {
  it('A logs out and B signs in while A’s renewal is on its way: B stays, A’s new token is revoked', async () => {
    const reply = deferred<Response>();
    const calls = stubFetch(reply.promise);
    const p = refreshTokens('atA');
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    useAuthStore.getState().logout('user');
    useAuthStore.getState().setSession({ user: B, accessToken: 'atB', refreshToken: 'rtB' }, { remember: true });
    reply.resolve(json({ data: { user: A, accessToken: 'atA2', refreshToken: 'rtA2' } }));
    expect(await p).toBe('changed');
    const s = useAuthStore.getState();
    expect(s.user?.id).toBe('userB');
    expect(s.accessToken).toBe('atB');
    expect(localStorage.getItem('mico360.refreshToken')).toBe('rtB');
    expect(revoked(calls)).toEqual(['rtA', 'rtA2']);
  });

  it('A logs out and nobody signs in: A stays signed out, and the renewed token is revoked', async () => {
    const reply = deferred<Response>();
    const calls = stubFetch(reply.promise);
    const p = refreshTokens('atA');
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    useAuthStore.getState().logout('user');
    reply.resolve(json({ data: { user: A, accessToken: 'atA2', refreshToken: 'rtA2' } }));
    expect(await p).toBe('changed');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(localStorage.getItem('mico360.accessToken')).toBeNull();
    expect(revoked(calls)).toContain('rtA2');
  });

  it('another tab logged out (its storage event not seen here yet): the renewal is not stored, and is revoked', async () => {
    const reply = deferred<Response>();
    const calls = stubFetch(reply.promise);
    const p = refreshTokens('atA');
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    for (const k of ['mico360.accessToken', 'mico360.refreshToken', 'mico360.user']) localStorage.removeItem(k);
    reply.resolve(json({ data: { user: A, accessToken: 'atA2', refreshToken: 'rtA2' } }));
    expect(await p).toBe('changed');
    expect(localStorage.getItem('mico360.accessToken')).toBeNull();
    expect(useAuthStore.getState().accessToken).not.toBe('atA2');
    expect(revoked(calls)).toEqual(['rtA2']);
  });

  it('another tab signed in as B (not seen here yet): A’s renewal never replaces B’s stored session', async () => {
    const reply = deferred<Response>();
    const calls = stubFetch(reply.promise);
    const p = refreshTokens('atA');
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    localStorage.setItem('mico360.refreshToken', 'rtB');
    localStorage.setItem('mico360.user', JSON.stringify(B));
    localStorage.setItem('mico360.accessToken', 'atB');
    reply.resolve(json({ data: { user: A, accessToken: 'atA2', refreshToken: 'rtA2' } }));
    expect(await p).toBe('changed');
    expect(localStorage.getItem('mico360.accessToken')).toBe('atB');
    expect(localStorage.getItem('mico360.refreshToken')).toBe('rtB');
    expect(revoked(calls)).toEqual(['rtA2']);
  });

  it('the same person already holds a newer pair (another tab’s, adopted meanwhile): it is kept and the late one revoked', async () => {
    const reply = deferred<Response>();
    const calls = stubFetch(reply.promise);
    const p = refreshTokens('atA');
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    localStorage.setItem('mico360.refreshToken', 'rtA9');
    localStorage.setItem('mico360.accessToken', 'atA9');
    handleAuthMessage({ type: 'session', session: { user: A, accessToken: 'atA9', refreshToken: 'rtA9' }, remember: true });
    reply.resolve(json({ data: { user: A, accessToken: 'atA2', refreshToken: 'rtA2' } }));
    expect(await p).toBe('refreshed');
    expect(useAuthStore.getState().accessToken).toBe('atA9');
    expect(useAuthStore.getState().refreshToken).toBe('rtA9');
    expect(localStorage.getItem('mico360.refreshToken')).toBe('rtA9');
    expect(revoked(calls)).toEqual(['rtA2']);
  });

  it('another tab already holds the very same new pair (the server hands a retried renewal the same one): kept, never revoked', async () => {
    const reply = deferred<Response>();
    const calls = stubFetch(reply.promise);
    const p = refreshTokens('atA');
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    // Since 1.23.25 a logout ends the whole rotation family: revoking this pair would sign the person out everywhere.
    localStorage.setItem('mico360.refreshToken', 'rtA2');
    localStorage.setItem('mico360.accessToken', 'atA2');
    reply.resolve(json({ data: { user: A, accessToken: 'atA2', refreshToken: 'rtA2' } }));
    expect(await p).toBe('refreshed');
    expect(useAuthStore.getState().refreshToken).toBe('rtA2');
    expect(revoked(calls)).toEqual([]);
  });

  it('…and the same when it reached this tab first by a broadcast', async () => {
    const reply = deferred<Response>();
    const calls = stubFetch(reply.promise);
    const p = refreshTokens('atA');
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    localStorage.setItem('mico360.refreshToken', 'rtA2');
    localStorage.setItem('mico360.accessToken', 'atA2');
    handleAuthMessage({ type: 'session', session: { user: A, accessToken: 'atA2', refreshToken: 'rtA2' }, remember: true });
    reply.resolve(json({ data: { user: A, accessToken: 'atA2', refreshToken: 'rtA2' } }));
    expect(await p).toBe('refreshed');
    expect(revoked(calls)).toEqual([]);
  });

  it('a request sent while nobody was signed in is never renewed or sent again (and signs nobody out)', async () => {
    useAuthStore.getState().logout('user');
    const calls = stubFetch(Promise.resolve(json({ data: { user: B, accessToken: 'atB2', refreshToken: 'rtB2' } })), () => json({ error: { code: 'UNAUTHORIZED' } }, 401));
    const p = apiClient.get('/config').catch((e: unknown) => e);
    // Someone signs in on this tab before the answer comes back.
    useAuthStore.getState().setSession({ user: B, accessToken: 'atB', refreshToken: 'rtB' }, { remember: true });
    expect(await p).toBeInstanceOf(ApiError);
    expect(calls.filter((c) => c.url.endsWith('/config')).map((c) => c.auth)).toEqual([null]);
    expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(false);
    expect(useAuthStore.getState().user?.id).toBe('userB');
  });

  it('…nor, still signed out here, does its 401 end the session another tab just stored', async () => {
    useAuthStore.getState().logout('user');
    const calls = stubFetch(Promise.resolve(json({ data: { ok: true } })), () => json({ error: { code: 'UNAUTHORIZED' } }, 401));
    const p = apiClient.get('/config').catch((e: unknown) => e);
    // B signs in in another tab ("Keep me signed in"); this tab hasn't seen its storage event yet.
    localStorage.setItem('mico360.refreshToken', 'rtB');
    localStorage.setItem('mico360.user', JSON.stringify(B));
    localStorage.setItem('mico360.accessToken', 'atB');
    expect(await p).toBeInstanceOf(ApiError);
    expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(false);
    expect(localStorage.getItem('mico360.accessToken')).toBe('atB');
    expect(localStorage.getItem('mico360.refreshToken')).toBe('rtB');
  });

  it('a renewal for someone else than the session held here (a reply for another account) is never stored', async () => {
    stubFetch(Promise.resolve(json({ data: { user: B, accessToken: 'atB2', refreshToken: 'rtB2' } })));
    expect(await refreshTokens('atA')).not.toBe('refreshed');
    expect(useAuthStore.getState().user?.id).toBe('userA');
    expect(localStorage.getItem('mico360.refreshToken')).toBe('rtA');
  });

  it('a 200 that is not a session (a Wi-Fi page) is never stored', async () => {
    stubFetch(Promise.resolve(json({ data: { hello: 'portal' } })));
    expect(await refreshTokens('atA')).toBe('transient');
    expect(useAuthStore.getState().refreshToken).toBe('rtA');
  });

  it('the renewal gives up after REFRESH_TIMEOUT_MS: a passing problem, still signed in', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let aborted = false;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      });
    })));
    const p = refreshTokens('atA');
    await vi.advanceTimersByTimeAsync(10);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS);
    expect(await p).toBe('transient');
    expect(aborted).toBe(true);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(REFRESH_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(REFRESH_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it('batch 1’s gap: a logout landing just after the renewal’s last server check — the 200 reply’s access token (good for 15 min) is never kept or used', async () => {
    const reply = deferred<Response>();
    const calls = stubFetch(reply.promise, (url, init) => (header(init, 'Authorization') === 'Bearer atA' ? json({ error: { code: 'UNAUTHORIZED' } }, 401) : json({ data: [] })));
    const p = apiClient.get('/tasks').catch((e: unknown) => e);
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    useAuthStore.getState().logout('user'); // reaches the server after its last check: the renewal still answers 200
    reply.resolve(json({ data: { user: A, accessToken: 'atA-late', refreshToken: 'rtA-late' } }));
    expect(await p).toBeInstanceOf(ApiError);
    await apiClient.get('/config').catch(() => undefined); // a later request on this signed-out page
    expect(calls.filter((c) => c.auth === 'Bearer atA-late')).toEqual([]);
    const everything = [...Object.values({ ...localStorage }), ...Object.values({ ...sessionStorage })].join('\n');
    expect(everything).not.toContain('atA-late');
    expect(everything).not.toContain('rtA-late');
    expect(useAuthStore.getState()).toMatchObject({ accessToken: null, refreshToken: null, isAuthenticated: false });
    expect(revoked(calls)).toContain('rtA-late');
  });

  it('a request whose renewal came back "changed" is not sent again and logs nobody out', async () => {
    const reply = deferred<Response>();
    const calls = stubFetch(reply.promise, (url, init) => (header(init, 'Authorization') === 'Bearer atA' ? json({ error: { code: 'UNAUTHORIZED' } }, 401) : json({ data: [] })));
    const p = apiClient.get('/tasks').catch((e: unknown) => e);
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    useAuthStore.getState().logout('user');
    useAuthStore.getState().setSession({ user: B, accessToken: 'atB', refreshToken: 'rtB' }, { remember: true });
    reply.resolve(json({ data: { user: A, accessToken: 'atA2', refreshToken: 'rtA2' } }));
    const err = await p;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(calls.filter((c) => c.url.endsWith('/tasks')).map((c) => c.auth)).toEqual(['Bearer atA']);
    expect(useAuthStore.getState().user?.id).toBe('userB');
    expect(useAuthStore.getState().endedBy).toBeNull();
  });
});

describe('#5 a request is only ever sent again as the person who sent it', () => {
  it('A’s POST got 401; A logs out and B signs in while the renewal is on its way: never re-sent as B', async () => {
    const reply = deferred<Response>();
    const posts: Call[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/auth/refresh')) return reply.promise;
      if (u.endsWith('/auth/logout')) return Promise.resolve(json({ data: { ok: true } }));
      posts.push({ url: u, method: init?.method ?? 'GET', auth: header(init, 'Authorization'), body: (init?.body as string) ?? null });
      return Promise.resolve(header(init, 'Authorization') === 'Bearer atA' ? json({ error: { code: 'UNAUTHORIZED' } }, 401) : json({ data: { id: 't1' } }, 201));
    }));
    const p = apiClient.post('/tasks', { projectId: 'p1', title: 'Ann’s private task' }).catch((e: unknown) => e);
    await vi.waitFor(() => expect(posts.length).toBe(1));
    await new Promise((r) => setTimeout(r, 5));
    useAuthStore.getState().logout('user');
    useAuthStore.getState().setSession({ user: B, accessToken: 'atB', refreshToken: 'rtB' }, { remember: true });
    reply.resolve(json({ error: { code: 'INVALID_REFRESH_TOKEN' } }, 401));
    const err = await p;
    expect(err).toBeInstanceOf(ApiError);
    expect(posts.map((c) => c.auth)).toEqual(['Bearer atA']);
    expect(useAuthStore.getState().user?.id).toBe('userB'); // and nobody was logged out
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('the 401 itself arrives after B signed in: not re-sent, and no renewal is spent for it', async () => {
    const first = deferred<Response>();
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', auth: header(init, 'Authorization'), body: (init?.body as string) ?? null });
      if (String(url).endsWith('/auth/logout')) return Promise.resolve(json({ data: { ok: true } }));
      if (calls.filter((c) => c.url.endsWith('/tasks')).length === 1) return first.promise;
      return Promise.resolve(json({ data: { id: 't1' } }, 201));
    }));
    const p = apiClient.post('/tasks', { projectId: 'p1', title: 'Ann’s private task' }).catch((e: unknown) => e);
    await vi.waitFor(() => expect(calls.length).toBe(1));
    useAuthStore.getState().logout('user');
    useAuthStore.getState().setSession({ user: B, accessToken: 'atB', refreshToken: 'rtB' }, { remember: true });
    first.resolve(json({ error: { code: 'UNAUTHORIZED' } }, 401));
    expect(await p).toBeInstanceOf(ApiError);
    expect(calls.filter((c) => c.url.endsWith('/tasks')).map((c) => c.auth)).toEqual(['Bearer atA']);
    expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(false);
    expect(useAuthStore.getState().user?.id).toBe('userB');
  });

  it('a tab that adopts B’s session from another tab never re-sends A’s request with it', async () => {
    const first = deferred<Response>();
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', auth: header(init, 'Authorization'), body: (init?.body as string) ?? null });
      if (calls.filter((c) => c.url.endsWith('/tasks')).length === 1) return first.promise;
      return Promise.resolve(json({ data: { id: 't1' } }, 201));
    }));
    const p = apiClient.post('/tasks', { title: 'x' }).catch((e: unknown) => e);
    await vi.waitFor(() => expect(calls.length).toBe(1));
    // B signed in in another tab ("Keep me signed in"): this tab follows the shared storage.
    useAuthStore.setState({ user: B, accessToken: 'atB', refreshToken: 'rtB', isAuthenticated: true, remember: true });
    first.resolve(json({ error: { code: 'UNAUTHORIZED' } }, 401));
    expect(await p).toBeInstanceOf(ApiError);
    expect(calls.filter((c) => c.url.endsWith('/tasks')).map((c) => c.auth)).toEqual(['Bearer atA']);
  });

  it('A signs out and back in as A while the renewal is on its way: the request goes again as A', async () => {
    const reply = deferred<Response>();
    const posts: Call[] = [];
    const all: Call[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      const c = { url: u, method: init?.method ?? 'GET', auth: header(init, 'Authorization'), body: (init?.body as string) ?? null };
      all.push(c);
      if (u.endsWith('/auth/refresh')) return reply.promise;
      if (u.endsWith('/auth/logout')) return Promise.resolve(json({ data: { ok: true } }));
      posts.push(c);
      return Promise.resolve(header(init, 'Authorization') === 'Bearer atA' ? json({ error: { code: 'UNAUTHORIZED' } }, 401) : json({ data: { id: 't1' } }, 201));
    }));
    const p = apiClient.post<{ data: { id: string } }>('/tasks', { title: 'x' });
    await vi.waitFor(() => expect(all.some((c) => c.url.endsWith('/auth/refresh'))).toBe(true));
    useAuthStore.getState().logout('user');
    useAuthStore.getState().setSession({ user: A, accessToken: 'atA3', refreshToken: 'rtA3' }, { remember: true });
    reply.resolve(json({ data: { user: A, accessToken: 'atA2', refreshToken: 'rtA2' } }));
    expect((await p).data.id).toBe('t1');
    expect(posts.map((c) => c.auth)).toEqual(['Bearer atA', 'Bearer atA3']);
    expect(useAuthStore.getState().refreshToken).toBe('rtA3');
    expect(revoked(all)).toContain('rtA2');
  });

  it('a renewal never spends another person’s refresh token found in shared storage', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).endsWith('/auth/refresh')) return json({ data: { ok: true } });
      const body = JSON.parse(String(init!.body)) as { refreshToken: string };
      bodies.push(body.refreshToken);
      // Meanwhile B signed in in another tab; this tab hasn't seen it yet.
      localStorage.setItem('mico360.refreshToken', 'rtB');
      localStorage.setItem('mico360.user', JSON.stringify(B));
      return json({ error: { code: 'INVALID_REFRESH_TOKEN' } }, 401);
    }));
    expect(await refreshTokens('atA', 'userA')).not.toBe('refreshed');
    expect(bodies).toEqual(['rtA']);
  });
});

describe('#7 offline replay only sends a person’s own changes', () => {
  function stubTasks(first: Promise<Response>) {
    const posts: Call[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/auth/logout')) return Promise.resolve(json({ data: { ok: true } }));
      posts.push({ url: u, method: init?.method ?? 'GET', auth: header(init, 'Authorization'), body: (init?.body as string) ?? null });
      if (posts.length === 1) return first;
      return Promise.resolve(json({ data: { id: `t${posts.length}`, key: `MICO-${posts.length}` } }, 201));
    }));
    return posts;
  }

  it('A’s session ends (expired) and B signs in mid-flush: A’s next change waits for A, never sent as B', async () => {
    enqueueOffline('task.create', { projectId: 'p1', title: 'A item 1' });
    enqueueOffline('task.create', { projectId: 'p1', title: 'A item 2' });
    const first = deferred<Response>();
    const posts = stubTasks(first.promise);
    const p = flushOfflineQueue();
    await vi.waitFor(() => expect(posts.length).toBe(1));
    useAuthStore.getState().logout('expired'); // items are kept by design
    useAuthStore.getState().setSession({ user: B, accessToken: 'atB', refreshToken: 'rtB' }, { remember: true });
    first.resolve(json({ data: { id: 't1', key: 'MICO-1' } }, 201));
    await p;
    expect(posts.map((c) => [c.auth, (JSON.parse(c.body!) as { title: string }).title])).toEqual([['Bearer atA', 'A item 1']]);
    const kept = JSON.parse(localStorage.getItem('mico360.syncQueue') ?? '[]') as Array<{ ownerId: string; payload: { title: string } }>;
    expect(kept.map((i) => [i.ownerId, i.payload.title])).toEqual([['userA', 'A item 2']]);
  });

  it('an explicit log out removes A’s items first, so the rest of the flush sends nothing as B', async () => {
    enqueueOffline('task.create', { projectId: 'p1', title: 'A item 1' });
    enqueueOffline('task.create', { projectId: 'p1', title: 'A item 2' });
    const first = deferred<Response>();
    const posts = stubTasks(first.promise);
    const p = flushOfflineQueue();
    await vi.waitFor(() => expect(posts.length).toBe(1));
    useAuthStore.getState().logout('user');
    useAuthStore.getState().setSession({ user: B, accessToken: 'atB', refreshToken: 'rtB' }, { remember: true });
    first.resolve(json({ data: { id: 't1', key: 'MICO-1' } }, 201));
    await p;
    expect(posts.map((c) => c.auth)).toEqual(['Bearer atA']);
  });

  it('A’s own flush after A signs in again sends the kept item as A', async () => {
    enqueueOffline('task.create', { projectId: 'p1', title: 'A item 1' });
    useAuthStore.getState().logout('expired');
    useAuthStore.getState().setSession({ user: A, accessToken: 'atA5', refreshToken: 'rtA5' }, { remember: true });
    const posts = stubTasks(Promise.resolve(json({ data: { id: 't1', key: 'MICO-1' } }, 201)));
    const res = await flushOfflineQueue();
    expect(res.synced).toBe(1);
    expect(posts.map((c) => c.auth)).toEqual(['Bearer atA5']);
  });
});

describe('#7 the inspection outbox sends a person’s answers only as them', () => {
  function inspection(id: string): InspectionDetail {
    return {
      id, projectId: 'p1', title: `Check ${id}`, status: 'IN_PROGRESS', place: null, startedAt: '2026-11-13T08:00:00.000Z', finishedAt: null,
      inspector: { id: 'userA', name: 'Ann' }, counts: { total: 1, answered: 0, passed: 0, failed: 0, na: 0 }, result: '0 of 1 answered',
      clientVisible: false, task: null, description: null, formId: 'f1', formVersion: 1,
      structure: { sections: [{ id: 's1', title: 'S', items: [{ id: 'v', kind: 'CHECK', label: 'Valves closed', help: null }] }], clientSignature: 'NONE', supervisorSignature: 'NONE' },
      startedBy: { id: 'userA', name: 'Ann' }, answers: [], signatures: [], followUps: [],
      permissions: { canAnswer: true, canFinish: true, canReopen: false, canTakeOver: false, canDelete: true, canShowToClient: false, canMakeFollowUps: true },
      signatureRoles: { allowed: ['INSPECTOR'], required: ['INSPECTOR'] }, revision: 0,
    } as unknown as InspectionDetail;
  }

  it('A’s session ends (expired: kept on purpose) and B signs in mid-flush: A’s next inspection is never sent as B', async () => {
    for (const id of ['i1', 'i2']) {
      inspectionOutbox.remember('userA', inspection(id));
      inspectionOutbox.saveAnswer('userA', id, { itemId: 'v', result: 'PASS', reading: null, note: null });
    }
    const first = deferred<Response>();
    const sent: Call[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (!u.includes('/inspections/')) return Promise.resolve(json({ data: { ok: true } }));
      sent.push({ url: u, method: init?.method ?? 'GET', auth: header(init, 'Authorization'), body: null });
      if (sent.length === 1) return first.promise;
      return Promise.resolve(json({ error: { code: 'SERVER' } }, 500));
    }));
    const p = inspectionOutbox.flushAll('userA', { force: true });
    await vi.waitFor(() => expect(sent.length).toBe(1));
    useAuthStore.getState().logout('expired');
    useAuthStore.getState().setSession({ user: B, accessToken: 'atB', refreshToken: 'rtB' }, { remember: true });
    first.resolve(json({ error: { code: 'SERVER' } }, 500)); // i1 waits for a later try; the flush goes on
    await p;
    expect(sent.filter((c) => c.auth === 'Bearer atB')).toEqual([]);
    expect(sent.map((c) => c.auth)).toEqual(['Bearer atA']);
    expect(inspectionOutbox.waiting('userA').length).toBe(2); // both kept for A
  });
});

describe('#9 + N5 chat drafts and the chat outbox across a log out', () => {
  it('a draft is kept for its person: after A logs out, B on the same browser never sees it', () => {
    saveDraft('userA', 'conv-shared', 'Ann’s unsent words');
    expect(loadDraft('userA', 'conv-shared')).toBe('Ann’s unsent words');
    useAuthStore.getState().logout('user');
    expect(Object.values({ ...localStorage })).not.toContain('Ann’s unsent words');
    useAuthStore.getState().setSession({ user: B, accessToken: 'atB', refreshToken: 'rtB' }, { remember: true });
    expect(loadDraft('userB', 'conv-shared')).toBe('');
  });

  it('a draft is gone after a session ends too (the next person may sign in here)', () => {
    saveDraft('userA', 'c1', 'still typing');
    useAuthStore.getState().logout('expired');
    expect(loadDraft('userA', 'c1')).toBe('');
  });

  it('an old draft kept by conversation only is never read again, and goes at sign-out', () => {
    localStorage.setItem('mico360.chat.draft.conv-shared', 'someone’s old words');
    expect(loadDraft('userA', 'conv-shared')).toBe('');
    expect(loadDraft('userB', 'conv-shared')).toBe('');
    useAuthStore.getState().logout('user');
    expect(localStorage.getItem('mico360.chat.draft.conv-shared')).toBeNull();
  });

  const waiting = (clientId: string, body: string) =>
    ({ clientId, conversationId: 'conv-shared', body, createdAt: new Date().toISOString(), replyTo: null, files: [], state: 'queued' }) as never;

  it('an explicit log out removes the person’s waiting messages (the same rule as the task queue)', () => {
    keepInOutbox('userA', waiting('c1', 'Ann’s queued message'));
    keepInOutbox('userB', waiting('c2', 'Bob’s queued message'));
    localStorage.setItem('mico360.chat.outbox.userA', JSON.stringify([{ clientId: 'old', conversationId: 'c', body: 'older list', createdAt: '' }]));
    useAuthStore.getState().logout('user');
    expect(Object.keys(localStorage).filter((k) => k.startsWith('mico360.chat.outbox.userA'))).toEqual([]);
    expect(loadOutbox('userA')).toEqual([]);
    expect(loadOutbox('userB').map((m) => m.body)).toEqual(['Bob’s queued message']);
  });

  it('a session that ended (not a log out) keeps them for when the person signs in again', () => {
    keepInOutbox('userA', waiting('c1', 'Ann’s queued message'));
    useAuthStore.getState().logout('expired');
    expect(loadOutbox('userA').map((m) => m.body)).toEqual(['Ann’s queued message']);
  });

  it('the sign-out warning counts the waiting chat messages', () => {
    expect(unsentChangeCount('userA')).toBe(0);
    keepInOutbox('userA', waiting('c1', 'one'));
    keepInOutbox('userA', waiting('c2', 'two'));
    keepInOutbox('userB', waiting('c3', 'not Ann’s'));
    expect(unsentChangeCount('userA')).toBe(2);
  });
});
