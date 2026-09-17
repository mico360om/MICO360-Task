import { describe, it, expect, vi } from 'vitest';
import { createSyncController } from './sync-controller';
import type { FlushResult, QueuedMutation } from './sync-queue';

function fakeQueue(pending: QueuedMutation[], flushImpl?: () => Promise<FlushResult>) {
  return {
    pending: () => pending,
    flush: vi.fn(flushImpl ?? (async () => ({ synced: pending.length, dropped: [], remaining: 0 }))),
  };
}

const m = (id: string): QueuedMutation => ({ id, kind: 'task.move', payload: {}, createdAt: 0 });

describe('createSyncController (A8 sync-on-reconnect)', () => {
  it('flushes when there are pending mutations', async () => {
    const queue = fakeQueue([m('1')]);
    const controller = createSyncController({ queue });
    const res = await controller.trigger();
    expect(queue.flush).toHaveBeenCalledOnce();
    expect(res).toEqual({ synced: 1, dropped: [], remaining: 0 });
  });

  it('is a no-op when the queue is empty', async () => {
    const queue = fakeQueue([]);
    const controller = createSyncController({ queue });
    expect(await controller.trigger()).toBeNull();
    expect(queue.flush).not.toHaveBeenCalled();
  });

  it('does not start a second flush while one is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const queue = fakeQueue([m('1')], async () => {
      await gate;
      return { synced: 1, dropped: [], remaining: 0 };
    });
    const controller = createSyncController({ queue });
    const first = controller.trigger();
    const second = await controller.trigger(); // while first is still awaiting the gate
    expect(second).toBeNull();
    release();
    await first;
    expect(queue.flush).toHaveBeenCalledOnce();
  });
});
