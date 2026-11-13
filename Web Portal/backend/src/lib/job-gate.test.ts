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

// Review #34 (13 Nov 2026): with a lease that has run out, one process started the same job again while
// its last run was still going (3 at once in the repro). A timer tick now waits its turn: while the
// job's previous run is going, the tick is skipped.
describe('job gate: a job never runs twice at once in one process (#34)', () => {
  it('a run longer than its interval (and its lease) skips the ticks that come meanwhile', async () => {
    const gate = createJobGate({ probe: async () => 1 });
    const lock = gate.lock({
      // A lease that has always run out (as for a run longer than it): only this process can stop a second run.
      async tryAcquire() { return true; },
    });
    let running = 0;
    let most = 0;
    let runs = 0;
    gate.every(60, () =>
      runExclusive(lock, 'daily-task-emails', 55, () => new Date(), async () => {
        runs++;
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 150));
        running--;
      }),
    );
    await new Promise((r) => setTimeout(r, 400));
    await gate.stop(1000);
    expect(most).toBe(1);
    expect(runs).toBeGreaterThanOrEqual(2);
  });

  it('a run shorter than its interval runs at every tick, as before', async () => {
    vi.useFakeTimers();
    const gate = createJobGate({ probe: async () => {} });
    const run = vi.fn(async () => {});
    gate.every(60_000, run);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(run).toHaveBeenCalledTimes(4);
    await gate.stop();
  });

  it('a run that failed lets the next tick run', async () => {
    vi.useFakeTimers();
    const gate = createJobGate({ probe: async () => {} });
    const run = vi.fn(async () => {
      throw new Error('failed');
    });
    gate.every(60_000, run);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    await gate.stop();
  });

  it('the gated lock passes the holder through and hands the lease back through the store', async () => {
    const gate = createJobGate({ probe: async () => {} });
    const calls: string[] = [];
    const lock = gate.lock({
      async tryAcquire(name, _lease, _now, holder) { calls.push(`take ${name} ${holder ? 'with holder' : 'no holder'}`); return true; },
      async release(name, holder) { calls.push(`give back ${name} ${holder ? 'with holder' : 'no holder'}`); },
    });
    await runExclusive(lock, 'meeting-completion-sweep', 600_000, () => new Date(), async () => void calls.push('work'));
    expect(calls).toEqual(['take meeting-completion-sweep with holder', 'work', 'give back meeting-completion-sweep with holder']);
    await gate.stop();
  });
});

// Batch 4b (review of 4a, M6): a run that never finishes keeps its job from starting again in this process — so
// such a run is reported (a warning line, once per run) when it has gone on far longer than its interval. It is
// never stopped: a slow run may be doing real work.
describe('job gate: a run going on far longer than its interval is reported, never stopped', () => {
  it('warns once — naming the job and how long it has run — when a run passes 3× its interval (at least 5 minutes)', async () => {
    vi.useFakeTimers();
    const warned: { message: string; meta?: Record<string, unknown> }[] = [];
    const gate = createJobGate({ probe: async () => {}, warn: (message, meta) => warned.push({ message, meta }) });
    let finish!: () => void;
    const started = vi.fn();
    // A plain named function, as the server's jobs are (`const runDailyTaskEmails = () => …`).
    const runDailyTaskEmails = () => {
      started();
      return new Promise<void>((r) => (finish = r));
    };
    gate.every(60_000, runDailyTaskEmails);
    await vi.advanceTimersByTimeAsync(10);
    expect(started).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 60_000); // 4 minutes: under the 5-minute floor
    expect(warned).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2 * 60_000); // 6 minutes
    expect(warned).toHaveLength(1);
    expect(warned[0]!.message).toMatch(/still running/i);
    expect(warned[0]!.meta).toMatchObject({ job: 'runDailyTaskEmails', everyMs: 60_000 });
    expect(Number(warned[0]!.meta!.runningForMs)).toBeGreaterThanOrEqual(5 * 60_000);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(warned).toHaveLength(1); // once per run
    expect(started).toHaveBeenCalledTimes(1); // never a second run beside it, never stopped
    finish();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(started).toHaveBeenCalledTimes(2);
    await gate.stop();
  });

  it('a long job (6 hours) is warned about only past 3× its own interval; a normal run never', async () => {
    vi.useFakeTimers();
    const warned: string[] = [];
    const gate = createJobGate({ probe: async () => {}, warn: (m) => warned.push(m) });
    const quick = vi.fn(async () => {});
    gate.every(60_000, quick, { name: 'quick' });
    let finish!: () => void;
    const slow = vi.fn(() => new Promise<void>((r) => (finish = r)));
    gate.every(6 * 60 * 60_000, slow, { name: 'training-starter' });
    await vi.advanceTimersByTimeAsync(17 * 60 * 60_000);
    expect(warned).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(warned).toHaveLength(1);
    finish();
    await gate.stop();
  });
});
