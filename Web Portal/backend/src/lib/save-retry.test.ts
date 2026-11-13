import { describe, it, expect, vi } from 'vitest';
import { saveConflict, savePauseMs, SAVE_ATTEMPTS, withSaveRetries, withoutSaveRetry } from './save-retry';

/**
 * 1.23.29 — save conflicts (MariaDB's error 1020 with innodb_snapshot_isolation ON, deadlocks) are tried
 * again by one layer on the server's Prisma client. The errors below are copied from what Prisma 5.22 really
 * threw on MariaDB 11.8.9 and MySQL 8 (the lane's probe, .superpowers/rt/probe-*.log).
 */
const unknown1020 = Object.assign(
  new Error(
    'Invalid `prisma.task.update()` invocation:\n\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(Server(MysqlError { code: 1020, message: "Record has changed since last read in table \'tasks\'; try restarting transaction", state: "HY000" })), transient: false })',
  ),
  { name: 'PrismaClientUnknownRequestError', clientVersion: '5.22.0' },
);
const batch1020 = Object.assign(
  new Error(
    'Invalid `prisma.jobLock.update()` invocation:\n\nError in batch request 0: Error occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(Server(MysqlError { code: 1020, message: "Record has changed since last read in table \'job_locks\'; try restarting transaction", state: "HY000" })), transient: false })',
  ),
  { name: 'PrismaClientUnknownRequestError', clientVersion: '5.22.0' },
);
const unknown1213 = Object.assign(
  new Error('Error occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(Server(MysqlError { code: 1213, message: "Deadlock found when trying to get lock; try restarting transaction", state: "40001" })), transient: false })'),
  { name: 'PrismaClientUnknownRequestError', clientVersion: '5.22.0' },
);
const raw1020 = Object.assign(new Error("Raw query failed. Code: `1020`. Message: `Record has changed since last read in table 'job_locks'; try restarting transaction`"), {
  name: 'PrismaClientKnownRequestError',
  code: 'P2010',
  meta: { code: '1020', message: "Record has changed since last read in table 'job_locks'; try restarting transaction" },
});
const raw1213 = Object.assign(new Error('Raw query failed. Code: `1213`. Message: `Deadlock found when trying to get lock; try restarting transaction`'), {
  name: 'PrismaClientKnownRequestError',
  code: 'P2010',
  meta: { code: '1213', message: 'Deadlock found when trying to get lock; try restarting transaction' },
});
const p2034 = Object.assign(new Error('Transaction failed due to a write conflict or a deadlock. Please retry your transaction'), {
  name: 'PrismaClientKnownRequestError',
  code: 'P2034',
  meta: { modelName: 'JobLock' },
});
const unique = Object.assign(new Error('Unique constraint failed on the constraint: `PRIMARY`'), { name: 'PrismaClientKnownRequestError', code: 'P2002', meta: { modelName: 'JobLock', target: 'PRIMARY' } });
const notFound = Object.assign(new Error('An operation failed because it depends on one or more records that were required but not found. Record to update not found.'), {
  name: 'PrismaClientKnownRequestError',
  code: 'P2025',
  meta: { modelName: 'Task', cause: 'Record to update not found.' },
});

