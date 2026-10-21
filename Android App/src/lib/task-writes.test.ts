import { describe, it, expect } from 'vitest';
import { createTaskWrites, markReloaded, noteReplayed, withExpectedVersion, rebaseQueuedVersion, taskHoldsEdit } from './task-writes';
import type { QueuedMutation } from './sync-queue';
import type { ApiTask } from './types';

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

describe('taskHoldsEdit — does the task already hold what a queued edit sets?', () => {
  const task = {
    id: 't1',
    title: 'Ship it',
    description: null,
    priority: 'HIGH',
    dueDate: '2026-10-12T00:00:00.000Z',
    estimatedHours: 2.5,
    progress: 40,
    isMilestone: false,
    recurrenceRule: { freq: 'MONTHLY', interval: 1, anchorDay: 12 },
    version: 6,
  } as unknown as ApiTask;

  it('yes when every field it sets matches — the version and scope it carries aside', () => {
    expect(taskHoldsEdit(task, { title: 'Ship it', priority: 'HIGH', expectedVersion: 5, scope: 'series' })).toBe(true);
    expect(taskHoldsEdit(task, { estimatedHours: 2.5, progress: 40, isMilestone: false })).toBe(true);
  });

  it('compares a due date by its day, and an empty description with none', () => {
    expect(taskHoldsEdit(task, { dueDate: '2026-10-12' })).toBe(true);
    expect(taskHoldsEdit(task, { dueDate: '2026-10-13' })).toBe(false);
    expect(taskHoldsEdit({ ...task, dueDate: null }, { dueDate: null })).toBe(true);
    expect(taskHoldsEdit(task, { description: '' })).toBe(true);
    expect(taskHoldsEdit(task, { description: 'Notes' })).toBe(false);
  });

  it('a repeat matches with the day the server pins it to, but not one that differs', () => {
    // The server pins a monthly rule to its due day (anchorDay), as lib/recurrence's withAnchorDay does.
    expect(taskHoldsEdit(task, { recurrenceRule: { freq: 'MONTHLY', interval: 1 } })).toBe(true);
    expect(taskHoldsEdit(task, { recurrenceRule: { freq: 'MONTHLY', interval: 2 } })).toBe(false);
    // Taking away the end date is a change, even though everything else matches.
    const ending = { ...task, recurrenceRule: { freq: 'WEEKLY', interval: 1, until: '2026-12-31' } } as unknown as ApiTask;
    expect(taskHoldsEdit(ending, { recurrenceRule: { freq: 'WEEKLY', interval: 1 } })).toBe(false);
    expect(taskHoldsEdit(task, { recurrenceRule: null })).toBe(false);
    expect(taskHoldsEdit({ ...task, recurrenceRule: null }, { recurrenceRule: null })).toBe(true);
  });

  it('no when anything differs, or when the edit sets nothing it could check', () => {
    expect(taskHoldsEdit(task, { title: 'Ship it', priority: 'LOW' })).toBe(false);
    expect(taskHoldsEdit(task, { expectedVersion: 5 })).toBe(false);
    expect(taskHoldsEdit(task, {})).toBe(false);
  });
});

describe('noteReplayed — a replayed edit or move of this phone’s is its own version', () => {
  it('the next edit is made against the version the sync’s replay made, not the one the screen loaded', () => {
    const writes = createTaskWrites();
    const m = (kind: string, payload: unknown) => ({ id: 'q', kind, payload, createdAt: 0, userId: 'u1', idempotencyKey: 'k', attempts: 0, status: 'pending' as const });
    noteReplayed(writes, m('task.update', { id: 't1', patch: { title: 'B', expectedVersion: 4 } }), { id: 't1', version: 5 });
    expect(writes.expectedVersion('t1', 4)).toBe(5);
    noteReplayed(writes, m('task.move', { id: 't1', columnId: 'c2' }), { id: 't1', version: 6 });
    expect(writes.expectedVersion('t1', 4)).toBe(6);
    // Other changes (and an answer without a version) note nothing.
    noteReplayed(writes, m('checklist.update', { id: 't2', itemId: 'k1', patch: { done: true } }), { version: 9 });
    noteReplayed(writes, m('task.update', { id: 't3', patch: {} }), undefined);
    expect(writes.expectedVersion('t2', 1)).toBe(1);
    expect(writes.expectedVersion('t3', 2)).toBe(2);
  });

  // 2c review fix 2: a replay refused as a conflict that the task already holds is answered by the
  // reloaded task — whose version may be a colleague's later edit, not this phone's.
  it('never takes a reloaded task’s version as this phone’s own when someone else changed it since', () => {
    const writes = createTaskWrites();
    const m = (payload: unknown) => ({ id: 'q', kind: 'task.update', payload, createdAt: 0, userId: 'u1', idempotencyKey: 'k', attempts: 0, status: 'pending' as const });
    // This phone's edit (against 5) made 6; a colleague then made 7. The reload shows 7.
    noteReplayed(writes, m({ id: 't1', patch: { title: 'B', expectedVersion: 5 } }), markReloaded({ id: 't1', title: 'B', version: 7 }));
    // The next edit goes against the version the screen loaded, so the colleague's change is seen.
    expect(writes.expectedVersion('t1', 5)).toBe(5);
    // Nobody changed it since this phone's own save (6 = 5 + 1): that version is this phone's.
    noteReplayed(writes, m({ id: 't2', patch: { title: 'B', expectedVersion: 5 } }), markReloaded({ id: 't2', title: 'B', version: 6 }));
    expect(writes.expectedVersion('t2', 5)).toBe(6);
  });
});

describe('rebaseQueuedVersion — never onto a colleague’s version (2c review fix 2)', () => {
  it('leaves a later edit alone when the replay was answered by a reload that holds someone else’s later version', () => {
    const done = item('task.update', { id: 't1', patch: { priority: 'HIGH', expectedVersion: 5 } }, 'done');
    // This phone loaded its own 6 and edited against it; a colleague made 7 meanwhile.
    const later = item('task.update', { id: 't1', patch: { title: 'B', expectedVersion: 6 } }, 'later');
    expect(rebaseQueuedVersion(done, markReloaded({ id: 't1', version: 7 }), later)).toBe(later);
    // A reload that shows only this phone's own save (6) still moves a later edit on.
    const after5 = item('task.update', { id: 't1', patch: { title: 'B', expectedVersion: 5 } }, 'later');
    expect(rebaseQueuedVersion(done, markReloaded({ id: 't1', version: 6 }), after5)).toEqual(
      item('task.update', { id: 't1', patch: { title: 'B', expectedVersion: 6 } }, 'later'),
    );
  });
});
