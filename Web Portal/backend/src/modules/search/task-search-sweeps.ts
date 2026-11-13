import { runExclusive, type JobLockStore } from '../../lib/job-lock';

/** The quick heal (tasks with no entry, or edited since they were read) runs this often… */
export const RECENT_HEAL_EVERY_MS = 60 * 1000;
/** …under a lease shorter than that (N7: a run hands its lease back as it ends; the lease bounds a dead instance's hold). */
export const RECENT_HEAL_LEASE_MS = 50 * 1000;
/** The full heal (every task whose words changed any other way) runs this often, one instance at a time. */
export const FULL_HEAL_EVERY_MS = 6 * 60 * 60 * 1000;
export const FULL_HEAL_LEASE_MS = 30 * 60 * 1000;

export interface TaskSearchSweepLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * The task search index's sweeps: the full heal once at startup — straight away, whatever ran
 * before (a restart soon after the last one must not skip it, and a repeat is harmless) — then the
 * quick heal every minute and the full heal every six hours, each on one instance at a time. A
 * failure is logged and the next run tries again.
 */
export function startTaskSearchSweeps({
  index,
  lock,
  logger,
  now = () => new Date(),
}: {
  index: { healAll(): Promise<number>; healRecent(): Promise<number> };
  lock: JobLockStore;
  logger: TaskSearchSweepLogger;
  now?: () => Date;
}): { started: Promise<void>; stop(): void } {
  // 1.23.1 (lib/job-gate): through the lock's gate — after the database answered, a blip tried once more.
  const attempt = <T,>(work: () => Promise<T>): Promise<T> => (lock.attempt ? lock.attempt(work) : work());
  const heal = async (sweep: string, run: () => Promise<number>): Promise<void> => {
    try {
      const count = await attempt(run);
      if (count > 0) logger.info('task search: tasks re-indexed', { sweep, count });
    } catch (err) {
      logger.error('task search: the index sweep failed', { err, sweep });
    }
  };
  const exclusive = (sweep: string, leaseMs: number, run: () => Promise<number>) =>
    void runExclusive(lock, sweep, leaseMs, now, () => heal(sweep, run)).catch((err: unknown) => logger.error('task search: the index sweep failed', { err, sweep }));

  const started = heal('search-index-heal-startup', () => index.healAll());
  const recent = setInterval(() => exclusive('search-index-heal-recent', RECENT_HEAL_LEASE_MS, () => index.healRecent()), RECENT_HEAL_EVERY_MS);
  const full = setInterval(() => exclusive('search-index-heal-all', FULL_HEAL_LEASE_MS, () => index.healAll()), FULL_HEAL_EVERY_MS);
  recent.unref?.();
  full.unref?.();
  return {
    started,
    stop() {
      clearInterval(recent);
      clearInterval(full);
    },
  };
}