describe('saveConflict: which errors are a save conflict worth trying again', () => {
  it('MariaDB 1020 and deadlocks, in every shape Prisma 5.22 gives them', () => {
    expect(saveConflict(unknown1020)).toBe('1020'); // update / upsert / delete / updateMany on MariaDB
    expect(saveConflict(batch1020)).toBe('1020'); // $transaction([…])
    expect(saveConflict(unknown1213)).toBe('1213');
    expect(saveConflict(raw1020)).toBe('1020'); // $executeRaw / $queryRaw: P2010 with the server's code
    expect(saveConflict(raw1213)).toBe('1213');
    expect(saveConflict(p2034)).toBe('P2034'); // a model call's deadlock (MySQL 8 and MariaDB)
  });

  it('nothing else: unique clashes, not found, other server errors, validation errors, plain errors', () => {
    expect(saveConflict(unique)).toBeNull();
    expect(saveConflict(notFound)).toBeNull();
    expect(saveConflict({ code: 'P2010', meta: { code: '1062' } })).toBeNull();
    expect(saveConflict({ code: 'P2010', meta: { code: '1205' } })).toBeNull(); // lock wait timeout: left out (ruling)
    expect(saveConflict(Object.assign(new Error('MysqlError { code: 1205, message: "Lock wait timeout exceeded" }'), { name: 'PrismaClientUnknownRequestError' }))).toBeNull();
    // A validation error quotes the call's arguments: words or numbers in the saved values never count.
    const validation = Object.assign(new Error('Invalid `prisma.task.update()` invocation: { data: { title: "Record has changed since last read 1020 MysqlError { code: 1020, deadlock" } } Unknown argument `titel`.'), {
      name: 'PrismaClientValidationError',
    });
    expect(saveConflict(validation)).toBeNull();
    // A known error with its own code is never read by its words (the code frame may quote a comment).
    expect(saveConflict(Object.assign(new Error('// error 1020 MysqlError { code: 1020, …'), { name: 'PrismaClientKnownRequestError', code: 'P2025' }))).toBeNull();
    expect(saveConflict(new Error("Record has changed since last read in table 'tasks'"))).toBeNull();
    expect(saveConflict(new Error('Deadlock found when trying to get lock'))).toBeNull();
    expect(saveConflict(null)).toBeNull();
    expect(saveConflict('1020')).toBeNull();
  });
});

describe('savePauseMs: a short random pause that grows', () => {
  it('15–30 ms before the 2nd try, 30–60 ms before the 3rd', () => {
    expect(savePauseMs(1, () => 0)).toBe(15);
    expect(savePauseMs(1, () => 0.999)).toBe(29);
    expect(savePauseMs(2, () => 0)).toBe(30);
    expect(savePauseMs(2, () => 0.999)).toBe(59);
    expect(SAVE_ATTEMPTS).toBe(3);
  });
});

type Params = { model?: string; action: string; args: unknown; dataPath: string[]; runInTransaction: boolean };
type Middleware = (params: Params, next: (p: Params) => Promise<unknown>) => Promise<unknown>;

/**
 * A Prisma 5.22 client fake. `call` runs a model call the way Prisma's _request does: the middlewares in the
 * order they were added, sharing ONE index per request — a `next` past the last middleware runs the query
 * (`run`). `$transaction(fn)` hands the callback a tx whose calls run with runInTransaction; `$transaction([…])`
 * hands the array to `batch`.
 */
function fakeClient(run: (p: Params) => Promise<unknown>, batch: (items: unknown[]) => Promise<unknown> = async (items) => items) {
  const middlewares: Middleware[] = [];
  const request = (p: Params) => {
    let index = -1;
    const step = async (q: Params): Promise<unknown> => {
      const mw = middlewares[++index];
      if (mw) return mw(q, (r) => step(r));
      return run(q);
    };
    return step(p);
  };
  const call = (model: string | undefined, action: string, args: unknown = {}, inTx = false) => request({ model, action, args, dataPath: [], runInTransaction: inTx });
  const tx = { call: (model: string | undefined, action: string, args: unknown = {}) => call(model, action, args, true) };
  const client = {
    middlewares,
    $use: vi.fn((mw: Middleware) => {
      middlewares.push(mw);
    }),
    call,
    $transaction: vi.fn(async (arg: unknown, _opts?: unknown) => (typeof arg === 'function' ? (arg as (t: typeof tx) => Promise<unknown>)(tx) : batch(arg as unknown[]))),
  };
  return client;
}

const quiet = () => {
  const lines: { level: 'info' | 'warn'; msg: string; ctx: Record<string, unknown> }[] = [];
  return {
    lines,
    logger: {
      info: (msg: string, ctx?: Record<string, unknown>) => void lines.push({ level: 'info', msg, ctx: ctx ?? {} }),
      warn: (msg: string, ctx?: Record<string, unknown>) => void lines.push({ level: 'warn', msg, ctx: ctx ?? {} }),
    },
  };
};
const noPause = { pause: async () => {}, random: () => 0 };

