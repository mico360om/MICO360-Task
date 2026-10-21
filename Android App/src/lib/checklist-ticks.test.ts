import { describe, it, expect } from 'vitest';
import { ticksAfterReload, withQueuedTicks } from './checklist-ticks';
import type { QueuedMutation } from './sync-queue';
import type { ApiChecklistItem } from './types';

const item = (id: string, done: boolean): ApiChecklistItem => ({ id, taskId: 't1', text: id, done, position: 0 });
const queued = (payload: unknown, id = 'q'): QueuedMutation => ({ id, kind: 'checklist.update', payload, createdAt: 0, userId: 'u1', idempotencyKey: 'k', attempts: 0, status: 'pending' });

describe('subtask ticks shown while they are being saved (2c review fix 3)', () => {
  it('a reload brought by one tick’s answer keeps the ticks still on their way — B and C don’t flip back', () => {
    const ticks = { a: true, b: true, c: true };
    // A's answer came (its tick is in the reload); B and C are still being saved.
    const saving = new Map([
      ['b', 1],
      ['c', 1],
    ]);
    expect(ticksAfterReload(ticks, saving)).toEqual({ b: true, c: true });
    // Once nothing is being saved, the server's checklist is shown as it is.
    expect(ticksAfterReload(ticks, new Map())).toEqual({});
    // The same object back when nothing changes (no extra render).
    const none = {};
    expect(ticksAfterReload(none, new Map())).toBe(none);
  });

  it('a tick kept on this phone (offline) shows over the server’s checklist until it is sent', () => {
    const items = [item('a', false), item('b', false), item('c', true)];
    const pending = [
      queued({ id: 't1', itemId: 'a', patch: { done: true } }, 'q1'),
      queued({ id: 't1', itemId: 'c', patch: { done: false } }, 'q2'),
      // A later change of the same subtask wins; a rename isn't a tick; another task's is left out.
      queued({ id: 't1', itemId: 'a', patch: { done: false } }, 'q3'),
      queued({ id: 't1', itemId: 'b', patch: { text: 'Renamed' } }, 'q4'),
      queued({ id: 't2', itemId: 'b', patch: { done: true } }, 'q5'),
    ];
    expect(withQueuedTicks(items, pending, 't1').map((i) => [i.id, i.done, i.text])).toEqual([
      ['a', false, 'a'],
      ['b', false, 'Renamed'],
      ['c', false, 'c'],
    ]);
    // Nothing waiting: the same list back.
    expect(withQueuedTicks(items, [], 't1')).toBe(items);
  });
});
