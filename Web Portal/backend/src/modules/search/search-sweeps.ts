import { runExclusive, type JobLockStore } from '../../lib/job-lock';
import { FULL_HEAL_EVERY_MS, FULL_HEAL_LEASE_MS, RECENT_HEAL_EVERY_MS, RECENT_HEAL_LEASE_MS, type TaskSearchSweepLogger } from './task-search-sweeps';

/**
 * 1.23 Search everything's sweeps, beside the task index's (task-search-sweeps), one instance at a
 * time each: the full heal of search_index at startup (straight away) and every six hours; every
 * minute the quick heal, files never read yet (a few at a time), files waiting for AI OCR (when an
 * OCR model is set up) and meaning vectors (when an embedding model is). A failure is logged and the
 * next run tries again; one step failing never stops the others.
 */
export function startSearchSweeps({
  index,
  files,
  semantic,
  lock,
  logger,
  now = () => new Date(),
}: {
  index: { healAll(): Promise<number>; healRecent(): Promise<number> };
  files?: { readUnread(limit?: number): Promise<number>; readByOcr(limit?: number): Promise<number> };
  semantic?: { embedPending(limit?: number): Promise<number> };
  lock: JobLockStore;
  logger: TaskSearchSweepLogger;
  now?: () => Date;
}): { started: Promise<void>; stop(): void } {
  const step = async (name: string, run: () => Promise<number>): Promise<void> => {
    try {
      const count = await run();
      if (count > 0) logger.info('search: items brought up to date', { step: name, count });
    } catch (err) {
      logger.error('search: a sweep step failed', { err, step: name });
    }
  };
  // One minute run at a time on this server (review I4): a run still going (a slow OCR or embedding
  // call) is never started again beside itself when the next minute comes.
  let running = false;
  const recent = async () => {
    if (running) return 0;
    running = true;
    try {
      await step('heal-recent', () => index.healRecent());
      if (files) {
        await step('read-files', () => files.readUnread(20));
        await step('read-files-ocr', () => files.readByOcr(5));
      }
      if (semantic) await step('meaning-vectors', () => semantic.embedPending(100));
    } finally {
      running = false;
    }
    return 0;
  };
  const exclusive = (name: string, leaseMs: number, run: () => Promise<number>) =>
    void runExclusive(lock, name, leaseMs, now, () => step(name, run)).catch((err: unknown) => logger.error('search: a sweep failed', { err, sweep: name }));

  const started = step('heal-startup', () => index.healAll());
  const recentTimer = setInterval(() => exclusive('search-everything-recent', RECENT_HEAL_LEASE_MS, recent), RECENT_HEAL_EVERY_MS);
  const fullTimer = setInterval(() => exclusive('search-everything-all', FULL_HEAL_LEASE_MS, () => index.healAll()), FULL_HEAL_EVERY_MS);
  recentTimer.unref?.();
  fullTimer.unref?.();
  return {
    started,
    stop() {
      clearInterval(recentTimer);
      clearInterval(fullTimer);
    },
  };
}