describe('withSaveRetries: one call outside a transaction (Prisma’s own BEGIN, SELECT, UPDATE)', () => {
  it('is tried again after a save conflict and saves; one quiet line says what, how many tries, and that it saved', async () => {
    let n = 0;
    const client = fakeClient(async (p) => {
      if (++n === 1) throw unknown1020;
      return { id: 't1', title: (p.args as { data: { title: string } }).data.title };
    });
    const { lines, logger } = quiet();
    withSaveRetries(client, { logger, ...noPause });
    await expect(client.call('Task', 'update', { where: { id: 't1' }, data: { title: 'Secret plan for Contoso' } })).resolves.toEqual({ id: 't1', title: 'Secret plan for Contoso' });
    expect(n).toBe(2);
    expect(lines).toEqual([{ level: 'info', msg: 'save conflict', ctx: { model: 'Task', operation: 'update', attempts: 2, conflict: '1020', outcome: 'saved' } }]);
    expect(JSON.stringify(lines)).not.toMatch(/Secret|Contoso|t1/); // never the query's values
  });

  it('stops at 3 tries in all, with the database’s own error, and says so once', async () => {
    let n = 0;
    const client = fakeClient(async () => {
      n++;
      throw unknown1020;
    });
    const { lines, logger } = quiet();
    const pauses: number[] = [];
    withSaveRetries(client, { logger, pause: async (ms) => void pauses.push(ms), random: () => 0.5 });
    await expect(client.call('Task', 'update')).rejects.toBe(unknown1020);
    expect(n).toBe(3);
    expect(pauses).toEqual([22, 45]); // 15–30 ms, then 30–60 ms
    expect(lines).toEqual([{ level: 'warn', msg: 'save conflict', ctx: { model: 'Task', operation: 'update', attempts: 3, conflict: '1020', outcome: 'failed' } }]);
  });

  it('deadlocks (1213, P2034) and raw statements (P2010) are tried again too', async () => {
    for (const err of [unknown1213, p2034, raw1213, raw1020]) {
      let n = 0;
      const client = fakeClient(async () => {
        if (++n === 1) throw err;
        return 1;
      });
      withSaveRetries(client, { logger: quiet().logger, ...noPause });
      await expect(client.call(undefined, 'executeRaw')).resolves.toBe(1);
      expect(n).toBe(2);
    }
  });

  it('any other error is never tried again (unique clash on create, not found, validation, plain)', async () => {
    const validation = Object.assign(new Error('Unknown argument `titel`'), { name: 'PrismaClientValidationError' });
    for (const [action, err] of [
      ['create', unique],
      ['update', unique],
      ['update', notFound],
      ['update', validation],
      ['findMany', new Error('boom')],
    ] as const) {
      let n = 0;
      const client = fakeClient(async () => {
        n++;
        throw err;
      });
      const { lines, logger } = quiet();
      withSaveRetries(client, { logger, ...noPause });
      await expect(client.call('Task', action)).rejects.toBe(err);
      expect(n).toBe(1);
      expect(lines).toEqual([]);
    }
  });

  it('an upsert that lost its insert race (P2002 on MySQL 8) is tried again: the next try finds the row and updates it', async () => {
    let n = 0;
    const client = fakeClient(async () => {
      if (++n === 1) throw unique;
      return { key: 'k' };
    });
    const { lines, logger } = quiet();
    withSaveRetries(client, { logger, ...noPause });
    await expect(client.call('SystemSetting', 'upsert')).resolves.toEqual({ key: 'k' });
    expect(n).toBe(2);
    expect(lines[0]!.ctx).toMatchObject({ model: 'SystemSetting', operation: 'upsert', attempts: 2, conflict: 'P2002', outcome: 'saved' });
  });

  it('a call inside a transaction is never tried again on its own (the transaction is the unit)', async () => {
    let n = 0;
    const client = fakeClient(async () => {
      n++;
      throw unknown1020;
    });
    withSaveRetries(client, { logger: quiet().logger, ...noPause });
    await expect(client.call('Task', 'update', {}, true)).rejects.toBe(unknown1020);
    expect(n).toBe(1);
  });

  it('retries of the same table wait their turn, one at a time; first tries never wait', async () => {
    let running = 0;
    let most = 0;
    const seen = new Map<string, number>();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const client = fakeClient(async (p) => {
      const key = String((p.args as { k: string }).k);
      const attempt = (seen.get(key) ?? 0) + 1;
      seen.set(key, attempt);
      if (key === 'other') return 'free';
      if (attempt === 1) throw unknown1020;
      running++;
      most = Math.max(most, running);
      if (key === 'a') await held; // the first retry holds its turn until released
      running--;
      return key;
    });
    withSaveRetries(client, { logger: quiet().logger, ...noPause });
    const a = client.call('Task', 'update', { k: 'a' });
    const b = client.call('Task', 'update', { k: 'b' });
    const c = client.call('Task', 'update', { k: 'c' });
    await new Promise((r) => setTimeout(r, 10));
    // a's retry holds the Task turn: b and c have failed once and wait; a first try of anything still runs.
    await expect(client.call('Task', 'findMany', { k: 'other' })).resolves.toBe('free');
    expect(seen.get('b')).toBe(1);
    expect(seen.get('c')).toBe(1);
    release();
    await expect(Promise.all([a, b, c])).resolves.toEqual(['a', 'b', 'c']);
    expect(most).toBe(1);
  });

  it('a retry that fails still hands the turn on', async () => {
    const tries = new Map<string, number>();
    const client = fakeClient(async (p) => {
      const key = String((p.args as { k: string }).k);
      const t = (tries.get(key) ?? 0) + 1;
      tries.set(key, t);
      if (key === 'bad') throw t === 2 ? notFound : unknown1020;
      if (t === 1) throw unknown1020;
      return key;
    });
    withSaveRetries(client, { logger: quiet().logger, ...noPause });
    const bad = client.call('Task', 'update', { k: 'bad' });
    const good = client.call('Task', 'update', { k: 'good' });
    await expect(bad).rejects.toBe(notFound);
    await expect(good).resolves.toBe('good');
  });
});

