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

/** N7 (13 Nov 2026): the in-memory lease lock with holders and hand-back, as the database store. */
function releasingStore() {
  const leases = new Map<string, { until: number; holder?: string }>();
  const store: JobLockStore = {
    async tryAcquire(name, leaseMs, now, holder) {
      const l = leases.get(name);
      if (l && l.until > now.getTime()) return false;
      leases.set(name, { until: now.getTime() + leaseMs, holder });
      return true;
    },
    async release(name, holder, now) {
      const l = leases.get(name);
      if (l && l.holder === holder) leases.set(name, { until: now.getTime(), holder });
    },
  };
  return { store, leases };
}

describe('runExclusive hands the lease back when the run ends (N7)', () => {
  it('a job every 5 minutes under a 10-minute lease runs every 5 minutes (it ran every 10)', async () => {
    const { store } = releasingStore();
    let t = Date.parse('2026-11-13T00:00:00Z');
    const now = () => new Date(t);
    let ran = 0;
    for (let tick = 0; tick < 6; tick++) {
      await runExclusive(store, 'meeting-completion-sweep', 10 * 60_000, now, async () => { ran++; });
      t += 5 * 60_000;
    }
    expect(ran).toBe(6);
  });

  it('a job every minute under a 10-minute lease runs every minute (the guest conversion)', async () => {
    const { store } = releasingStore();
    let t = Date.parse('2026-11-13T00:00:00Z');
    let ran = 0;
    for (let tick = 0; tick < 10; tick++) {
      await runExclusive(store, 'guest-conversion', 10 * 60_000, () => new Date(t), async () => { ran++; });
      t += 60_000;
    }
    expect(ran).toBe(10);
  });

  it('a run that throws still hands its lease back, and its error still reaches the job', async () => {
    const { store } = releasingStore();
    const now = new Date('2026-11-13T00:00:00Z');
    const boom = new Error('the sweep failed');
    await expect(runExclusive(store, 'training-starter-pdfs', 10 * 60_000, () => now, async () => { throw boom; })).rejects.toBe(boom);
    expect(await runExclusive(store, 'training-starter-pdfs', 10 * 60_000, () => now, async () => {})).toBe(true);
  });

  it('while a run is going, its lease holds (no second run anywhere)', async () => {
    const { store } = releasingStore();
    const now = new Date('2026-11-13T00:00:00Z');
    let second: boolean | undefined;
    await runExclusive(store, 'sweep', 60_000, () => now, async () => {
      second = await runExclusive(store, 'sweep', 60_000, () => now, async () => {});
    });
    expect(second).toBe(false);
  });

  it('only its own lease: a run that outlasted its lease never hands back the lease another took since', async () => {
    const { store } = releasingStore();
    let t = Date.parse('2026-11-13T00:00:00Z');
    const now = () => new Date(t);
    let finishB!: () => void;
    let b!: Promise<boolean>;
    await runExclusive(store, 'sweep', 60_000, now, async () => {
      t += 2 * 60_000; // this run outlasts its lease, and another instance takes the lock meanwhile
      b = runExclusive(store, 'sweep', 10 * 60_000, now, () => new Promise<void>((r) => (finishB = r)));
      await new Promise((r) => setTimeout(r, 0));
    });
    // The first run's hand-back changed nothing: the other still holds the lock, so a third can't start.
    expect(await runExclusive(store, 'sweep', 60_000, now, async () => {})).toBe(false);
    finishB();
    expect(await b).toBe(true);
    // The other handed its own lease back when it ended.
    expect(await runExclusive(store, 'sweep', 60_000, now, async () => {})).toBe(true);
  });

  it('a different holder each run (the hand-back checks it)', async () => {
    const seen: (string | undefined)[] = [];
    const store: JobLockStore = {
      async tryAcquire(_name, _lease, _now, holder) { seen.push(holder); return true; },
      async release() {},
    };
    await runExclusive(store, 'a', 1000, () => new Date(), async () => {});
    await runExclusive(store, 'a', 1000, () => new Date(), async () => {});
    expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[1]).not.toBe(seen[0]);
  });

  it('a store that cannot hand back (older fakes) works as before: the lease simply runs out', async () => {
    const store = memStore();
    const now = new Date('2026-11-13T00:00:00Z');
    expect(await runExclusive(store, 'x', 60_000, () => now, async () => {})).toBe(true);
    expect(await runExclusive(store, 'x', 60_000, () => now, async () => {})).toBe(false);
  });

  it('a hand-back that fails is quiet: the run counts as done and the lease runs out on its own', async () => {
    const store: JobLockStore = {
      async tryAcquire() { return true; },
      async release() { throw new Error("Can't reach database server"); },
    };
    await expect(runExclusive(store, 'x', 60_000, () => new Date(), async () => {})).resolves.toBe(true);
  });
});
