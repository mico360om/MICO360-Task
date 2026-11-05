import { describe, it, expect, vi, afterEach } from 'vitest';
import type { JobLockStore } from '../../lib/job-lock';
import { FULL_HEAL_EVERY_MS, RECENT_HEAL_EVERY_MS, startTaskSearchSweeps } from './task-search-sweeps';
import { startSearchSweeps } from './search-sweeps';
import { createJobGate } from '../../lib/job-gate';

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

// 1.23.1 — the sweeps go through the job gate like every job: nothing before the database answered, a
// blip tried once more before it is logged (and recorded in the Error log).
describe('task search and search everything sweeps — the job gate', () => {
  const blip = () => Object.assign(new Error("Can't reach database server"), { name: 'PrismaClientKnownRequestError', code: 'P1001' });

  it('the startup heal waits for the database', async () => {
    let answer!: () => void;
    const gate = createJobGate({ probe: () => new Promise<void>((r) => (answer = r)) });
    const index = fakeIndex();
    const sweeps = startTaskSearchSweeps({ index, lock: gate.lock(leaseLock()), logger: quiet });
    const other = fakeIndex();
    const more = startSearchSweeps({ index: other, lock: gate.lock(leaseLock()), logger: quiet });
    await new Promise((r) => setTimeout(r, 5));
    expect(index.healAll).not.toHaveBeenCalled();
    expect(other.healAll).not.toHaveBeenCalled();
    answer();
    await sweeps.started;
    await more.started;
    expect(index.healAll).toHaveBeenCalledTimes(1);
    expect(other.healAll).toHaveBeenCalledTimes(1);
    sweeps.stop();
    more.stop();
  });

  it('a blip in a heal is tried once more, and only a second one is logged', async () => {
    const gate = createJobGate({ probe: async () => {}, sleep: async () => {} });
    const errors: unknown[] = [];
    const logger = { info: vi.fn(), error: (_m: string, meta?: Record<string, unknown>) => void errors.push(meta?.err) };
    const index = { healAll: vi.fn(async () => { if (index.healAll.mock.calls.length === 1) throw blip(); return 0; }), healRecent: vi.fn(async () => 0) };
    const sweeps = startTaskSearchSweeps({ index, lock: gate.lock(leaseLock()), logger });
    await sweeps.started;
    expect(index.healAll).toHaveBeenCalledTimes(2);
    expect(errors).toEqual([]);
    const other = { healAll: vi.fn(async () => { throw blip(); }), healRecent: vi.fn(async () => 0) };
    const more = startSearchSweeps({ index: other, lock: gate.lock(leaseLock()), logger });
    await more.started;
    expect(other.healAll).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(1);
    sweeps.stop();
    more.stop();
  });
});