describe('withSaveRetries: transactions are tried again whole', () => {
  it('an interactive transaction runs again from the start after a save conflict', async () => {
    let attempt = 0;
    const client = fakeClient(async (p) => {
      if (p.action === 'update' && attempt === 1) throw unknown1020;
      return 'ok';
    });
    const { lines, logger } = quiet();
    const original = client.$transaction; // Prisma's own (the layer replaces it on the client)
    withSaveRetries(client, { logger, ...noPause });
    const out = await client.$transaction(async (tx: { call: (m: string, a: string) => Promise<unknown> }) => {
      attempt++;
      await tx.call('Task', 'findUnique');
      await tx.call('Task', 'update');
      return attempt;
    });
    expect(out).toBe(2);
    expect(original).toHaveBeenCalledTimes(2);
    expect(lines).toEqual([{ level: 'info', msg: 'save conflict', ctx: { operation: 'transaction', attempts: 2, conflict: '1020', outcome: 'saved' } }]);
  });

  it('keeps the transaction’s options (timeouts) on every try and never adds an isolation level', async () => {
    let n = 0;
    const client = fakeClient(async () => 'ok');
    const original = client.$transaction;
    original.mockImplementation(async () => {
      if (++n === 1) throw p2034;
      return 'done';
    });
    withSaveRetries(client, { logger: quiet().logger, ...noPause });
    await expect(client.$transaction(async () => 'x', { maxWait: 15_000, timeout: 30_000 })).resolves.toBe('done');
    expect(original.mock.calls.map((c) => c[1])).toEqual([{ maxWait: 15_000, timeout: 30_000 }, { maxWait: 15_000, timeout: 30_000 }]);
  });

  it('a batch $transaction([…]) runs again with the same calls', async () => {
    let n = 0;
    const items = ['a', 'b'];
    const client = fakeClient(async () => 'ok', async (list) => {
      if (++n === 1) throw batch1020;
      return list;
    });
    const { lines, logger } = quiet();
    withSaveRetries(client, { logger, ...noPause });
    await expect(client.$transaction(items)).resolves.toBe(items);
    expect(n).toBe(2);
    expect(lines[0]!.ctx).toMatchObject({ operation: 'batch transaction', attempts: 2, outcome: 'saved' });
  });

  it('stops at 3 tries; other errors (a refusal from the work, a unique clash) are never retried', async () => {
    const client = fakeClient(async () => 'ok');
    withSaveRetries(client, { logger: quiet().logger, ...noPause });
    let runs = 0;
    await expect(
      client.$transaction(async () => {
        runs++;
        throw raw1020;
      }),
    ).rejects.toBe(raw1020);
    expect(runs).toBe(3);
    for (const err of [unique, notFound, Object.assign(new Error('Last admin'), { code: 'LAST_ADMIN', status: 409 })]) {
      runs = 0;
      await expect(
        client.$transaction(async () => {
          runs++;
          throw err;
        }),
      ).rejects.toBe(err);
      expect(runs).toBe(1);
    }
  });

  it('nothing inside a transaction’s try is retried on its own: the outer try owns it (no 3 × 3)', async () => {
    let topLevel = 0;
    const client = fakeClient(async (p) => {
      if (!p.runInTransaction) {
        topLevel++;
        throw unknown1020;
      }
      return 'ok';
    });
    withSaveRetries(client, { logger: quiet().logger, ...noPause });
    let runs = 0;
    await expect(
      client.$transaction(async () => {
        runs++;
        await client.call('Task', 'update'); // the server's client (not tx) inside a transaction's work
      }),
    ).rejects.toBe(unknown1020);
    expect(runs).toBe(3);
    expect(topLevel).toBe(3);
  });

  it('a transaction started inside another transaction’s try runs once there, and never waits on the retry turn (no hang)', async () => {
    const client = fakeClient(async () => 'ok');
    withSaveRetries(client, { logger: quiet().logger, ...noPause });
    let outer = 0;
    let inner = 0;
    const out = await client.$transaction(async () => {
      outer++;
      if (outer === 1) throw p2034; // the second try of the outer one holds the transactions' turn
      return client.$transaction(async () => {
        inner++;
        return 'nested';
      });
    });
    expect(out).toBe('nested');
    expect([outer, inner]).toEqual([2, 1]);
  });
});

