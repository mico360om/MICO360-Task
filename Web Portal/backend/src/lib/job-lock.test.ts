import { describe, it, expect } from 'vitest';
import { runExclusive, type JobLockStore } from './job-lock';

/** In-memory lease lock (mirrors the DB store's semantics) for testing runExclusive. */
function memStore(): JobLockStore {
  const until = new Map<string, number>();
  return {
    async tryAcquire(name, leaseMs, now) {
      const u = until.get(name);
      if (u !== undefined && u > now.getTime()) return false;
      until.set(name, now.getTime() + leaseMs);
      return true;
    },
  };
}

describe('runExclusive', () => {
  it('runs the job when the lock is free and reports that it ran', async () => {
    const store = memStore();
    let ran = 0;
    const did = await runExclusive(store, 'sweep', 60_000, () => new Date(), async () => { ran++; });
    expect(did).toBe(true);
    expect(ran).toBe(1);
  });

  it('does NOT run a second time while another holder still has the lease (no duplicate work)', async () => {
    const store = memStore();
    const now = new Date('2026-09-09T00:00:00Z');
    let ran = 0;
    const a = await runExclusive(store, 'sweep', 60_000, () => now, async () => { ran++; });
    const b = await runExclusive(store, 'sweep', 60_000, () => now, async () => { ran++; });
    expect(a).toBe(true);
    expect(b).toBe(false);
    expect(ran).toBe(1);
  });

  it('re-acquires once the lease has expired (a crashed holder never deadlocks the job)', async () => {
    const store = memStore();
    let t = Date.parse('2026-09-09T00:00:00Z');
    const now = () => new Date(t);
    let ran = 0;
    await runExclusive(store, 'sweep', 60_000, now, async () => { ran++; });
    t += 61_000; // lease expired
    const again = await runExclusive(store, 'sweep', 60_000, now, async () => { ran++; });
    expect(again).toBe(true);
    expect(ran).toBe(2);
  });

  it('treats different lock names independently', async () => {
    const store = memStore();
    const now = new Date();
    const a = await runExclusive(store, 'reminders', 60_000, () => now, async () => {});
    const b = await runExclusive(store, 'carry-forward', 60_000, () => now, async () => {});
    expect(a).toBe(true);
    expect(b).toBe(true);
  });
});
