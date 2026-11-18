import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enqueueOffline, flushOfflineQueue, pendingCount, failedChanges, discardChange, moveTaskOnline } from './offline-replay';
import { clearQueue, getQueue, localStorageQueueStore } from './offline-queue';
import { useAuthStore } from '../stores/auth-store';
import { useTaskNotice } from './task-notice';

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
  it('1.24.1: a queued appreciation accept carries its note; an old {id} entry still replays; a note not added is said', async () => {
    const { useNoteNotice, clearNoteNotice } = await import('./appreciation-note-notice');
    clearNoteNotice();
    const bodies: unknown[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return json({ data: { acceptedAt: '2026-11-18T05:00:00.000Z', already: bodies.length === 2, noteSaved: bodies.length !== 2 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    enqueueOffline('appreciation.accept', { id: 'ap1', note: 'From the yard' });
    await flushOfflineQueue();
    expect(fetchMock.mock.calls[0]![0]).toContain('/appreciations/me/ap1/accept');
    expect(bodies[0]).toEqual({ note: 'From the yard' });
    expect(useNoteNotice.getState().text).toBeNull();
    enqueueOffline('appreciation.accept', { id: 'ap2', note: 'Too late' }); // accepted meanwhile elsewhere
    await flushOfflineQueue();
    expect(useNoteNotice.getState().text).toBe('This appreciation was already accepted, so your note wasn’t added.');
    clearNoteNotice();
    enqueueOffline('appreciation.accept', { id: 'ap3' }); // queued by 1.24.0
    await flushOfflineQueue();
    expect(bodies[2]).toEqual({});
    expect(useNoteNotice.getState().text).toBeNull();
  });

  it('a task made offline says "Task MICO-143 saved" once it syncs (1.22.3)', async () => {
    useTaskNotice.setState({ notice: null });
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { id: 't9', key: 'MICO-143', title: 'X' } }, 201)));
    enqueueOffline('task.create', { title: 'X', projectId: 'p1', columnId: 'c1' }, { idempotencyKey: 'k-9' });
    await flushOfflineQueue();
    expect(useTaskNotice.getState().notice).toEqual({ text: 'Task MICO-143 saved', taskId: 't9', key: 'MICO-143' });
    // Nothing synced: no notice.
    useTaskNotice.setState({ notice: null });
    await flushOfflineQueue();
    expect(useTaskNotice.getState().notice).toBeNull();
  });

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

  describe('1.24.0: a move saved online anywhere drops an older queued board move', () => {
    const queued = () => getQueue(localStorageQueueStore).map((m) => `${(m.payload as { id: string }).id}→${(m.payload as { toColumnId: string }).toColumnId}`);

    it('drops the mover’s moves of that task queued before it was sent — not other tasks’, not someone else’s', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        vi.setSystemTime(new Date('2026-11-14T08:00:00.000Z'));
        signIn('bob');
        enqueueOffline('task.move', { id: 't1', toColumnId: 'c-bob' });
        useAuthStore.getState().logout('expired'); // Bob's queue is kept for him
        signIn('alice');
        enqueueOffline('task.move', { id: 't1', toColumnId: 'c-old' });
        enqueueOffline('task.move', { id: 't2', toColumnId: 'c-other' });
        vi.setSystemTime(new Date('2026-11-14T08:00:05.000Z'));
        const move = vi.fn(async (id: string, columnId: string) => ({ id, columnId }) as never);
        await expect(moveTaskOnline({ move }, 't1', 'c-new')).resolves.toEqual({ id: 't1', columnId: 'c-new' });
        expect(move).toHaveBeenCalledWith('t1', 'c-new');
        expect(queued()).toEqual(['t1→c-bob', 't2→c-other']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps a move queued while it was on its way (the newer one), and keeps everything when it fails', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        vi.setSystemTime(new Date('2026-11-14T08:00:00.000Z'));
        enqueueOffline('task.move', { id: 't1', toColumnId: 'c-old' });
        vi.setSystemTime(new Date('2026-11-14T08:00:05.000Z'));
        let answer!: () => void;
        const held = new Promise<void>((r) => (answer = r));
        const move = vi.fn(async (id: string, columnId: string) => {
          await held;
          return { id, columnId } as never;
        });
        const sent = moveTaskOnline({ move }, 't1', 'c-new');
        vi.setSystemTime(new Date('2026-11-14T08:00:06.000Z'));
        enqueueOffline('task.move', { id: 't1', toColumnId: 'c-later' });
        answer();
        await sent;
        expect(queued()).toEqual(['t1→c-later']);

        const refused = vi.fn(async () => {
          throw new Error('offline');
        });
        await expect(moveTaskOnline({ move: refused }, 't1', 'c-x')).rejects.toThrow('offline');
        expect(queued()).toEqual(['t1→c-later']);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
