import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createItemLanes, sendItemWrite } from './item-lanes';
import { createSyncQueue } from './sync-queue';
import type { KeyValueStore } from './storage';

function fakeStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: async (k: string, v: string) => void m.set(k, v),
    deleteItem: async (k: string) => void m.delete(k),
    keys: async () => [...m.keys()],
  };
}

/** A request the test answers when it chooses. */
function held<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('item lanes — writes to one item in order, to different items at once (2c review fix 3)', () => {
  it('ticks of three different subtasks all go at once: none waits for another’s answer', async () => {
    const lanes = createItemLanes();
    const queue = createSyncQueue({ store: fakeStore(), perform: async () => undefined });
    const deps = { queue, userId: () => 'u1' };
    const started: string[] = [];
    const answers = new Map<string, ReturnType<typeof held<void>>>();
    const send = (itemId: string) =>
      sendItemWrite(lanes, deps, { kind: 'checklist.update', payload: { id: 't1', itemId, patch: { done: true } } }, () => {
        started.push(itemId);
        const h = held<void>();
        answers.set(itemId, h);
        return h.promise;
      });
    const all = [send('a'), send('b'), send('c')];
    await tick();
    // Before any answer came, all three were sent.
    expect(started).toEqual(['a', 'b', 'c']);
    for (const h of answers.values()) h.resolve();
    await Promise.all(all);
  });

  it('two changes of the same item go one after another (the second after the first settled, failed or not)', async () => {
    const lanes = createItemLanes();
    const order: string[] = [];
    const first = held<string>();
    const a = lanes.run('subtask:k1', async () => {
      order.push('first sent');
      return first.promise;
    });
    const b = lanes.run('subtask:k1', async () => {
      order.push('second sent');
      return 'two';
    });
    await tick();
    expect(order).toEqual(['first sent']);
    first.reject(new Error('refused'));
    await expect(a).rejects.toThrow('refused');
    await expect(b).resolves.toBe('two');
    expect(order).toEqual(['first sent', 'second sent']);
  });

  it('a write without an item (a new one) never waits', async () => {
    const lanes = createItemLanes();
    const never = held<void>();
    void lanes.run('subtask:k1', () => never.promise);
    await expect(lanes.run(null, async () => 'now')).resolves.toBe('now');
  });

  it('the subtask, attendance, agenda and action-item writes use item lanes, not a per-task or per-meeting scope', () => {
    const queries = readFileSync(resolve(__dirname, '../core/queries.ts'), 'utf8');
    const meetings = readFileSync(resolve(__dirname, '../core/meeting-mutations.ts'), 'utf8');
    for (const scope of ['checklist:', 'attendance:', 'agenda:', 'action-items:']) {
      expect(queries + meetings).not.toContain(`scope: { id: \`${scope}`);
    }
    expect(queries).toContain('sendItemWrite(itemLanes');
    expect(meetings.match(/sendItemWrite\(itemLanes/g)?.length).toBe(3);
  });
});
