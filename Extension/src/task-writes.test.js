import { describe, it, expect, vi } from 'vitest';
import { rebaseQueuedVersion, patchHeld, createWriteLane, taskIdOf, isVersionConflict, rememberTask, VERSIONED_KINDS, supersede, SUPERSEDED_MESSAGE } from './task-writes.js';
import { ApiError } from './errors.js';

const item = (kind, payload, id = kind) => ({ id, kind, payload, userId: 'u1', status: 'pending' });

describe('rebaseQueuedVersion (H1)', () => {
  it('moves this device’s later edit, made against the version before its own write, on to the new version', () => {
    const done = item('task.update', { id: 't1', patch: { priority: 'HIGH' }, expectedVersion: 5 });
    const later = item('task.update', { id: 't1', patch: { title: 'B' }, expectedVersion: 5 }, 'later');
    const next = rebaseQueuedVersion(done, { id: 't1', version: 6 }, later);
    expect(next.payload).toEqual({ id: 't1', patch: { title: 'B' }, expectedVersion: 6 });
    expect(later.payload.expectedVersion).toBe(5); // a new item, the old one untouched
  });

  it('a replayed move moves the version on too', () => {
    const move = item('task.move', { id: 't1', columnId: 'c2', position: 0 });
    const later = item('task.update', { id: 't1', patch: { title: 'B' }, expectedVersion: 6 }, 'later');
    expect(rebaseQueuedVersion(move, { version: 7 }, later).payload.expectedVersion).toBe(7);
  });

  it('leaves an edit made against any other version, so it is still refused when someone else changed the task', () => {
    const done = item('task.update', { id: 't1', patch: {}, expectedVersion: 5 });
    const stale = item('task.update', { id: 't1', patch: { title: 'B' }, expectedVersion: 3 }, 'stale');
    expect(rebaseQueuedVersion(done, { version: 6 }, stale)).toBe(stale);
  });

  it('leaves other tasks, other kinds and replies without a version alone', () => {
    const done = item('task.update', { id: 't1', patch: {}, expectedVersion: 5 });
    const otherTask = item('task.update', { id: 't2', patch: {}, expectedVersion: 5 }, 'o');
    const comment = item('comment.add', { id: 't1', body: 'hi' }, 'c');
    expect(rebaseQueuedVersion(done, { version: 6 }, otherTask)).toBe(otherTask);
    expect(rebaseQueuedVersion(done, { version: 6 }, comment)).toBe(comment);
    expect(rebaseQueuedVersion(done, undefined, otherTask)).toBe(otherTask);
    expect(rebaseQueuedVersion(item('comment.add', { id: 't1' }), { version: 6 }, item('task.update', { id: 't1', patch: {}, expectedVersion: 5 }, 'x')).payload.expectedVersion).toBe(5);
  });
});

describe('patchHeld (a refused replay that is already on the server counts as done)', () => {
  it('is true when the task already holds every edited value', () => {
    expect(patchHeld({ title: 'B', priority: 'HIGH' }, { title: 'B' })).toBe(true);
    expect(patchHeld({ dueDate: '2026-10-13T00:00:00.000Z' }, { dueDate: '2026-10-13' })).toBe(true);
    expect(patchHeld({ dueDate: null }, { dueDate: null })).toBe(true);
    expect(patchHeld({ description: null }, { description: '' })).toBe(true);
    // The server adds the anchor day to a saved repeat.
    expect(patchHeld({ recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1], anchorDay: 13 } }, { recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1] } })).toBe(true);
    expect(patchHeld({ recurrenceRule: null }, { recurrenceRule: null })).toBe(true);
  });

  it('is false when any edited value is different', () => {
    expect(patchHeld({ title: 'C', priority: 'HIGH' }, { title: 'B', priority: 'HIGH' })).toBe(false);
    expect(patchHeld({ dueDate: '2026-10-14T00:00:00.000Z' }, { dueDate: '2026-10-13' })).toBe(false);
    expect(patchHeld({ recurrenceRule: { freq: 'DAILY', interval: 1 } }, { recurrenceRule: { freq: 'WEEKLY', interval: 1 } })).toBe(false);
    expect(patchHeld({ recurrenceRule: null }, { recurrenceRule: { freq: 'DAILY', interval: 1 } })).toBe(false);
    expect(patchHeld(null, { title: 'B' })).toBe(false);
  });
});

