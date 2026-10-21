import { describe, it, expect, vi } from 'vitest';
import { createSyncController } from './sync-controller';
import type { FlushResult, QueuedMutation } from './sync-queue';

const m = (id: string, userId = 'u1'): QueuedMutation => ({
  id,
  kind: 'task.move',
  payload: {},
  createdAt: 0,
  userId,
  idempotencyKey: `k-${id}`,
  attempts: 0,
  status: 'pending',
});

type FlushFn = (userId: string, opts?: { shouldContinue?: () => boolean }) => Promise<FlushResult>;

function fakeQueue(items: QueuedMutation[], flushImpl?: FlushFn) {
  const fallback: FlushFn = async () => ({ synced: items.length, done: items, failed: [], remaining: 0 });
  return {
    pendingFor: (userId: string | null | undefined) => items.filter((x) => x.userId === userId),
    flush: vi.fn<FlushFn>(flushImpl ?? fallback),
  };
}

describe('createSyncController (A8 sync-on-reconnect)', () => {
  it('flushes the signed-in user’s pending mutations', async () => {
    const queue = fakeQueue([m('1')]);
    const onFlushed = vi.fn();
    const controller = createSyncController({ queue, getUserId: () => 'u1', onFlushed });
    const res = await controller.trigger();
    expect(queue.flush).toHaveBeenCalledOnce();
    expect(queue.flush.mock.calls[0]![0]).toBe('u1');
    expect(res).toEqual({ synced: 1, done: [m('1')], failed: [], remaining: 0 });
    expect(onFlushed).toHaveBeenCalledOnce();
  });

  it('is a no-op when signed out', async () => {
    const queue = fakeQueue([m('1')]);
    const controller = createSyncController({ queue, getUserId: () => null });
    expect(await controller.trigger()).toBeNull();
    expect(queue.flush).not.toHaveBeenCalled();
  });

  it('is a no-op when only another user has queued changes', async () => {
    const queue = fakeQueue([m('1', 'someone-else')]);
    const controller = createSyncController({ queue, getUserId: () => 'u1' });
    expect(await controller.trigger()).toBeNull();
    expect(queue.flush).not.toHaveBeenCalled();
  });

  it('does not start a second flush while one is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const queue = fakeQueue([m('1')], async () => {
      await gate;
      return { synced: 1, done: [m('1')], failed: [], remaining: 0 };
    });
    const controller = createSyncController({ queue, getUserId: () => 'u1' });
    const first = controller.trigger();
    const second = controller.trigger(); // while first is still awaiting the gate: the same run
    expect(second).toBe(first);
    expect(queue.flush).toHaveBeenCalledOnce();
    expect(controller.isFlushing()).toBe(true);
    release();
    await first;
    expect(controller.isFlushing()).toBe(false);
  });

  it('asks the queue to stop if the user changes mid-flush', async () => {
    let user: string | null = 'u1';
    const queue = fakeQueue([m('1')], async () => ({ synced: 0, done: [], failed: [], remaining: 1 }));
    const controller = createSyncController({ queue, getUserId: () => user });
    await controller.trigger();
    const { shouldContinue } = queue.flush.mock.calls[0]![1] as { shouldContinue: () => boolean };
    expect(shouldContinue()).toBe(true);
    user = null;
    expect(shouldContinue()).toBe(false);
  });
});

describe('"Sync now" while a sync is running (4a review #1)', () => {
  it('runs one more sync right after it, instead of doing nothing (never two at once)', async () => {
    let release!: () => void;
    let calls = 0;
    const queue = fakeQueue([m('1')], async () => {
      calls += 1;
      if (calls === 1) await new Promise<void>((r) => (release = r));
      return { synced: 1, done: [m('1')], failed: [], remaining: 0 };
    });
    const controller = createSyncController({ queue, getUserId: () => 'u1' });
    const first = controller.trigger();
    const second = controller.trigger(); // Sync now, while the first is still running
    const third = controller.trigger();
    expect(queue.flush).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second, third]);
    expect(queue.flush).toHaveBeenCalledTimes(2);
    expect(controller.isFlushing()).toBe(false);
  });
});
