import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Lease-based job lock. `tryAcquire` atomically claims `name` for `leaseMs` iff it is currently
 * free or its lease has expired, returning whether this caller won it. Used to make a scheduled
 * sweep run on only ONE instance at a time (no leader election needed — whoever claims it runs).
 */
export interface JobLockStore {
  /** `holder` (N7): a token of this run's own, recorded with the lease so only this run hands it back. */
  tryAcquire(name: string, leaseMs: number, now: Date, holder?: string): Promise<boolean>;
  /**
   * N7 (13 Nov 2026): hand the lease back as the run ends — only while `holder` still has it (a run that
   * outlasted its lease never frees the lease another instance has taken since). Absent: it runs out.
   */
  release?(name: string, holder: string, now: Date): Promise<void>;
  /**
   * 1.23.1 (lib/job-gate): how a job's work is run — after the database first answered, followed so a
   * stop waits for it, a database blip tried once more. Absent: run as it is.
   */
  attempt?<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * Run `fn` only if this instance can claim the named lock. Across a multi-instance deployment
 * this prevents the same sweep from running concurrently (duplicate notifications / double
 * carry-forward). The lease expires on its own, so a crash mid-run never deadlocks the job.
 * Returns true iff `fn` ran here.
 *
 * N7 (13 Nov 2026): the lease is handed back when the run ends (or throws), so a job runs as often as
 * its timer says — a lease longer than the interval used to skip ticks (meeting completion ran every 10
 * minutes instead of 5, guest conversion every 10 instead of 1). The lease is now only the most a run can
 * hold the job if its instance dies. The hand-back is best effort: if it fails, the lease runs out.
 */
export async function runExclusive(
  store: JobLockStore,
  name: string,
  leaseMs: number,
  now: () => Date,
  fn: () => Promise<void>,
): Promise<boolean> {
  // The lease is taken (its time read) once the job may run, and the work then runs the same way.
  const attempt = store.attempt ? <T,>(work: () => Promise<T>) => store.attempt!(work) : <T,>(work: () => Promise<T>) => work();
  const holder = randomUUID();
  if (!(await attempt(() => store.tryAcquire(name, leaseMs, now(), holder)))) return false;
  try {
    await attempt(fn);
  } finally {
    if (store.release) await attempt(() => store.release!(name, holder, now())).catch(() => undefined);
  }
  return true;
}

/**
 * Prisma-backed lease lock on the `job_locks` table. Acquisition is a single conditional
 * `updateMany` (claim a free/expired lease) with a `create` fallback for the first run; a race
 * loser either updates 0 rows or hits the primary key and is reported as "not acquired".
 */
export function createPrismaJobLockStore(prisma: PrismaClient): JobLockStore {
  return {
    async tryAcquire(name, leaseMs, now, holder) {
      const lockedUntil = new Date(now.getTime() + leaseMs);
      const claimed = await prisma.jobLock.updateMany({
        where: { name, lockedUntil: { lte: now } },
        data: { lockedUntil, holder: holder ?? null },
      });
      if (claimed.count > 0) return true;
      // No row yet (first ever run for this job) — create it; a concurrent creator loses the PK race.
      try {
        await prisma.jobLock.create({ data: { name, lockedUntil, holder: holder ?? null } });
        return true;
      } catch {
        return false;
      }
    },
    async release(name, holder, now) {
      // Only while this run still holds it: one conditional statement on the holder it recorded.
      await prisma.jobLock.updateMany({ where: { name, holder, lockedUntil: { gt: now } }, data: { lockedUntil: now } });
    },
  };
}
