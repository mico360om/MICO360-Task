import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { createRefreshBatcher, REALTIME_BATCH_MS } from './refresh-batch';
import { refresh, type Refresh } from './refresh';
import { taskEventRefreshes } from './realtime';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const board: Refresh = { queryKey: ['tasks', 'project', 'p1'] };
const mine: Refresh = { queryKey: ['tasks', 'mine'] };
const task = (id: string): Refresh => ({ queryKey: ['task', id], exact: true });

describe('createRefreshBatcher (realtime events refresh once per short window)', () => {
  it('waits about 300 ms', () => {
    expect(REALTIME_BATCH_MS).toBe(300);
  });

  it('refreshes a burst of events once, each target once', () => {
    const apply = vi.fn();
    const batch = createRefreshBatcher(apply);
    batch.add([board, mine, task('t1')]);
    batch.add([board, mine, task('t2')]);
    batch.add([board, task('t1')]);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REALTIME_BATCH_MS);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0]).toEqual([board, mine, task('t1'), task('t2')]);
  });

  it('keeps refreshing during a steady stream (the window doesn’t restart with each event)', () => {
    const apply = vi.fn();
    const batch = createRefreshBatcher(apply);
    batch.add([task('t1')]);
    vi.advanceTimersByTime(200);
    batch.add([task('t2')]);
    vi.advanceTimersByTime(100);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0]).toEqual([task('t1'), task('t2')]);
    batch.add([task('t3')]);
    vi.advanceTimersByTime(REALTIME_BATCH_MS);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1]![0]).toEqual([task('t3')]);
  });

  it('refreshes what is waiting at once on flush (the screen closing), and nothing later', () => {
    const apply = vi.fn();
    const batch = createRefreshBatcher(apply);
    batch.add([board]);
    batch.flush();
    expect(apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REALTIME_BATCH_MS);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('can refresh the first event at once and gather only the ones right after it (chat)', () => {
    const apply = vi.fn();
    const batch = createRefreshBatcher(apply, { leading: true });
    batch.add([task('t1')]);
    expect(apply).toHaveBeenCalledTimes(1);
    batch.add([task('t2')]);
    batch.add([task('t3')]);
    expect(apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REALTIME_BATCH_MS);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1]![0]).toEqual([task('t2'), task('t3')]);
    // A quiet window closes without a pass; the next event is refreshed at once again.
    vi.advanceTimersByTime(REALTIME_BATCH_MS);
    batch.add([task('t4')]);
    expect(apply).toHaveBeenCalledTimes(3);
  });

  it('turns a burst of 30 board events into one fetch of the board on screen', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } });
    const tasks = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, projectId: 'p1' }));
    const queryFn = vi.fn(async () => tasks);
    const stop = new QueryObserver(qc, { queryKey: ['tasks', 'project', 'p1', '2026-10-21'], queryFn }).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(1);
    const batch = createRefreshBatcher((targets) => refresh(qc, targets));
    for (const t of tasks) batch.add(taskEventRefreshes('task:moved', 'p1', t));
    await vi.advanceTimersByTimeAsync(REALTIME_BATCH_MS);
    expect(queryFn).toHaveBeenCalledTimes(2);
    stop();
    qc.clear();
  });

  it('does nothing when nothing is waiting', () => {
    const apply = vi.fn();
    const batch = createRefreshBatcher(apply);
    batch.flush();
    batch.add([]);
    vi.advanceTimersByTime(REALTIME_BATCH_MS);
    expect(apply).not.toHaveBeenCalled();
  });
});