describe('createWriteLane (one edit of a task at a time)', () => {
  it('runs writes one after another, in order, even when an earlier one fails', async () => {
    const lane = createWriteLane();
    const log = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const a = lane.run(async () => { log.push('a start'); await gate; log.push('a end'); throw new Error('a failed'); });
    const b = lane.run(async () => { log.push('b'); return 'b done'; });
    await new Promise((r) => setTimeout(r, 5));
    expect(log).toEqual(['a start']);
    release();
    await expect(a).rejects.toThrow('a failed');
    await expect(b).resolves.toBe('b done');
    expect(log).toEqual(['a start', 'a end', 'b']);
  });
});

describe('taskIdOf / isVersionConflict', () => {
  it('names the task a queued change is about', () => {
    expect(taskIdOf(item('task.update', { id: 't1', patch: {} }))).toBe('t1');
    expect(taskIdOf(item('task.move', { id: 't2', columnId: 'c' }))).toBe('t2');
    expect(taskIdOf(item('chat.send', { conversationId: 'cv' }))).toBeNull();
    expect(VERSIONED_KINDS.has('task.update') && VERSIONED_KINDS.has('task.move') && !VERSIONED_KINDS.has('comment.add')).toBe(true);
  });

  it('recognises the server refusing an edit made over someone else’s', () => {
    expect(isVersionConflict(new ApiError(409, 'changed', 'VERSION_CONFLICT'))).toBe(true);
    expect(isVersionConflict(new ApiError(409, 'busy', 'IDEMPOTENCY_IN_PROGRESS'))).toBe(false);
    expect(isVersionConflict(null)).toBe(false);
  });
});

describe('rememberTask', () => {
  it('keeps the saved copy of a task at the version a write made (so the next edit is sent against it)', async () => {
    const cache = { merge: vi.fn(async () => true) };
    await rememberTask(cache, { id: 't1', version: 4, title: 'B' });
    expect(cache.merge).toHaveBeenCalledWith('task:t1', { id: 't1', version: 4, title: 'B' });
    await rememberTask(cache, null);
    await rememberTask(null, { id: 't1' });
    expect(cache.merge).toHaveBeenCalledTimes(1);
  });
});

describe('supersede: an older failed change that a newer synced one replaced (review I1)', () => {
  const failed = (kind, payload, id = 'old') => ({ ...item(kind, payload, id), status: 'failed', lastError: '500 — Server error' });

  it('people: taking someone off replaces an older failed adding of them; other people can still be added', () => {
    const done = item('task.unassign', { id: 't1', userId: 'u2' }, 'new');
    expect(supersede(done, failed('task.assign', { id: 't1', userIds: ['u2'] }))).toMatchObject({ superseded: true, lastError: SUPERSEDED_MESSAGE });
    expect(supersede(done, failed('task.assign', { id: 't1', userIds: ['u2', 'u3'] }))).toMatchObject({ payload: { userIds: ['u3'] } });
    expect(supersede(done, failed('task.assign', { id: 't1', userIds: ['u3'] })).superseded).toBeFalsy();
    expect(supersede(item('task.assign', { id: 't1', userIds: ['u2'] }, 'new'), failed('task.unassign', { id: 't1', userId: 'u2' })).superseded).toBe(true);
  });

  it('a comment’s text, and a card’s column: the newer one stands', () => {
    expect(supersede(item('comment.update', { id: 't1', commentId: 'c1', body: 'v2' }, 'new'), failed('comment.update', { id: 't1', commentId: 'c1', body: 'v1' })).superseded).toBe(true);
    expect(supersede(item('comment.update', { id: 't1', commentId: 'c2', body: 'v2' }, 'new'), failed('comment.update', { id: 't1', commentId: 'c1', body: 'v1' })).superseded).toBeFalsy();
    expect(supersede(item('task.move', { id: 't1', columnId: 'c3' }, 'new'), failed('task.move', { id: 't1', columnId: 'c2' })).superseded).toBe(true);
    // An edit carries its version: the server refuses a stale one, so it is left as it is.
    const edit = failed('task.update', { id: 't1', patch: { title: 'A' }, expectedVersion: 3 });
    expect(supersede(item('task.update', { id: 't1', patch: { title: 'B' }, expectedVersion: 3 }, 'new'), edit)).toBe(edit);
  });

  it('only this person’s failed changes of the same task and the same thing', () => {
    const done = item('task.watch', { id: 't1' }, 'new');
    const pending = { ...failed('task.unwatch', { id: 't1' }), status: 'pending' };
    for (const older of [pending, failed('task.unwatch', { id: 't2' }), { ...failed('task.unwatch', { id: 't1' }), userId: 'u9' }, failed('task.tags', { id: 't1', base: [], tags: ['X'] })]) {
      expect(supersede(done, older)).toBe(older);
    }
    expect(supersede(done, failed('task.unwatch', { id: 't1' })).superseded).toBe(true);
  });
});
