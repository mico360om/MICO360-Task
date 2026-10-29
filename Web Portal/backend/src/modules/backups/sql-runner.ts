import { Prisma, type PrismaClient } from '@prisma/client';

/** The few SQL calls the backup and restore code needs, so it can run on any Prisma client (or a fake). */
export interface SqlRunner {
  query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  execute(sql: string, ...params: unknown[]): Promise<number>;
  /**
   * Run `fn` on one connection inside one REPEATABLE READ transaction: every read sees the database
   * as it was at the first one (a consistent snapshot), and session settings stay on that connection.
   */
  transaction<T>(fn: (tx: SqlRunner) => Promise<T>, opts?: { timeoutMs?: number }): Promise<T>;
}

/** Long enough for the biggest backup or table restore; a stuck one is still ended eventually. */
const DEFAULT_TIMEOUT_MS = 3 * 60 * 60 * 1000;

type RawClient = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;

export function prismaSqlRunner(prisma: PrismaClient): SqlRunner {
  const wrap = (client: RawClient, inTransaction: boolean): SqlRunner => {
    const runner: SqlRunner = {
      query: <T>(sql: string, ...params: unknown[]) => client.$queryRawUnsafe<T[]>(sql, ...params),
      execute: (sql, ...params) => client.$executeRawUnsafe(sql, ...params),
      transaction: (fn, opts) =>
        inTransaction
          ? fn(runner)
          : prisma.$transaction((tx) => fn(wrap(tx, true)), {
              isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
              timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
              maxWait: 60_000,
            }),
    };
    return runner;
  };
  return wrap(prisma, false);
}
