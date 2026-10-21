import { describe, it, expect, afterEach } from 'vitest';
import { MutationObserver, type QueryClient } from '@tanstack/react-query';
import { rescheduleOptions, type RescheduleVars } from './calendar-move';
import { createQueryClient } from './query-client';
import { createSyncQueue } from './sync-queue';
import { createMemoryStore } from './storage';
import { createTaskWrites } from './task-writes';
import { ApiError, NetworkError } from './api-client';
import type { CalendarRange } from './calendar-data';
import type { CalendarTask } from './calendar-model';
import type { ApiTask } from './types';

const clients: QueryClient[] = [];
afterEach(() => {
  for (const qc of clients.splice(0)) qc.clear();
});

const RANGE_KEY = ['tasks', 'calendar', '2026-09-27', '2026-10-31'];
const task = (over: Partial<CalendarTask> = {}): CalendarTask => ({
  id: 't1', key: 'MICO-1', title: 'Pour the slab', description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0,
  priority: 'NORMAL', startDate: null, dueDate: '2026-10-12T00:00:00.000Z', estimatedHours: null, progress: 0, completedAt: null, version: 4, ...over,
});
const range = (tasks: CalendarTask[]): CalendarRange & { savedCopy: null } => ({ from: '2026-09-27', to: '2026-10-31', timeZone: 'Asia/Muscat', tasks, occurrences: [], series: [], savedCopy: null });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The calendar's move as the app runs it: one user, the sync queue, the task-write lanes and the query client. */
async function app(answer: (id: string, body: Record<string, unknown>) => Promise<ApiTask | undefined>) {
  const qc = createQueryClient();
  clients.push(qc);
  const queue = createSyncQueue({ store: createMemoryStore(), perform: async () => undefined });
  await queue.load();
  const sent: { id: string; body: Record<string, unknown> }[] = [];
  const writes = createTaskWrites();
  const options = rescheduleOptions(
    {
      update: (id, body) => {
        sent.push({ id, body: body as Record<string, unknown> });
        return answer(id, body as Record<string, unknown>);
      },
      queue,
      userId: () => 'u1',
      writes,
    },
    qc,
  );
  qc.setQueryData(RANGE_KEY, range([task()]));
  const move = (vars: RescheduleVars) => new MutationObserver(qc, options).mutate(vars).catch((e: unknown) => e);
  const dueOf = () => (qc.getQueryData(RANGE_KEY) as CalendarRange).tasks[0]!.dueDate;
  return { qc, queue, sent, writes, move, dueOf };
}

const vars = (over: Partial<RescheduleVars> = {}): RescheduleVars => ({ taskId: 't1', patch: { dueDate: '2026-10-14' }, readVersion: 4, ...over });

describe('moving a task on the calendar', () => {
  it('shows it on its new day at once, saves it against the version read, and refreshes what shows it', async () => {
    const server = deferred<ApiTask | undefined>();
    const a = await app(() => server.promise);
    const done = a.move(vars());
    await new Promise((r) => setTimeout(r, 0));
    expect(a.dueOf()).toBe('2026-10-14T00:00:00.000Z');
    expect(a.sent).toEqual([{ id: 't1', body: { dueDate: '2026-10-14', expectedVersion: 4 } }]);
    server.resolve({ ...task({ dueDate: '2026-10-14T00:00:00.000Z', version: 5 }) } as unknown as ApiTask);
    await done;
    expect(a.qc.getQueryData<ApiTask>(['task', 't1'])?.version).toBe(5);
    expect(a.qc.getQueryState(RANGE_KEY)?.isInvalidated).toBe(true);
    expect(a.queue.pendingFor('u1')).toEqual([]);
  });

  it('sends a quick second move after the first, against the version the first one made — not the one the calendar read', async () => {
    let version = 4;
    const first = deferred<ApiTask | undefined>();
    const a = await app(async () => (a.sent.length === 1 ? first.promise : ({ ...task(), version: ++version } as unknown as ApiTask)));
    const one = a.move(vars());
    const two = a.move(vars({ patch: { dueDate: '2026-10-15' } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(a.sent).toHaveLength(1); // the second waits for the first
    first.resolve({ ...task(), version: ++version } as unknown as ApiTask);
    await Promise.all([one, two]);
    expect(a.sent.map((s) => [s.body.dueDate, s.body.expectedVersion])).toEqual([['2026-10-14', 4], ['2026-10-15', 5]]);
  });

  it('a repeating task’s move carries its rule', async () => {
    const a = await app(async () => undefined);
    const rule = { freq: 'WEEKLY' as const, interval: 1, resumeFrom: '2026-10-12' };
    await a.move(vars({ patch: { dueDate: '2026-10-14', recurrenceRule: rule } }));
    expect(a.sent[0]!.body).toEqual({ dueDate: '2026-10-14', recurrenceRule: rule, expectedVersion: 4 });
  });

  it('refused by the server: back on its day, nothing kept for later', async () => {
    const a = await app(async () => {
      throw new ApiError(409, 'VERSION_CONFLICT', 'Changed by someone else');
    });
    const err = await a.move(vars());
    expect(err).toBeInstanceOf(ApiError);
    expect(a.dueOf()).toBe('2026-10-12T00:00:00.000Z');
    expect(a.queue.pendingFor('u1')).toEqual([]);
    expect(a.qc.getQueryState(RANGE_KEY)?.isInvalidated).toBe(true);
  });

  it('no answer: stays on its new day and is kept on this phone once, with the version it was made against', async () => {
    const a = await app(async () => {
      throw new NetworkError('offline');
    });
    await a.move(vars());
    expect(a.dueOf()).toBe('2026-10-14T00:00:00.000Z');
    expect(a.queue.pendingFor('u1').map((m) => [m.kind, m.payload])).toEqual([['task.update', { id: 't1', patch: { dueDate: '2026-10-14', expectedVersion: 4 } }]]);
  });

  it('waits behind an older change of the task still on this phone, instead of overtaking it', async () => {
    const a = await app(async () => undefined);
    await a.queue.enqueue('task.update', { id: 't1', patch: { title: 'Renamed', expectedVersion: 4 } }, { userId: 'u1' });
    await a.move(vars());
    expect(a.sent).toEqual([]);
    expect(a.queue.pendingFor('u1').map((m) => (m.payload as { patch: object }).patch)).toEqual([{ title: 'Renamed', expectedVersion: 4 }, { dueDate: '2026-10-14', expectedVersion: 4 }]);
    expect(a.dueOf()).toBe('2026-10-14T00:00:00.000Z');
  });
});
