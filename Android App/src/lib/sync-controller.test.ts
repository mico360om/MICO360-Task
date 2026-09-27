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
  const fallback: FlushFn = async () => ({ synced: items.length, failed: [], remaining: 0 });
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
    expect(res).toEqual({ synced: 1, failed: [], remaining: 0 });
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
      return { synced: 1, failed: [], remaining: 0 };
    });
    const controller = createSyncController({ queue, getUserId: () => 'u1' });
    const first = controller.trigger();
    const second = await controller.trigger(); // while first is still awaiting the gate
    expect(second).toBeNull();
    expect(controller.isFlushing()).toBe(true);
    release();
    await first;
    expect(queue.flush).toHaveBeenCalledOnce();
    expect(controller.isFlushing()).toBe(false);
  });

  it('asks the queue to stop if the user changes mid-flush', async () => {
    let user: string | null = 'u1';
    const queue = fakeQueue([m('1')], async () => ({ synced: 0, failed: [], remaining: 1 }));
    const controller = createSyncController({ queue, getUserId: () => user });
    await controller.trigger();
    const { shouldContinue } = queue.flush.mock.calls[0]![1] as { shouldContinue: () => boolean };
    expect(shouldContinue()).toBe(true);
    user = null;
    expect(shouldContinue()).toBe(false);
  });
});
