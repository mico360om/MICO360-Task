import { describe, it, expect, vi, afterEach } from 'vitest';
import type { JobLockStore } from '../../lib/job-lock';
import { FULL_HEAL_EVERY_MS, RECENT_HEAL_EVERY_MS } from './task-search-sweeps';
import { startSearchSweeps } from './search-sweeps';

const lock = (): JobLockStore => {
  const until = new Map<string, number>();
  return {
    async tryAcquire(name, leaseMs, now) {
      const held = until.get(name);
      if (held !== undefined && held > now.getTime()) return false;
      until.set(name, now.getTime() + leaseMs);
      return true;
    },
  };
};
const quiet = { info: vi.fn(), error: vi.fn() };
afterEach(() => vi.useRealTimers());

describe('search everything sweeps', () => {
  it('heals at startup, then every minute heals, reads new files, OCR and vectors; every six hours heals it all', async () => {
    vi.useFakeTimers();
    const index = { healAll: vi.fn(async () => 0), healRecent: vi.fn(async () => 1) };
    const files = { readUnread: vi.fn(async () => 0), readByOcr: vi.fn(async () => 0) };
    const semantic = { embedPending: vi.fn(async () => 0) };
    const sweeps = startSearchSweeps({ index, files, semantic, lock: lock(), logger: quiet });
    await sweeps.started;
    expect(index.healAll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RECENT_HEAL_EVERY_MS * 2);
    expect(index.healRecent).toHaveBeenCalledTimes(2);
    expect(files.readUnread).toHaveBeenCalledWith(20);
    expect(files.readByOcr).toHaveBeenCalledWith(5);
    expect(semantic.embedPending).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(FULL_HEAL_EVERY_MS);
    expect(index.healAll).toHaveBeenCalledTimes(2);
    sweeps.stop();
  });

  it('one failing step never stops the others', async () => {
    vi.useFakeTimers();
    const index = { healAll: vi.fn(async () => 0), healRecent: vi.fn(async () => { throw new Error('db'); }) };
    const files = { readUnread: vi.fn(async () => { throw new Error('disk'); }), readByOcr: vi.fn(async () => 0) };
    const sweeps = startSearchSweeps({ index, files, lock: lock(), logger: quiet });
    await vi.advanceTimersByTimeAsync(RECENT_HEAL_EVERY_MS);
    expect(files.readByOcr).toHaveBeenCalledTimes(1);
    expect(quiet.error).toHaveBeenCalled();
    sweeps.stop();
  });
});
