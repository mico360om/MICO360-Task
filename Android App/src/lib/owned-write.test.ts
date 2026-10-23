import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApiClient, NetworkError, isNetworkError } from './api-client';
import { createItemLanes, sendItemWrite } from './item-lanes';
import { createSyncQueue } from './sync-queue';
import { ownedWrite, ownerOf } from './owned-write';
import { queueOnOffline } from './write-order';
import { resourcesApi } from './resources';
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

function held<T>() {
  let release!: (v: T) => void;
  const promise = new Promise<T>((res) => (release = res));
  return { promise, release };
}

/** A shared phone: who is signed in (and with whose token), the requests that left, the queue. */
async function phone() {
  let signedIn: string | null = 'ann';
  const sent: { url: string; auth: string | undefined }[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    return new Response(JSON.stringify({ data: { id: 'i1', done: false } }), { status: 200 });
  }) as unknown as typeof fetch;
  const api = createApiClient({ baseUrl: 'https://x.test/api/v1', getToken: () => (signedIn ? `token-${signedIn}` : null), getUserId: () => signedIn, fetchImpl });
  const queue = createSyncQueue({ store: fakeStore(), perform: async () => undefined });
  await queue.load();
  const services = { currentUserId: () => signedIn, api, resources: resourcesApi(api), queue, sync: { trigger: vi.fn() } };
  return {
    services,
    queue,
    sent,
    switchTo: (who: string | null) => {
      signedIn = who;
    },
  };
}

