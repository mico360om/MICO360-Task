import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { BULK_LABELS, bulkProgressText, bulkResultText, createBulkRefresher, runBulk, type BulkDeps } from './bulk-actions';
import { refresh } from './refresh';
import { afterTaskSaved, assignmentRefreshes, moveRefreshes } from './task-cache';
import { createOfflineReads } from './offline-reads';
import { enrichMyTasks } from './my-tasks';
import type { ApiTask } from './types';

const src = (p: string) => (existsSync(resolve(__dirname, '..', p)) ? readFileSync(resolve(__dirname, '..', p), 'utf8') : '');

const refs = [
  { id: '1', projectId: 'a' },
  { id: '2', projectId: 'a' },
  { id: '3', projectId: 'b' },
];
const deps = (over: Partial<BulkDeps> = {}): BulkDeps => ({
  update: vi.fn(async () => undefined),
  move: vi.fn(async () => undefined),
  assign: vi.fn(async () => undefined),
  doneColumnFor: vi.fn(async () => 'done'),
  ...over,
});

describe('a long bulk run says how far it is and can be stopped (final review A2)', () => {
  it('tells each step, and stops before the next task once it is asked to', async () => {
    const seen: string[] = [];
    let stop = false;
    const d = deps({
      update: vi.fn(async (t) => {
        if (t.id === '2') stop = true;
      }),
    });
    const out = await runBulk(refs, { type: 'setPriority', priority: 'HIGH' }, d, { onProgress: (done, total) => seen.push(`${done}/${total}`), shouldContinue: () => !stop });
    expect(seen).toEqual(['0/3', '1/3', '2/3']);
    expect(out).toEqual({ succeeded: 2, failed: 0, kept: 0, stopped: 1 });
    expect(d.update).toHaveBeenCalledTimes(2);
  });

  it('a run to the end says nothing about stopping', async () => {
    expect(await runBulk(refs, { type: 'complete' }, deps(), { shouldContinue: () => true })).toEqual({ succeeded: 3, failed: 0, kept: 0 });
  });

  it('says how far it is, and what a stop left as it was', () => {
    expect(bulkProgressText(12, 150)).toBe('12 of 150 done…');
    expect(bulkResultText(BULK_LABELS.complete, { succeeded: 12, failed: 0, kept: 0, stopped: 138 })).toBe('Completed 12 tasks. Stopped — 138 tasks weren’t changed.');
    expect(bulkResultText(BULK_LABELS.move, { succeeded: 1, failed: 0, kept: 1, stopped: 1 })).toBe('Moved 1 task. 1 saved on this phone — will sync when you’re online. Stopped — 1 task wasn’t changed.');
    expect(bulkResultText(BULK_LABELS.complete, { succeeded: 0, failed: 0, kept: 0, stopped: 5 })).toBe('Stopped — no tasks were changed.');
  });
});

