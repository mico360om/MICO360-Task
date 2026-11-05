import { describe, it, expect, vi, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { createJobGate } from './job-gate';
import { runExclusive, type JobLockStore } from './job-lock';

// 1.23.1 — on the live site "Can't reach database server" (P1001) was recorded for the every-minute jobs
// (weekly management summary, daily task emails) exactly at deploy restarts: they ran before the
// database answered, and while the old server stopped. A short blip in a job is tried once more.
const blip = () => new Prisma.PrismaClientKnownRequestError("Can't reach database server at `db`:`3306`", { code: 'P1001', clientVersion: '5.22.0' });
const tick = () => new Promise((r) => setTimeout(r, 0));
afterEach(() => vi.useRealTimers());

/** A probe that fails `n` times, then answers. */
function probeFailing(n: number) {
  let calls = 0;
  return { calls: () => calls, probe: async () => { calls += 1; if (calls <= n) throw blip(); } };
}

describe('job gate: background jobs start once the database answered', () => {
  it('a job waits for the first successful database query (asked again every few seconds), then runs and repeats', async () => {
    vi.useFakeTimers();
    const p = probeFailing(2);
    const warned: string[] = [];
    const gate = createJobGate({ probe: p.probe, probeEveryMs: 1000, warn: (m) => warned.push(m) });
    const run = vi.fn(async () => {});
    gate.every(60_000, run);
    await vi.advanceTimersByTimeAsync(10);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(p.calls()).toBe(3);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    // Waiting for the database is a warning line once — never an error (nothing for the Error log).
    expect(warned).toHaveLength(1);
    await gate.stop();
  });

  it('a first run can wait a while after that (the nightly backup’s two minutes)', async () => {
    vi.useFakeTimers();
    const gate = createJobGate({ probe: async () => {} });
    const run = vi.fn(async () => {});
    gate.every(10 * 60_000, run, { firstAfterMs: 2 * 60_000 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    await gate.stop();
  });

  it('a gated lock is asked only after the database answered; never once the server is stopping', async () => {
    let answer!: () => void;
    const gate = createJobGate({ probe: () => new Promise<void>((r) => (answer = r)) });
    const inner: JobLockStore = { tryAcquire: vi.fn(async () => true) };
    const lock = gate.lock(inner);
    const fn = vi.fn(async () => {});
    const ran = runExclusive(lock, 'daily-task-emails', 55_000, () => new Date(), fn);
    await tick();
    expect(inner.tryAcquire).not.toHaveBeenCalled();
    answer();
    expect(await ran).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    await gate.stop();
    expect(await runExclusive(lock, 'daily-task-emails', 55_000, () => new Date(), fn)).toBe(false);
    expect(inner.tryAcquire).toHaveBeenCalledTimes(1);
  });
});

describe('job gate: a database blip in a job is tried once more before it counts', () => {
  it('the job’s work after a connection error: once more after the wait, and then it ran', async () => {
    const waits: number[] = [];
    const gate = createJobGate({ probe: async () => {}, retryDelayMs: 5000, sleep: async (ms) => void waits.push(ms) });
    let calls = 0;
    const lock = gate.lock({ tryAcquire: async () => true });
    const ok = await runExclusive(lock, 'weekly-management-summary', 55_000, () => new Date(), async () => {
      calls += 1;
      if (calls === 1) throw blip();
    });
    expect(ok).toBe(true);
    expect(calls).toBe(2);
    expect(waits).toEqual([5000]);
  });

  it('taking the lease itself is tried once more too', async () => {
    const gate = createJobGate({ probe: async () => {}, sleep: async () => {} });
    let asked = 0;
    const lock = gate.lock({ tryAcquire: async () => { asked += 1; if (asked === 1) throw blip(); return true; } });
    expect(await runExclusive(lock, 'j', 1000, () => new Date(), async () => {})).toBe(true);
    expect(asked).toBe(2);
  });

  it('failing again, it is the error (recorded by the job); any other error is never tried again', async () => {
    const gate = createJobGate({ probe: async () => {}, sleep: async () => {} });
    const lock = gate.lock({ tryAcquire: async () => true });
    let calls = 0;
    await expect(runExclusive(lock, 'j', 1000, () => new Date(), async () => { calls += 1; throw blip(); })).rejects.toMatchObject({ code: 'P1001' });
    expect(calls).toBe(2);
    calls = 0;
    await expect(runExclusive(lock, 'j', 1000, () => new Date(), async () => { calls += 1; throw new Error('a bug'); })).rejects.toThrow('a bug');
    expect(calls).toBe(1);
  });
});

describe('job gate: stopping (a deploy restart) — before the database client disconnects', () => {
  it('stops the timers and waits for the jobs running to finish', async () => {
    vi.useFakeTimers();
    const gate = createJobGate({ probe: async () => {} });
    let finish!: () => void;
    let finished = false;
    const lock = gate.lock({ tryAcquire: async () => true });
    const run = vi.fn(() => runExclusive(lock, 'j', 1000, () => new Date(), () => new Promise<void>((r) => (finish = () => { finished = true; r(); }))));
    gate.every(60_000, run);
    await vi.advanceTimersByTimeAsync(10);
    expect(run).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = gate.stop(10_000).then(() => (stopped = true));
    expect(gate.stopping).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(stopped).toBe(false); // the job is still running
    finish();
    await stopping;
    expect(finished).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(1); // no new runs
  });

  it('a job that doesn’t finish holds the stop no longer than its grace', async () => {
    vi.useFakeTimers();
    const gate = createJobGate({ probe: async () => {} });
    const lock = gate.lock({ tryAcquire: async () => true });
    void runExclusive(lock, 'j', 1000, () => new Date(), () => new Promise<void>(() => {}));
    await vi.advanceTimersByTimeAsync(10);
    let stopped = false;
    void gate.stop(3000).then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(2999);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(stopped).toBe(true);
  });

  it('a blip while stopping is not tried again', async () => {
    const waits: number[] = [];
    const gate = createJobGate({ probe: async () => {}, sleep: async (ms) => void waits.push(ms) });
    await gate.ready;
    let calls = 0;
    const work = gate.attempt(async () => { calls += 1; await tick(); throw blip(); });
    void gate.stop(1000);
    await expect(work).rejects.toMatchObject({ code: 'P1001' });
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  });

  it('jobs that never got the database never ran; stopping then is immediate', async () => {
    const gate = createJobGate({ probe: async () => { throw blip(); }, probeEveryMs: 60_000 });
    const run = vi.fn(async () => {});
    gate.every(1000, run);
    await gate.stop(1000);
    expect(run).not.toHaveBeenCalled();
  });
});
