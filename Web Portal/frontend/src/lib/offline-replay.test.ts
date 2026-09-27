import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enqueueOffline, flushOfflineQueue, pendingCount, failedChanges, discardChange } from './offline-replay';
import { clearQueue, getQueue, localStorageQueueStore } from './offline-queue';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const signIn = (id: string) =>
  useAuthStore.getState().setSession({ user: { id, email: `${id}@x.test`, username: id, roles: [] }, accessToken: `at-${id}`, refreshToken: `rt-${id}` });

beforeEach(() => {
  clearQueue(localStorageQueueStore);
  signIn('alice');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('offline-replay', () => {
  it('replays a queued task.create through the API with its Idempotency-Key and empties the queue', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({ data: { id: 't1' } }, 201));
    vi.stubGlobal('fetch', fetchMock);
    enqueueOffline('task.create', { title: 'X', projectId: 'p1', columnId: 'c1' }, { idempotencyKey: 'k-1' });
    expect(pendingCount()).toBe(1);
    const res = await flushOfflineQueue();
    expect(res.synced).toBe(1);
    expect(pendingCount()).toBe(0);
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('k-1');
  });

  it('records the owner and never replays another user’s changes', async () => {
    const fetchMock = vi.fn(async () => json({ data: { id: 't1' } }, 201));
    vi.stubGlobal('fetch', fetchMock);
    enqueueOffline('task.create', { title: 'Alice offline', projectId: 'p1', columnId: 'c1' });
    expect(getQueue(localStorageQueueStore)[0]!.ownerId).toBe('alice');

    useAuthStore.getState().logout('expired'); // session ended — Alice's work must survive
    signIn('bob');
    expect(pendingCount()).toBe(0); // Bob sees none of Alice's queue
    await flushOfflineQueue();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getQueue(localStorageQueueStore)).toHaveLength(1);
  });

  it('clears the user’s queued changes on an explicit sign-out', () => {
    enqueueOffline('task.move', { id: 't1', toColumnId: 'c2' });
    useAuthStore.getState().logout('user');
    expect(getQueue(localStorageQueueStore)).toHaveLength(0);
  });

  it('does not queue anything when nobody is signed in', () => {
    useAuthStore.getState().logout('user');
    expect(enqueueOffline('task.move', { id: 't1', toColumnId: 'c2' })).toBe(false);
    expect(getQueue(localStorageQueueStore)).toHaveLength(0);
  });

  it('marks a permanently-rejected (400) change failed so the user can review it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'VALIDATION', message: 'bad' } }, 400)));
    enqueueOffline('task.move', { id: 't1', toColumnId: 'c2' });
    const res = await flushOfflineQueue();
    expect(res.failed).toBe(1);
    expect(pendingCount()).toBe(0);
    const failed = failedChanges();
    expect(failed).toHaveLength(1);
    discardChange(failed[0]!.id);
    expect(failedChanges()).toHaveLength(0);
  });

  it('keeps a change (no attempt counted) when offline or rate limited (429)', async () => {
    enqueueOffline('task.move', { id: 't1', toColumnId: 'c2' });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network down');
    }));
    expect((await flushOfflineQueue()).remaining).toBe(1);
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'RATE_LIMITED' } }, 429)));
    expect((await flushOfflineQueue()).remaining).toBe(1);
    expect(failedChanges()).toHaveLength(0);
    expect(getQueue(localStorageQueueStore)[0]!.attempts).toBe(0);
  });

  it('runs one flush at a time (concurrent callers share it)', async () => {
    let resolve!: () => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => { resolve = () => r(json({ data: {} })); }));
    vi.stubGlobal('fetch', fetchMock);
    enqueueOffline('task.move', { id: 't1', toColumnId: 'c2' });
    const a = flushOfflineQueue();
    const b = flushOfflineQueue();
    expect(a).toBe(b);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolve();
    expect((await a).synced).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips the flush while another tab holds the queue lock', async () => {
    const request = vi.fn(async (_name: string, _opts: unknown, cb: (lock: unknown) => Promise<unknown>) => cb(null));
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });
    const fetchMock = vi.fn(async () => json({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    enqueueOffline('task.move', { id: 't1', toColumnId: 'c2' });
    const res = await flushOfflineQueue();
    expect(request).toHaveBeenCalledWith('mico360-sync-queue', { ifAvailable: true }, expect.any(Function));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.remaining).toBe(1);
  });
});
