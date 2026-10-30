import { createWriteStream } from 'node:fs';
import { Writable } from 'node:stream';
import type { SqlRunner } from './sql-runner';

/** Stand-ins for the backup tests (a database and a disk that fills up). Not used by the app itself. */

/**
 * A disk that takes `limit` bytes into the file, then fails every write like a full disk (ENOSPC):
 * at once, or `delayMs` later, as a real disk does.
 */
export function fillingDisk(limit: number, opts: { delayMs?: number } = {}): (path: string) => Writable {
  const full = () => Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
  return (path) => {
    const real = createWriteStream(path);
    let taken = 0;
    return new Writable({
      write(chunk: Buffer, _enc, done) {
        if (taken + chunk.length > limit) return opts.delayMs ? void setTimeout(() => done(full()), opts.delayMs) : done(full());
        taken += chunk.length;
        real.write(chunk, done);
      },
      final(done) {
        real.end(done);
      },
      destroy(err, done) {
        if (real.closed) return done(err);
        real.once('close', () => done(err));
        real.destroy();
      },
    });
  };
}

/**
 * A stand-in database for the backup writer: answers the few queries it makes (the table list,
 * columns, keys and pages of rows) from tables held in memory.
 */
export interface FakeTable {
  name: string;
  columns: { name: string; type: string }[];
  /** One column (compared as text), or none. */
  primaryKey: string[];
  rows: unknown[][];
}

export function fakeSqlRunner(tables: FakeTable[], opts: { migrations?: string[]; pageDelayMs?: number } = {}): SqlRunner {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const runner: SqlRunner = {
    async query<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      const out = (rows: unknown[]) => rows as T[];
      if (sql.includes('@@session.time_zone')) return out([{ tz: 'SYSTEM' }]);
      if (sql.includes('_prisma_migrations')) return out((opts.migrations ?? ['20260101000000_init']).map((m) => ({ m })));
      if (sql.includes('VERSION()')) return out([{ v: '8.0.0-fake' }]);
      if (sql.includes('information_schema.TABLES')) return out(tables.map((t) => ({ t: t.name })));
      if (sql.includes('information_schema.COLUMNS')) return out(tables.flatMap((t) => t.columns.map((c) => ({ t: t.name, c: c.name, type: c.type, extra: '' }))));
      if (sql.includes("CONSTRAINT_NAME = 'PRIMARY'")) return out(tables.flatMap((t) => t.primaryKey.map((c) => ({ t: t.name, c }))));
      if (sql.includes('REFERENCED_TABLE_NAME IS NOT NULL')) return out([]);
      const page = /FROM `([^`]+)`.*LIMIT (\d+)(?: OFFSET (\d+))?$/s.exec(sql);
      if (page) {
        if (opts.pageDelayMs) await sleep(opts.pageDelayMs);
        const table = tables.find((t) => t.name === page[1])!;
        const key = table.primaryKey[0] ? table.columns.findIndex((c) => c.name === table.primaryKey[0]) : -1;
        let rows = [...table.rows];
        if (key >= 0) rows.sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0));
        if (key >= 0 && params.length) rows = rows.filter((r) => String(r[key]) > String(params[0]));
        rows = rows.slice(Number(page[3] ?? 0), Number(page[3] ?? 0) + Number(page[2]));
        return out(rows.map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, v]))));
      }
      throw new Error(`The fake database has no answer for: ${sql}`);
    },
    async execute() {
      return 0;
    },
    async transaction(fn) {
      return fn(runner);
    },
  };
  return runner;
}
