import { databaseConnectionCode } from './db-connection';
import type { JobLockStore } from './job-lock';

/**
 * 1.23.1 — when background jobs may use the database. On the live site the every-minute jobs (daily task
 * emails, weekly management summary) recorded "Can't reach database server" exactly at deploy
 * restarts: they ran before the database answered the new server, and while the old one stopped. Now:
 *
 *   - jobs start only after the first successful database query (`ready`; asked again every few
 *     seconds until then — a warning line, never an error);
 *   - a job's database work that meets a blip (lib/db-connection) is tried once more after a short
 *     wait before it counts (and is recorded by the job);
 *   - `stop()` (SIGTERM/SIGINT, before the database client disconnects) starts nothing more, stops the
 *     timers and waits a little for the jobs running to finish.
 *
 * Every job runs through `runExclusive` with the lock `lock()` wraps (or `attempt` directly), so this is
 * the one place the rule lives.
 */
export interface JobGate {
  /** Resolves once the database first answered (never rejects). */
  readonly ready: Promise<void>;
  /** True once stop() was called. */
  readonly stopping: boolean;
  /** A lock whose jobs (through runExclusive) wait for `ready`, start nothing while stopping, and try a blip once more. */
  lock(store: JobLockStore): JobLockStore;
  /** A job's database work: after `ready`, followed until stop() waits for it, a blip tried once more. */
  attempt<T>(work: () => Promise<T>): Promise<T>;
  /** Run `run` once the database is ready (or `firstAfterMs` after that), then every `everyMs`, until stop(). */
  every(everyMs: number, run: () => unknown, opts?: { firstAfterMs?: number }): void;
  /** Start nothing more, stop the timers, and wait (at most `graceMs`) for the work running. */
  stop(graceMs?: number): Promise<void>;
}

export interface JobGateOptions {
  /** A harmless database query (SELECT 1). */
  probe: () => Promise<unknown>;
  /** How long a job waits before trying a blip once more. */
  retryDelayMs?: number;
  /** How often the probe is asked again until the database answers. */
  probeEveryMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** A plain warning line (never the Error log). */
  warn?: (message: string, meta?: Record<string, unknown>) => void;
}

export const JOB_RETRY_DELAY_MS = 5000;
const PROBE_EVERY_MS = 5000;
const STOP_GRACE_MS = 10_000;

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

export function createJobGate(opts: JobGateOptions): JobGate {
  const retryDelayMs = opts.retryDelayMs ?? JOB_RETRY_DELAY_MS;
  const probeEveryMs = opts.probeEveryMs ?? PROBE_EVERY_MS;
  const sleep = opts.sleep ?? realSleep;
  let stopping = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();
  const running = new Set<Promise<unknown>>();

  const later = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        timers.delete(t);
        resolve();
      }, ms);
      t.unref?.();
      timers.add(t);
    });

  const ready = (async () => {
    let warned = false;
    for (;;) {
      try {
        await opts.probe();
        return;
      } catch (err) {
        if (!warned) {
          warned = true;
          try {
            opts.warn?.('background jobs wait for the database', { code: databaseConnectionCode(err) ?? undefined, error: err instanceof Error ? err.message.split('\n').find((l) => l.trim()) : String(err) });
          } catch {
            // A warning line can never stop the jobs from starting.
          }
        }
        if (stopping) return new Promise<void>(() => {}); // never ready: nothing will start
        await later(probeEveryMs);
      }
    }
  })();

  async function attempt<T>(work: () => Promise<T>): Promise<T> {
    await ready;
    const run = (async () => {
      try {
        return await work();
      } catch (err) {
        if (stopping || !databaseConnectionCode(err)) throw err;
        await sleep(retryDelayMs);
        if (stopping) throw err;
        return work();
      }
    })();
    running.add(run);
    void run.then(
      () => running.delete(run),
      () => running.delete(run),
    );
    return run;
  }

  return {
    ready,
    get stopping() {
      return stopping;
    },
    lock(store) {
      return {
        // runExclusive asks through `attempt` (after `ready`, a blip tried once more): only the stop is checked here.
        async tryAcquire(name, leaseMs, now, holder) {
          if (stopping) return false;
          return store.tryAcquire(name, leaseMs, now, holder);
        },
        // N7: a run's lease is handed back as it ends — even while the server stops (the next server can start it).
        ...(store.release ? { release: (name: string, holder: string, now: Date) => store.release!(name, holder, now) } : {}),
        attempt,
      };
    },
    attempt,
    every(everyMs, run, { firstAfterMs = 0 } = {}) {
      // Review #34: one run of a job at a time in this process — a tick that comes while the last run is
      // still going is skipped (a lease that ran out no longer lets a second run start here).
      let busy = false;
      const go = () => {
        if (stopping || busy) return;
        busy = true;
        try {
          void Promise.resolve(run())
            .catch(() => {})
            .finally(() => {
              busy = false;
            });
        } catch {
          // A job's own failure is its to report.
          busy = false;
        }
      };
      void ready.then(async () => {
        if (stopping) return;
        if (firstAfterMs > 0) await later(firstAfterMs);
        if (stopping) return;
        go();
        const t = setInterval(go, everyMs);
        t.unref?.();
        intervals.add(t);
      });
    },
    async stop(graceMs = STOP_GRACE_MS) {
      stopping = true;
      for (const t of intervals) clearInterval(t);
      intervals.clear();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (running.size === 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...running]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, graceMs);
          timer.unref?.();
        }),
      ]);
      if (timer) clearTimeout(timer);
    },
  };
}
