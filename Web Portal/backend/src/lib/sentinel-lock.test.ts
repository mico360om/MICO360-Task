import { describe, it, expect, vi } from 'vitest';
import { isRetryableTxError, withSentinelLock } from './sentinel-lock';
import { withSaveRetries } from './save-retry';

/** A Prisma client fake: records the statements, runs the transaction body with a tx that can be made to fail. */
function fakePrisma(failTimes: number, error: unknown) {
  const statements: string[] = [];
  let failures = 0;
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push(strings.join('?') + ` [${values.join(',')}]`);
      return [];
    }),
  };
  const prisma = {
    jobLock: {
      createMany: vi.fn(async (args: { data: Array<{ name: string }>; skipDuplicates: boolean }) => {
        statements.push(`ensure ${args.data.map((d) => d.name).join(',')} skip=${args.skipDuplicates}`);
        return { count: 1 };
      }),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      const result = await fn(tx);
      if (failures < failTimes) {
        failures++;
        throw error;
      }
      return result;
    }),
  };
  return { prisma, statements };
}

describe('withSentinelLock (review fix #8)', () => {
  it('makes the sentinel row when missing, then locks it FIRST in the transaction, before the work', async () => {
    const { prisma, statements } = fakePrisma(0, null);
    const out = await withSentinelLock(prisma as never, 'admin-guard', async (tx) => {
      statements.push('work');
      expect(tx).toBeDefined();
      return 42;
    });
    expect(out).toBe(42);
    expect(statements[0]).toBe('ensure admin-guard skip=true');
    expect(statements[1]).toMatch(/^SELECT name FROM job_locks WHERE name = \? FOR UPDATE \[admin-guard\]$/);
    expect(statements[2]).toBe('work');
  });

  it('MariaDB 11.8 snapshot isolation (error 1020) and deadlocks: the whole transaction is tried again', async () => {
    const changed = Object.assign(new Error("Raw query failed. Code: `1020`. Message: `Record has changed since last read in table 'users'`"), { code: 'P2010', meta: { code: '1020' } });
    const { prisma } = fakePrisma(2, changed);
    let runs = 0;
    await expect(withSentinelLock(prisma as never, 'admin-guard', async () => ++runs, { pauseMs: 0 })).resolves.toBe(3);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('gives up after its tries, with the database’s own error', async () => {
    const deadlock = Object.assign(new Error('Transaction failed due to a write conflict or a deadlock. Please retry your transaction'), { code: 'P2034' });
    const { prisma } = fakePrisma(10, deadlock);
    await expect(withSentinelLock(prisma as never, 'admin-guard', async () => 1, { attempts: 3, pauseMs: 0 })).rejects.toBe(deadlock);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('a refusal from the work itself (LAST_ADMIN) is never retried', async () => {
    const refusal = Object.assign(new Error('This is the last active administrator.'), { code: 'LAST_ADMIN', status: 409 });
    const { prisma } = fakePrisma(0, null);
    let runs = 0;
    await expect(
      withSentinelLock(prisma as never, 'admin-guard', async () => {
        runs++;
        throw refusal;
      }),
    ).rejects.toBe(refusal);
    expect(runs).toBe(1);
  });

  it('isRetryableTxError: 1020, 1213, P2034 and their words; nothing else', () => {
    expect(isRetryableTxError({ code: 'P2034' })).toBe(true);
    expect(isRetryableTxError({ code: 'P2010', meta: { code: '1213' } })).toBe(true);
    expect(isRetryableTxError(new Error("Record has changed since last read in table 'users'"))).toBe(true);
    expect(isRetryableTxError(new Error('Deadlock found when trying to get lock; try restarting transaction'))).toBe(true);
    expect(isRetryableTxError(new Error('Server error 1020 (HY000)'))).toBe(true);
    expect(isRetryableTxError({ code: 'P2002' })).toBe(false);
    expect(isRetryableTxError({ code: 'LAST_ADMIN', status: 409 })).toBe(false);
    expect(isRetryableTxError(new Error('Something else'))).toBe(false);
    expect(isRetryableTxError(null)).toBe(false);
  });

  // 1.23.29 — it starts from lib/save-retry's shape check (the server's retry layer uses the same one).
  it('isRetryableTxError: the shapes Prisma really gives (lib/save-retry); a known error is what its code says, whatever its words', () => {
    const unknown1020 = Object.assign(new Error('ConnectorError { kind: QueryError(Server(MysqlError { code: 1020, message: "x", state: "HY000" })) }'), { name: 'PrismaClientUnknownRequestError' });
    expect(isRetryableTxError(unknown1020)).toBe(true);
    expect(isRetryableTxError({ code: 'P2010', meta: { code: '1020' } })).toBe(true);
    // A not-found whose code frame quotes a comment about 1020 is still a not-found.
    expect(isRetryableTxError(Object.assign(new Error('// error 1020: Record has changed since last read'), { code: 'P2025' }))).toBe(false);
    expect(isRetryableTxError({ code: 'P2010', meta: { code: '1062' }, message: 'Deadlock found' })).toBe(false);
  });

  it('with the server’s save retry layer on the client, its own tries stay its own (4, never 4 × 3)', async () => {
    const changed = Object.assign(new Error('Raw query failed. Code: `1020`.'), { code: 'P2010', meta: { code: '1020' } });
    const { prisma } = fakePrisma(100, changed);
    const own = prisma.$transaction;
    withSaveRetries(Object.assign(prisma, { $use: vi.fn() }), { pause: async () => {} });
    await expect(withSentinelLock(prisma as never, 'admin-guard', async () => 1, { pauseMs: 0 })).rejects.toBe(changed);
    expect(own).toHaveBeenCalledTimes(4);
  });
});
