import { describe, it, expect, vi, afterEach } from 'vitest';
import type { JobLockStore } from '../../lib/job-lock';
import { FULL_HEAL_EVERY_MS, RECENT_HEAL_EVERY_MS, startTaskSearchSweeps } from './task-search-sweeps';

/** A lease lock like job_locks: a claim holds until its lease runs out (it is never handed back early). */
function leaseLock(): JobLockStore & { claims: string[] } {
  const until = new Map<string, number>();
  const claims: string[] = [];
  return {
    claims,
    async tryAcquire(name, leaseMs, now) {
      const held = until.get(name);
      if (held !== undefined && held > now.getTime()) return false;
      until.set(name, now.getTime() + leaseMs);
      claims.push(name);
      return true;
    },
  };
}
function fakeIndex() {
  return { healAll: vi.fn(async () => 0), healRecent: vi.fn(async () => 0) };
}
const quiet = { info: vi.fn(), error: vi.fn() };
afterEach(() => vi.useRealTimers());

describe('task search sweeps', () => {
  it('heals the whole index at startup straight away — never skipped because a run just before held the lock', async () => {
    vi.useFakeTimers();
    const lock = leaseLock();
    await lock.tryAcquire('search-index-heal-all', 60 * 60 * 1000, new Date()); // the previous start, a moment ago
    const index = fakeIndex();
    const sweeps = startTaskSearchSweeps({ index, lock, logger: quiet });
    await sweeps.started;
    expect(index.healAll).toHaveBeenCalledTimes(1);
    sweeps.stop();
  });

  it('runs the quick heal every minute (its lease is shorter than the minute)', async () => {
    vi.useFakeTimers();
    const index = fakeIndex();
    const sweeps = startTaskSearchSweeps({ index, lock: leaseLock(), logger: quiet });
    await vi.advanceTimersByTimeAsync(RECENT_HEAL_EVERY_MS * 3);
    expect(index.healRecent).toHaveBeenCalledTimes(3);
    sweeps.stop();
  });

  it('runs the full heal every six hours, one instance at a time', async () => {
    vi.useFakeTimers();
    const index = fakeIndex();
    const lock = leaseLock();
    const sweeps = startTaskSearchSweeps({ index, lock, logger: quiet });
    await sweeps.started;
    await vi.advanceTimersByTimeAsync(FULL_HEAL_EVERY_MS * 2);
    expect(index.healAll).toHaveBeenCalledTimes(3); // at startup, then twice
    expect(lock.claims.filter((n) => n === 'search-index-heal-all')).toHaveLength(2);
    sweeps.stop();
  });

  it('a failing heal is logged and the next run still comes', async () => {
    vi.useFakeTimers();
    const index = fakeIndex();
    index.healRecent.mockRejectedValueOnce(new Error('database away'));
    const logger = { info: vi.fn(), error: vi.fn() };
    const sweeps = startTaskSearchSweeps({ index, lock: leaseLock(), logger });
    await vi.advanceTimersByTimeAsync(RECENT_HEAL_EVERY_MS * 2);
    expect(logger.error).toHaveBeenCalledWith('task search: the index sweep failed', expect.objectContaining({ sweep: 'search-index-heal-recent' }));
    expect(index.healRecent).toHaveBeenCalledTimes(2);
    sweeps.stop();
  });

  it('says how many tasks a heal re-indexed, and stops when asked', async () => {
    vi.useFakeTimers();
    const index = fakeIndex();
    index.healAll.mockResolvedValueOnce(12);
    const logger = { info: vi.fn(), error: vi.fn() };
    const sweeps = startTaskSearchSweeps({ index, lock: leaseLock(), logger });
    await sweeps.started;
    expect(logger.info).toHaveBeenCalledWith('task search: tasks re-indexed', { sweep: 'search-index-heal-startup', count: 12 });
    sweeps.stop();
    await vi.advanceTimersByTimeAsync(FULL_HEAL_EVERY_MS);
    expect(index.healRecent).not.toHaveBeenCalled();
  });
});
