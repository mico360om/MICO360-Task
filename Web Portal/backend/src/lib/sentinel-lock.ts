import type { Prisma, PrismaClient } from '@prisma/client';

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

/** A write conflict, a deadlock or MariaDB's snapshot-isolation refusal: the transaction can simply run again. */
export function isRetryableTxError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; meta?: { code?: unknown } | null; message?: unknown };
  if (e.code === 'P2034') return true;
  const dbCode = e.meta && typeof e.meta === 'object' ? String(e.meta.code ?? '') : '';
  if (dbCode === '1020' || dbCode === '1213') return true;
  const text = typeof e.message === 'string' ? e.message.slice(0, 2000) : '';
  return /Record has changed since last read|\b1020\b|Deadlock found|\b1213\b|write conflict or a deadlock/i.test(text);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withSentinelLock<T>(
  prisma: PrismaClient,
  name: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  { attempts = 4, pauseMs = 25 }: SentinelLockOptions = {},
): Promise<T> {
  // The row exists before anyone locks it: locking a missing row would take a gap lock, and two
  // first-ever callers would then deadlock on their inserts. INSERT IGNORE: a no-op once it's there.
  await prisma.jobLock.createMany({ data: [{ name, lockedUntil: new Date(0) }], skipDuplicates: true });
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT name FROM job_locks WHERE name = ${name} FOR UPDATE`;
        return work(tx);
      }, TX);
    } catch (err) {
      if (attempt >= attempts || !isRetryableTxError(err)) throw err;
      if (pauseMs > 0) await pause(pauseMs * attempt + Math.floor(Math.random() * pauseMs));
    }
  }
}
