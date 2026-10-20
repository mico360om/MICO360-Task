import { describe, it, expect } from 'vitest';
import { createTaskWrites, withExpectedVersion, rebaseQueuedVersion } from './task-writes';
import type { QueuedMutation } from './sync-queue';

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createTaskWrites().run — one task’s writes go one after another', () => {
  it('starts the second write to a task only after the first has finished', async () => {
    const writes = createTaskWrites();
    const first = deferred<string>();
    const order: string[] = [];
    const a = writes.run('t1', async () => {
      order.push('a start');
      const v = await first.promise;
      order.push('a end');
      return v;
    });
    const b = writes.run('t1', async () => {
      order.push('b start');
      return 'b';
    });
    await tick();
    expect(order).toEqual(['a start']);
    first.resolve('a');
    await expect(a).resolves.toBe('a');
    await expect(b).resolves.toBe('b');
    expect(order).toEqual(['a start', 'a end', 'b start']);
  });

  it('a failed write does not stop the next one', async () => {
    const writes = createTaskWrites();
    const a = writes.run('t1', async () => {
      throw new Error('refused');
    });
    const b = writes.run('t1', async () => 'b');
    await expect(a).rejects.toThrow('refused');
    await expect(b).resolves.toBe('b');
  });

  it('writes to different tasks do not wait for each other', async () => {
    const writes = createTaskWrites();
    const blocked = deferred<void>();
    void writes.run('t1', () => blocked.promise);
    await expect(writes.run('t2', async () => 'other')).resolves.toBe('other');
    blocked.resolve();
  });
});

describe('createTaskWrites().expectedVersion — the newest version this phone knows', () => {
  it('is the newer of the loaded task’s version and the version the last write returned', () => {
    const writes = createTaskWrites();
    writes.note('t1', 6);
    // A reload that started before the write and lands after it is older: 6 still wins.
    expect(writes.expectedVersion('t1', 5)).toBe(6);
    // Someone else's change loaded since (7) is newer.
    expect(writes.expectedVersion('t1', 7)).toBe(7);
  });

  it('is the loaded version when no write has happened, and undefined when neither is known', () => {
    const writes = createTaskWrites();
    expect(writes.expectedVersion('t1', 3)).toBe(3);
    expect(writes.expectedVersion('t2', undefined)).toBeUndefined();
    writes.note('t2', undefined);
    expect(writes.expectedVersion('t2', undefined)).toBeUndefined();
  });

  it('keeps each task apart', () => {
    const writes = createTaskWrites();
    writes.note('t1', 9);
    expect(writes.expectedVersion('t2', 2)).toBe(2);
  });
});

describe('withExpectedVersion', () => {
  it('adds the version the edit was made against', () => {
    expect(withExpectedVersion({ priority: 'HIGH' }, 4)).toEqual({ priority: 'HIGH', expectedVersion: 4 });
  });
  it('leaves it out when the version is unknown (an older server)', () => {
    expect(withExpectedVersion({ priority: 'HIGH' }, undefined)).toEqual({ priority: 'HIGH' });
  });
});

const item = (kind: string, payload: unknown, id = 'q'): QueuedMutation => ({
  id,
  kind,
  payload,
  createdAt: 0,
  userId: 'u1',
  idempotencyKey: `k-${id}`,
  attempts: 0,
  status: 'pending',
});

describe('rebaseQueuedVersion — a queued edit follows this phone’s own earlier writes', () => {
  const later = item('task.update', { id: 't1', patch: { title: 'B', expectedVersion: 5 } }, 'later');

  it('after a replayed edit made version 6, a later edit of the same task that expected 5 expects 6', () => {
    const done = item('task.update', { id: 't1', patch: { priority: 'HIGH', expectedVersion: 5 } }, 'done');
    expect(rebaseQueuedVersion(done, { id: 't1', version: 6 }, later)).toEqual(
      item('task.update', { id: 't1', patch: { title: 'B', expectedVersion: 6 } }, 'later'),
    );
  });

  it('after a replayed move made version 6, the same', () => {
    const done = item('task.move', { id: 't1', columnId: 'c2' }, 'done');
    expect(rebaseQueuedVersion(done, { id: 't1', version: 6 }, later)).toEqual(
      item('task.update', { id: 't1', patch: { title: 'B', expectedVersion: 6 } }, 'later'),
    );
  });

  it('leaves an edit that expected another version alone (someone else changed the task in between)', () => {
    const done = item('task.move', { id: 't1', columnId: 'c2' }, 'done');
    // Someone else made 6; this phone's move made 7. The queued edit was made against 5.
    expect(rebaseQueuedVersion(done, { id: 't1', version: 7 }, later)).toBe(later);
  });

  it('leaves other tasks, other kinds, edits without a version and results without one alone', () => {
    const done = item('task.update', { id: 't1', patch: { expectedVersion: 5 } }, 'done');
    const otherTask = item('task.update', { id: 't2', patch: { expectedVersion: 5 } });
    const comment = item('comment.add', { id: 't1', body: 'hi' });
    const noVersion = item('task.update', { id: 't1', patch: { title: 'B' } });
    expect(rebaseQueuedVersion(done, { id: 't1', version: 6 }, otherTask)).toBe(otherTask);
    expect(rebaseQueuedVersion(done, { id: 't1', version: 6 }, comment)).toBe(comment);
    expect(rebaseQueuedVersion(done, { id: 't1', version: 6 }, noVersion)).toBe(noVersion);
    expect(rebaseQueuedVersion(done, { id: 't1' }, later)).toBe(later);
    expect(rebaseQueuedVersion(done, undefined, later)).toBe(later);
    expect(rebaseQueuedVersion(item('comment.add', { id: 't1' }), { id: 't1', version: 6 }, later)).toBe(later);
  });
});