describe('a change goes as the person who made it, never as whoever is signed in when it is sent (4b review #1)', () => {
  it('a change waiting in its lane past a switch of person is neither sent nor kept for anyone', async () => {
    const { services, queue, sent, switchTo } = await phone();
    const lanes = createItemLanes();
    const write = { kind: 'checklist.update', payload: { id: 't1', itemId: 'i1', patch: { done: false } } };
    // Ann ticks a step on a slow server; her untick waits in the step's lane behind it.
    const first = held<void>();
    const tick = lanes.run('subtask:i1', () => first.promise);
    const w = ownedWrite(services);
    const untick = sendItemWrite(lanes, w.order, write, () => w.resources.tasks.updateChecklistItem('i1', { done: false })).catch((e: unknown) => e);
    // Ann signs out and Bob signs in before the lane frees.
    switchTo(null);
    switchTo('bob');
    first.release();
    await tick;
    const err = (await untick) as { code?: string };
    expect(err.code).toBe('SESSION_CHANGED');
    expect(sent).toEqual([]);
    expect(queue.pending()).toEqual([]);
  });

  it('sent with its maker’s session while they are still signed in', async () => {
    const { services, sent } = await phone();
    const w = ownedWrite(services);
    await w.resources.tasks.updateChecklistItem('i1', { done: true });
    expect(sent).toEqual([{ url: 'https://x.test/api/v1/checklist/i1', auth: 'Bearer token-ann' }]);
  });

  it('a change that gets no answer is kept for its maker — and not once someone else is signed in', async () => {
    const { services, queue, switchTo } = await phone();
    const write = { kind: 'checklist.update', payload: { id: 't1', itemId: 'i1', patch: { done: true } } };
    const w = ownedWrite(services);
    await sendItemWrite(createItemLanes(), w.order, write, () => Promise.reject(new NetworkError('offline'))).catch(() => {});
    expect(queue.pending().map((m) => m.userId)).toEqual(['ann']);
    await queue.clear();
    const w2 = ownedWrite(services);
    await sendItemWrite(createItemLanes(), w2.order, write, async () => {
      switchTo('bob');
      throw new NetworkError('offline');
    }).catch(() => {});
    expect(queue.pending()).toEqual([]);
  });

  it('a change sent at once whose answer is lost after a switch is never kept for the new person', async () => {
    const { services, queue, switchTo } = await phone();
    const w = ownedWrite(services);
    const err = await w
      .run(async () => {
        switchTo('bob');
        throw new NetworkError('offline');
      })
      .catch((e: unknown) => e);
    expect(isNetworkError(err)).toBe(true);
    expect(ownerOf(err)).toBe('ann');
    // The screen's offline path (onError) keeps it for whoever is signed in — not when that isn't its maker.
    await queueOnOffline(queue, services.currentUserId(), err, 'comment.add', { id: 't1', body: 'hi' });
    expect(queue.pending()).toEqual([]);
    // Its maker still signed in: kept for them, as before.
    switchTo('ann');
    const err2 = await ownedWrite(services)
      .run(async () => {
        throw new NetworkError('offline');
      })
      .catch((e: unknown) => e);
    await queueOnOffline(queue, services.currentUserId(), err2, 'comment.add', { id: 't1', body: 'hi' });
    expect(queue.pending().map((m) => m.userId)).toEqual(['ann']);
  });

  it('every write in a lane or a mutation scope captures its maker before it waits (tasks, moves, steps, people, meetings, chat, account, columns, calendar)', () => {
    const core = (p: string) => readFileSync(resolve(__dirname, '../core', p), 'utf8');
    const files = ['queries.ts', 'meeting-mutations.ts', 'chat-features.ts', 'account-queries.ts', 'board-queries.ts', 'new-task.ts', 'all-board-queries.ts', 'calendar-queries.ts', 'my-tasks-queries.ts'];
    for (const f of files) {
      const text = core(f);
      // No write order or resources read inside a lane: the lane's work uses what ownedWrite captured.
      expect(text, f).not.toMatch(/writeOrder\(services\)/);
      expect(text, f).not.toMatch(/(itemLanes|taskWrites)\.run\([^\n]*\(\) =>\s*resources\./);
    }
    // A TanStack scope runs the whole write later (as whoever is signed in then): the people's
    // changes go in an item lane now; the answer to an invitation keeps its scope (its optimistic
    // answers in order) and is given its maker when it is given.
    const queries = core('queries.ts');
    expect(queries).not.toMatch(/scope: assigneesScope\(/);
    expect(queries).toMatch(/send\(\{ \.\.\.v, owner: services\.currentUserId\(\) \}, opts\)/);
    expect(queries).toMatch(/\(owner \? resourcesApi\(services\.api\.forUser\(owner\)\) : services\.resources\)\.meetings\.respond\(/);
    const calendar = readFileSync(resolve(__dirname, 'calendar-move.ts'), 'utf8');
    expect(calendar).toMatch(/const owner = deps\.userId\(\);/);
  });
});

describe('what a change says when it ends is said to the person who made it only (final review A5)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('nothing is said once they have signed out (and someone else in)', async () => {
    const { stillSignedIn } = await import('./owned-write');
    expect(stillSignedIn('ann', 'ann')).toBe(true);
    expect(stillSignedIn('ann', 'bob')).toBe(false);
    expect(stillSignedIn('ann', null)).toBe(false);
    expect(stillSignedIn(null, null)).toBe(false);
  });

  it('the Edit form’s “kept on this phone”, My Tasks’ bulk result and the boards’ refusals check it', () => {
    const form = src('screens/NewTaskScreen.tsx');
    expect(form).toMatch(/const maker = currentUserId\(\);\s+try \{\s+const out = await saveEditTask\(/);
    expect(form).toMatch(/if \(out\.kind === 'kept' && stillSignedIn\(maker, currentUserId\(\)\)\) notice\(out\.message\);/);
    const myTasks = src('screens/MyTasksScreen.tsx');
    expect(myTasks).toMatch(/const maker = currentUserId\(\);/);
    expect(myTasks).toMatch(/if \(!stillSignedIn\(maker, currentUserId\(\)\)\) return;\s+setSelected\(new Set\(\)\);\s+notice\(bulkResultText\(label, result\)\);/);
    for (const board of ['screens/BoardScreen.tsx', 'screens/AllBoardScreen.tsx']) {
      const screen = src(board);
      expect(screen, board).toMatch(/const maker = currentUserId\(\);/);
      expect(screen, board).toMatch(/if \(!stillSignedIn\(maker, currentUserId\(\)\)\) return;/);
    }
    expect((src('screens/BoardScreen.tsx').match(/if \(!stillSignedIn\(maker, currentUserId\(\)\)\) return;/g) ?? []).length).toBe(2);
  });

  it('a bulk run stops once its maker isn’t signed in: the rest never go as the next person', () => {
    expect(src('core/my-tasks-queries.ts')).toMatch(/const maker = services\.currentUserId\(\);[\s\S]*shouldContinue: \(\) => stillSignedIn\(maker, services\.currentUserId\(\)\) && \(opts\?\.shouldContinue\?\.\(\) \?\? true\)/);
  });
});