describe('withoutSaveRetry: the named opt-out', () => {
  it('a transaction started inside it runs once (work with effects a re-run would repeat)', async () => {
    const client = fakeClient(async () => 'ok');
    withSaveRetries(client, { logger: quiet().logger, ...noPause });
    let runs = 0;
    await expect(
      withoutSaveRetry(() =>
        client.$transaction(async () => {
          runs++;
          throw p2034;
        }),
      ),
    ).rejects.toBe(p2034);
    expect(runs).toBe(1);
  });

  it('a call made inside it runs once (code with its own retry loop keeps its own count)', async () => {
    let n = 0;
    const client = fakeClient(async () => {
      n++;
      throw unknown1020;
    });
    withSaveRetries(client, { logger: quiet().logger, ...noPause });
    await expect(withoutSaveRetry(() => client.call('Task', 'update'))).rejects.toBe(unknown1020);
    expect(n).toBe(1);
    // …and only inside: the same call outside is tried 3 times.
    n = 0;
    await expect(client.call('Task', 'update')).rejects.toBe(unknown1020);
    expect(n).toBe(3);
  });
});

describe('withSaveRetries: put on a client once', () => {
  it('a second call adds nothing (the server’s client is kept on globalThis outside production)', async () => {
    let n = 0;
    const client = fakeClient(async () => {
      n++;
      throw unknown1020;
    });
    withSaveRetries(client, { logger: quiet().logger, ...noPause });
    expect(() => withSaveRetries(client, { logger: quiet().logger, ...noPause })).not.toThrow();
    expect(client.middlewares).toHaveLength(1);
    await expect(client.call('Task', 'update')).rejects.toBe(unknown1020);
    expect(n).toBe(3);
  });

  it('must stay the LAST middleware (only then does a second `next` run the query again): a later $use is refused loudly', () => {
    const client = fakeClient(async () => 'ok');
    withSaveRetries(client, { logger: quiet().logger, ...noPause });
    expect(() => client.$use(async (p, next) => next(p))).toThrow(/before withSaveRetries/);
    expect(client.middlewares).toHaveLength(1);
  });

  it('a middleware added BEFORE it (the request timing) runs once per call, around every try', async () => {
    let n = 0;
    const client = fakeClient(async () => {
      if (++n < 3) throw unknown1020;
      return 'ok';
    });
    const around: string[] = [];
    client.$use(async (p, next) => {
      around.push('start');
      try {
        return await next(p);
      } finally {
        around.push('end');
      }
    });
    withSaveRetries(client, { logger: quiet().logger, ...noPause });
    await expect(client.call('Task', 'update')).resolves.toBe('ok');
    expect(n).toBe(3);
    expect(around).toEqual(['start', 'end']);
  });
});
