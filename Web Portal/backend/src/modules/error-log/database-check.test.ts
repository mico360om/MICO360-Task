import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { createDatabaseCheck, expectedSchema, serverLabel, type DatabaseCheckDeps, type ExpectedTable } from './database-check';

// 1.23.1 — the live search failed with "Unknown column" (1054) although every column is in the schema
// and nothing failed here: something differed on the live database (its server, settings or tables).
// At start-up the server now compares the database with what it expects and runs each raw-SQL family
// once; each problem goes to the Error log once, with the server's version and settings.
const EXPECTED: ExpectedTable[] = [
  { table: 'tasks', columns: ['id', 'title', 'projectId'] },
  { table: 'task_search_index', columns: ['taskId', 'head', 'doc'] },
];
const ALL = EXPECTED.flatMap((t) => t.columns.map((column) => ({ table: t.table, column })));
const MYSQL = { version: '8.0.46', sqlMode: 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES', lowerCaseTableNames: 0 };
const MARIADB = { version: '11.4.5-MariaDB-log', sqlMode: 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION', lowerCaseTableNames: 0 };

function check(over: Partial<DatabaseCheckDeps> = {}) {
  const recorded: { text: string; err?: unknown }[] = [];
  const c = createDatabaseCheck({
    readServer: async () => MYSQL,
    readColumns: async () => ALL,
    expected: EXPECTED,
    probes: [{ name: 'the task search', run: async () => [] }],
    record: (p) => void recorded.push(p),
    now: () => new Date('2026-11-05T13:00:00Z'),
    ...over,
  });
  return { c, recorded };
}

describe('database check', () => {
  it('everything there and every query family working: OK, with the server’s version — nothing recorded', async () => {
    const { c, recorded } = check();
    expect(c.latest()).toBeNull();
    const r = await c.run();
    expect(r).toMatchObject({ ok: true, summary: 'Database check: OK (MySQL 8.0.46)', problems: [], server: { product: 'MySQL', version: '8.0.46', sqlMode: MYSQL.sqlMode, lowerCaseTableNames: 0 }, checkedAt: '2026-11-05T13:00:00.000Z' });
    expect(c.latest()).toEqual(r);
    expect(recorded).toEqual([]);
  });

  it('a missing column or table is a problem, recorded once with the server’s version and settings', async () => {
    const { c, recorded } = check({ readServer: async () => MARIADB, readColumns: async () => ALL.filter((x) => !(x.table === 'task_search_index' && x.column === 'head') && x.table !== 'tasks') });
    const r = await c.run();
    expect(r.ok).toBe(false);
    expect(r.summary).toBe('Database check: 2 problems (MariaDB 11.4.5)');
    expect(r.problems.map((p) => p.text)).toEqual(['Table tasks is missing', 'Column task_search_index.head is missing']);
    expect(recorded.map((p) => p.text)).toEqual([
      `Database check: Table tasks is missing — ${serverLabel(MARIADB)}`,
      `Database check: Column task_search_index.head is missing — ${serverLabel(MARIADB)}`,
    ]);
    expect(recorded[0]!.text).toContain('MariaDB 11.4.5 (11.4.5-MariaDB-log) · sql_mode STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION · lower_case_table_names 0');
  });

  it('table names are exact where the server says they are case-sensitive (Linux), not where it says they aren’t', async () => {
    const upper = ALL.map((x) => (x.table === 'tasks' ? { ...x, table: 'Tasks' } : x));
    const linux = await check({ readColumns: async () => upper }).c.run();
    expect(linux.problems.map((p) => p.text)).toEqual(['Table tasks is missing (there is a table Tasks: table names are case-sensitive on this server)']);
    const windows = await check({ readServer: async () => ({ ...MYSQL, lowerCaseTableNames: 1 }), readColumns: async () => upper }).c.run();
    expect(windows.ok).toBe(true);
    // A column's case never matters to MySQL or MariaDB.
    const columns = await check({ readColumns: async () => ALL.map((x) => ({ ...x, column: x.column.toUpperCase() })) }).c.run();
    expect(columns.ok).toBe(true);
  });

  it('a query family that fails on this server is a problem, recorded with its error (the Error log shows what the database said)', async () => {
    const said = new Prisma.PrismaClientKnownRequestError("\nInvalid `prisma.$queryRaw()` invocation:\n\n\nRaw query failed. Code: `1054`. Message: `Unknown column '0' in 'ORDER BY'`", { code: 'P2010', clientVersion: '5.22.0', meta: { code: '1054', message: "Unknown column '0' in 'ORDER BY'" } });
    const { c, recorded } = check({
      readServer: async () => MARIADB,
      probes: [
        { name: 'the task search (two words)', run: async () => { throw said; } },
        { name: 'the task search (a task number)', run: async () => [] },
      ],
    });
    const r = await c.run();
    expect(r.problems).toEqual([{ kind: 'query', name: 'the task search (two words)', text: "The task search (two words) fails: P2010 · code 1054 · Unknown column '0' in 'ORDER BY'" }]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.text).toBe(`Database check: the task search (two words) fails — ${serverLabel(MARIADB)}`);
    expect(recorded[0]!.err).toBe(said);
  });

  it('never throws and never blocks: what it can’t read is a problem too', async () => {
    const { c, recorded } = check({ readServer: async () => { throw new Error('denied'); }, readColumns: async () => { throw new Error('denied'); } });
    const r = await c.run();
    expect(r.ok).toBe(false);
    expect(r.server).toBeNull();
    expect(r.problems.map((p) => p.text)).toEqual(['The database server’s version and settings couldn’t be read', 'The database’s tables and columns couldn’t be read']);
    expect(recorded).toHaveLength(2);
    expect(r.summary).toBe('Database check: 2 problems');
  });

  it('a database far from the schema: at most 20 problems recorded, then one line for the rest', async () => {
    const many: ExpectedTable[] = Array.from({ length: 30 }, (_, i) => ({ table: `t${i}`, columns: ['id'] }));
    const { c, recorded } = check({ expected: many, readColumns: async () => [] });
    const r = await c.run();
    expect(r.problems).toHaveLength(30);
    expect(recorded).toHaveLength(21);
    expect(recorded[20]!.text).toBe(`Database check: 10 more problems (see System Settings → Error log) — ${serverLabel(MYSQL)}`);
  });

  it('never says where the database is: no host, user or database name', async () => {
    const { c } = check({ readServer: async () => MARIADB });
    const r = await c.run();
    expect(JSON.stringify(r)).not.toMatch(/127\.0\.0\.1|localhost|mysql:\/\//);
  });
});

describe('expectedSchema: the tables and columns the app’s schema uses', () => {
  it('every model’s table, its scalar and enum fields as columns — never a relation', () => {
    const tables = expectedSchema();
    const index = tables.find((t) => t.table === 'task_search_index')!;
    expect(index.columns).toEqual(expect.arrayContaining(['taskId', 'head', 'doc', 'lead', 'stamp', 'version', 'indexedAt']));
    expect(index.columns).not.toContain('task');
    const tasks = tables.find((t) => t.table === 'tasks')!;
    expect(tasks.columns).toEqual(expect.arrayContaining(['id', 'projectId', 'columnId', 'deletedAt', 'completedAt', 'updatedAt']));
    expect(tables.find((t) => t.table === 'kanban_columns')!.columns).toContain('category');
    expect(tables.length).toBeGreaterThan(50);
  });

  it('server labels', () => {
    expect(serverLabel(MYSQL)).toBe('MySQL 8.0.46 · sql_mode ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES · lower_case_table_names 0');
    expect(serverLabel({ version: '10.11.10-MariaDB', sqlMode: '', lowerCaseTableNames: null })).toBe('MariaDB 10.11.10 (10.11.10-MariaDB) · sql_mode (none)');
  });
});
