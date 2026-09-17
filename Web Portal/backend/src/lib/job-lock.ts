import type { PrismaClient } from '@prisma/client';

/**
 * Lease-based job lock. `tryAcquire` atomically claims `name` for `leaseMs` iff it is currently
 * free or its lease has expired, returning whether this caller won it. Used to make a scheduled
 * sweep run on only ONE instance at a time (no leader election needed — whoever claims it runs).
 */
export interface JobLockStore {
  tryAcquire(name: string, leaseMs: number, now: Date): Promise<boolean>;
}

/**
 * Run `fn` only if this instance can claim the named lock. Across a multi-instance deployment
 * this prevents the same sweep from running concurrently (duplicate notifications / double
 * carry-forward). The lease expires on its own, so a crash mid-run never deadlocks the job.
 * Returns true iff `fn` ran here.
 */
export async function runExclusive(
  store: JobLockStore,
  name: string,
  leaseMs: number,
  now: () => Date,
  fn: () => Promise<void>,
): Promise<boolean> {
  if (!(await store.tryAcquire(name, leaseMs, now()))) return false;
  await fn();
  return true;
}

/**
 * Prisma-backed lease lock on the `job_locks` table. Acquisition is a single conditional
 * `updateMany` (claim a free/expired lease) with a `create` fallback for the first run; a race
 * loser either updates 0 rows or hits the primary key and is reported as "not acquired".
 */
export function createPrismaJobLockStore(prisma: PrismaClient): JobLockStore {
  return {
    async tryAcquire(name, leaseMs, now) {
      const lockedUntil = new Date(now.getTime() + leaseMs);
      const claimed = await prisma.jobLock.updateMany({
        where: { name, lockedUntil: { lte: now } },
        data: { lockedUntil },
      });
      if (claimed.count > 0) return true;
      // No row yet (first ever run for this job) — create it; a concurrent creator loses the PK race.
      try {
        await prisma.jobLock.create({ data: { name, lockedUntil } });
        return true;
      } catch {
        return false;
      }
    },
  };
}
