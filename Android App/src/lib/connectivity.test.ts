import { describe, it, expect, vi } from 'vitest';
import { createConnectivity, isConnectionDrop, serverReached } from './connectivity';
import { createSyncQueue } from './sync-queue';
import { createSyncController } from './sync-controller';

describe('createConnectivity (online / offline from the app’s own requests and sockets)', () => {
  it('starts online', () => {
    expect(createConnectivity().isOnline()).toBe(true);
  });

  it('goes offline when a request gets no answer, and online again on the next answer', () => {
    const c = createConnectivity();
    const heard = vi.fn();
    c.subscribe(heard);
    c.unreachable();
    expect(c.isOnline()).toBe(false);
    c.reachable();
    expect(c.isOnline()).toBe(true);
    expect(heard.mock.calls).toEqual([[false], [true]]);
  });

  it('tells listeners only about changes, not every request', () => {
    const c = createConnectivity();
    const heard = vi.fn();
    c.subscribe(heard);
    c.reachable();
    c.reachable();
    c.unreachable();
    c.unreachable();
    expect(heard.mock.calls).toEqual([[false]]);
  });

  it('stops telling a listener once it unsubscribes', () => {
    const c = createConnectivity();
    const heard = vi.fn();
    const stop = c.subscribe(heard);
    stop();
    c.unreachable();
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('serverReached (the server can be reached again)', () => {
  it('starts replaying the queued changes before the app counts as online again', async () => {
    const m = new Map<string, string>();
    const store = { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v), deleteItem: async (k: string) => void m.delete(k) };
    const sent: string[] = [];
    const queue = createSyncQueue({ store, perform: async (item) => void sent.push(item.kind) });
    await queue.load();
    await queue.enqueue('task.move', { id: 't1', columnId: 'c2' }, { userId: 'u1' });
    const sync = createSyncController({ queue, getUserId: () => 'u1' });
    const c = createConnectivity();
    c.unreachable();
    // Screens refresh when they hear the app is online (TanStack's reconnect refetch).
    const heard: Array<{ flushing: boolean; sent: number }> = [];
    c.subscribe(() => heard.push({ flushing: sync.isFlushing(), sent: sent.length }));

    serverReached(c, () => void sync.trigger());

    expect(c.isOnline()).toBe(true);
    expect(heard).toEqual([{ flushing: true, sent: 1 }]);
  });
});

describe('isConnectionDrop (a live socket closing because the connection went)', () => {
  it('counts a lost connection or a missed heartbeat', () => {
    expect(isConnectionDrop('transport close')).toBe(true);
    expect(isConnectionDrop('transport error')).toBe(true);
    expect(isConnectionDrop('ping timeout')).toBe(true);
  });

  it('does not count a socket closed on purpose (by the app or the server)', () => {
    expect(isConnectionDrop('io client disconnect')).toBe(false);
    expect(isConnectionDrop('io server disconnect')).toBe(false);
    expect(isConnectionDrop('parse error')).toBe(false);
  });
});