describe('a bulk run reads the lists once, at the end (final review A2)', () => {
  const task = (id: string): ApiTask => ({ id, key: `K-${id}`, title: id, projectId: 'a', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, estimatedHours: null, progress: 0, completedAt: null, version: 1 }) as ApiTask;

  it('each task’s own data as it goes; My Tasks, the boards, the figures and the calendar once — not once per task', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tasks = Array.from({ length: 150 }, (_, i) => task(String(i)));
    const reads = { mine: 0, board: 0 };
    const watch = (queryKey: string[], count: () => void) => {
      const o = new QueryObserver(qc, {
        queryKey,
        queryFn: async () => {
          count();
          await new Promise((r) => setTimeout(r, 1));
          return tasks;
        },
      });
      return o.subscribe(() => {});
    };
    const stopMine = watch(['tasks', 'mine'], () => (reads.mine += 1));
    const stopBoard = watch(['tasks', 'project', 'a', 'all'], () => (reads.board += 1));
    await vi.waitFor(() => expect(qc.getQueryData(['tasks', 'project', 'a', 'all'])).toBeDefined());
    reads.mine = 0;
    reads.board = 0;

    const applied: unknown[][] = [];
    const r = createBulkRefresher((targets) => {
      applied.push(targets);
      refresh(qc, targets);
    });
    for (const t of tasks) {
      r.add(moveRefreshes(t.id, 'a'));
      r.add(assignmentRefreshes(t.id));
      afterTaskSaved(qc, t.id, undefined, { dueDate: '2026-10-30' }, r.add);
    }
    // Only each task's own keys went as it was done.
    for (const targets of applied) for (const t of targets as { queryKey?: string[] }[]) expect(t.queryKey?.[0]).toBe('task');
    r.finish([{ queryKey: ['tasks', 'mine'] }]);
    await vi.waitFor(() => expect(qc.isFetching()).toBe(0));
    expect(reads).toEqual({ mine: 1, board: 1 });
    const last = JSON.stringify(applied[applied.length - 1]);
    for (const what of ['"tasks","calendar"', '"progressFor"', '"project","a","progress"', '"listsHolding"']) expect(last).toContain(what);
    stopMine();
    stopBoard();
  });

  it('My Tasks’ bulk writes refresh through it, and stop when asked', () => {
    const core = src('core/my-tasks-queries.ts');
    expect(core).toMatch(/createBulkRefresher\(/);
    expect(core).toMatch(/afterTaskSaved\(qc, t\.id, saved, patch, refresher\.add\)/);
    expect(core).toMatch(/refresher\.add\(moveRefreshes\(t\.id, t\.projectId\)\)/);
    expect(core).toMatch(/refresher\.add\(assignmentRefreshes\(t\.id\)\)/);
    expect(core).toMatch(/refresher\.finish\(\[\{ queryKey: \['tasks', 'mine'\] \}\]\)/);
    expect(core).not.toMatch(/refresh\(qc, (moveRefreshes|assignmentRefreshes)\(/);
    const screen = src('screens/MyTasksScreen.tsx');
    expect(screen).toMatch(/bulkProgressText\(progress\.done, progress\.total\)/);
    expect(screen).toMatch(/accessibilityLabel="Stop the bulk action"/);
  });

  it('a reading of My Tasks that is called off stops its download (the list’s fetch gets the signal)', () => {
    expect(src('core/queries.ts')).toMatch(/queryFn: \(\{ queryKey, signal \}\) => reads\.\w+\(queryKey, 'tasks\.mine', \(\) => resources\.tasks\.mine\(\{ signal \}\)/);
    expect(src('lib/resources.ts')).toMatch(/mine: \(opts: \{ signal\?: AbortSignal \} = \{\}\) => data\(client\.get<Envelope<ApiTask\[\]>>\('\/tasks\/mine', opts\.signal \? \{ signal: opts\.signal \} : undefined\)\)/);
  });
});

describe('My Tasks shows what a bulk action kept on this phone (final review A7)', () => {
  const t = (id: string, patch: Partial<ApiTask> = {}): ApiTask =>
    ({ id, key: `K-${id}`, title: id, projectId: 'a', columnId: 'todo', columnCategory: 'TODO', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, estimatedHours: null, progress: 0, completedAt: null, version: 4, ...patch }) as ApiTask;
  const kept = (kind: string, payload: unknown) => ({ kind, payload });

  it('a task completed offline shows as done (not under Open), one moved out of Done as open again; a kept due date and priority show', async () => {
    const pending = [
      kept('task.move', { id: 't1', columnId: 'done', projectId: 'a', category: 'DONE' }),
      kept('task.move', { id: 't2', columnId: 'doing', projectId: 'a', category: 'IN_PROGRESS' }),
      kept('task.update', { id: 't3', patch: { dueDate: '2026-10-30', priority: 'HIGH', expectedVersion: 4 } }),
      kept('task.update', { id: 't3', patch: { priority: 'URGENT', expectedVersion: 5 } }),
    ];
    const reads = createOfflineReads({ cache: { read: async (_key, fetcher) => ({ data: await fetcher(), stale: true }) }, pendingChanges: () => pending as never });
    const listed = [t('t1'), t('t2', { columnId: 'done', columnCategory: 'DONE', completedAt: '2026-10-20T08:00:00Z' }), t('t3'), t('t4')];
    const tasks = await reads.readMyTasks(['tasks', 'mine'], 'tasks.mine', async () => listed);
    const rows = enrichMyTasks(tasks, [], { timeZone: 'Asia/Muscat', now: new Date('2026-10-21T08:00:00Z') });
    expect(rows.map((r) => r.done)).toEqual([true, false, false, false]);
    expect(tasks[2]).toMatchObject({ dueDate: '2026-10-30', priority: 'URGENT', version: 4 });
    expect(tasks[2]).not.toHaveProperty('expectedVersion');
    expect(tasks[3]).toBe(listed[3]);
    expect(rows[2]!.dueKey).toBe('2026-10-30');
  });

  it('My Tasks is read through it', () => {
    expect(src('core/queries.ts')).toMatch(/queryFn: \(\{ queryKey, signal \}\) => reads\.readMyTasks\(queryKey, 'tasks\.mine', /);
  });
});
