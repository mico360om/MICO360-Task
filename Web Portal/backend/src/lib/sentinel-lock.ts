import type { Prisma, PrismaClient } from '@prisma/client';
import { saveConflict, withoutSaveRetry } from './save-retry';

/**
 * Review fix #8 (13 Nov 2026) — one at a time across the whole site: a transaction that first locks a
 * sentinel row of `job_locks` (made when missing; no scheduled job uses these names), then runs `work`.
 *
 * The lock is the transaction's FIRST statement, before any plain read: at the server's own isolation
 * level (REPEATABLE READ) the snapshot starts at the first plain read, so it starts only after whoever
 * held the lock has committed, and sees what they did. No isolation statement is used — the live
 * MariaDB's statement-based binary log refuses READ COMMITTED writes (error 1665; see merge-service and
 * lib/sql-portability). MariaDB 11.8 with `innodb_snapshot_isolation` ON can still refuse a write to a row
 * someone changed after the snapshot began (error 1020 "Record has changed since last read"), and any
 * database can pick a deadlock victim: then the whole transaction is tried again.
 */
export interface SentinelLockOptions {
  /** Tries in all (default 4). */
  attempts?: number;
  /** The pause before a retry grows from this (ms; default 25, with jitter). */
  pauseMs?: number;
}

const TX = { maxWait: 15_000, timeout: 30_000 } as const;

/**
 * A write conflict, a deadlock or MariaDB's snapshot-isolation refusal: the transaction can simply run again.
 * 1.23.29: first the shapes Prisma really gives (lib/save-retry, the server's retry layer); then, for an error
 * with no code of its own, the words. A known error with a code is what its code says.
 */
export function isRetryableTxError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (saveConflict(err)) return true;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code !== undefined) return false;
  const text = typeof e.message === 'string' ? e.message.slice(0, 2000) : '';
  return /Record has changed since last read|\b1020\b|Deadlock found|\b1213\b|write conflict or a deadlock/i.test(text);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withSentinelLock<T>(
  prisma: PrismaClient,
  name: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: SentinelLockOptions = {},
): Promise<T> {
  // The row exists before anyone locks it: locking a missing row would take a gap lock, and two
  // first-ever callers would then deadlock on their inserts. INSERT IGNORE: a no-op once it's there.
  await prisma.jobLock.createMany({ data: [{ name, lockedUntil: new Date(0) }], skipDuplicates: true });
  return withRowLock(prisma, (tx) => tx.$queryRaw`SELECT name FROM job_locks WHERE name = ${name} FOR UPDATE`, (tx) => work(tx), opts);
}

/**
 * Review batch 4a (13 Nov 2026) — the same rule for any row that already exists (a board column, a
 * project): `lock` is the transaction's FIRST statement (a `SELECT … FOR UPDATE` of that one row), then
 * `work` runs with what it read. Tried again, whole, on a deadlock, P2034 or MariaDB's error 1020.
 */
export async function withRowLock<L, T>(
  prisma: PrismaClient,
  lock: (tx: Prisma.TransactionClient) => Promise<L>,
  work: (tx: Prisma.TransactionClient, locked: L) => Promise<T>,
  { attempts = 4, pauseMs = 25 }: SentinelLockOptions = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      // 1.23.29: these tries are its own — the server's retry layer stays out of them (never 4 × 3).
      return await withoutSaveRetry(() => prisma.$transaction(async (tx) => work(tx, await lock(tx)), TX));
    } catch (err) {
      if (attempt >= attempts || !isRetryableTxError(err)) throw err;
      if (pauseMs > 0) await pause(pauseMs * attempt + Math.floor(Math.random() * pauseMs));
    }
  }
}
