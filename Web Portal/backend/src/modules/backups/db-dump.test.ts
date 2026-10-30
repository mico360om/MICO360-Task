import { describe, it, expect } from 'vitest';
import { quoteId, selectExpression, valueExpression, pageQuery, fkSafeOrder, insertBatches, dumpRows, type TableInfo } from './db-dump';
import type { SqlRunner } from './sql-runner';

const table = (name: string, primaryKey: string[], columns: [string, string][]): TableInfo => ({
  name,
  primaryKey,
  columns: columns.map(([n, type]) => ({ name: n, type })),
});

describe('dump queries', () => {
  it('quotes names with backticks (a backtick in a name is doubled)', () => {
    expect(quoteId('tasks')).toBe('`tasks`');
    expect(quoteId('we`ird')).toBe('`we``ird`');
  });

  it('reads each type in a form that restores exactly', () => {
    expect(selectExpression({ name: 'createdAt', type: 'datetime' })).toBe("DATE_FORMAT(`createdAt`, '%Y-%m-%d %H:%i:%s.%f')");
    expect(selectExpression({ name: 'd', type: 'date' })).toBe("DATE_FORMAT(`d`, '%Y-%m-%d')");
    expect(selectExpression({ name: 'image', type: 'mediumblob' })).toBe('TO_BASE64(`image`)');
    expect(selectExpression({ name: 'h', type: 'double' })).toBe('`h`');
    expect(selectExpression({ name: 'prefs', type: 'json' })).toBe('CAST(`prefs` AS CHAR)');
    expect(selectExpression({ name: 'title', type: 'varchar' })).toBe('CAST(`title` AS CHAR)');
    expect(selectExpression({ name: 'flag', type: 'bit' })).toBe('CAST(`flag` + 0 AS CHAR)');
    expect(() => selectExpression({ name: 'shape', type: 'geometry' })).toThrow(/geometry/);
  });

  it('writes each value back the matching way', () => {
    expect(valueExpression({ name: 'image', type: 'longblob' })).toBe('FROM_BASE64(?)');
    expect(valueExpression({ name: 'flag', type: 'bit' })).toBe('CAST(? AS UNSIGNED)');
    expect(valueExpression({ name: 'title', type: 'text' })).toBe('?');
  });

  it('pages by the primary key: one column, several columns, and none', () => {
    const t1 = table('tasks', ['id'], [['id', 'varchar'], ['title', 'varchar']]);
    expect(pageQuery(t1, 500, false)).toBe('SELECT CAST(`id` AS CHAR) AS c0, CAST(`title` AS CHAR) AS c1 FROM `tasks` ORDER BY `id` LIMIT 500');
    expect(pageQuery(t1, 500, true)).toBe('SELECT CAST(`id` AS CHAR) AS c0, CAST(`title` AS CHAR) AS c1 FROM `tasks` WHERE (`id`) > (?) ORDER BY `id` LIMIT 500');
    const t2 = table('task_tags', ['taskId', 'tagId'], [['taskId', 'varchar'], ['tagId', 'varchar']]);
    expect(pageQuery(t2, 100, true)).toBe('SELECT CAST(`taskId` AS CHAR) AS c0, CAST(`tagId` AS CHAR) AS c1 FROM `task_tags` WHERE (`taskId`, `tagId`) > (?, ?) ORDER BY `taskId`, `tagId` LIMIT 100');
    const t3 = table('loose', [], [['a', 'int'], ['b', 'varchar']]);
    expect(pageQuery(t3, 100, false, 200)).toBe('SELECT CAST(`a` AS CHAR) AS c0, CAST(`b` AS CHAR) AS c1 FROM `loose` ORDER BY `a`, `b` LIMIT 100 OFFSET 200');
  });

  it('reads a table page by page, keyed on the last row', async () => {
    const t = table('things', ['id'], [['id', 'varchar'], ['n', 'double']]);
    const all = Array.from({ length: 7 }, (_, i) => [`k${i}`, i + 0.5]);
    const calls: unknown[][] = [];
    const sql = {
      async query(_q: string, ...p: unknown[]) {
        calls.push(p);
        const after = p[0] as string | undefined;
        const rest = all.filter((r) => after === undefined || (r[0] as string) > after).slice(0, 3);
        return rest.map((r) => ({ c0: r[0], c1: r[1] }));
      },
    } as unknown as SqlRunner;
    const rows: unknown[][] = [];
    for await (const r of dumpRows(sql, t, 3)) rows.push(r);
    expect(rows).toEqual(all);
    expect(calls).toEqual([[], ['k2'], ['k5']]);
  });
});

describe('restore order and batches', () => {
  it('puts parents before children; ignores self-references; still orders a cycle', () => {
    const order = fkSafeOrder(
      ['tasks', 'users', 'projects', 'task_comments', 'a_cycle', 'b_cycle'],
      [
        { table: 'projects', references: 'users' },
        { table: 'tasks', references: 'projects' },
        { table: 'tasks', references: 'tasks' },
        { table: 'task_comments', references: 'tasks' },
        { table: 'task_comments', references: 'task_comments' },
        { table: 'a_cycle', references: 'b_cycle' },
        { table: 'b_cycle', references: 'a_cycle' },
      ],
    );
    expect(order).toHaveLength(6);
    expect(new Set(order).size).toBe(6);
    const at = (t: string) => order.indexOf(t);
    expect(at('users')).toBeLessThan(at('projects'));
    expect(at('projects')).toBeLessThan(at('tasks'));
    expect(at('tasks')).toBeLessThan(at('task_comments'));
  });

  it('splits rows into INSERTs under the size and placeholder limits', () => {
    const t = table('t', ['id'], [['id', 'varchar'], ['body', 'text']]);
    const rows = Array.from({ length: 1200 }, (_, i) => [`id${i}`, 'x'.repeat(i === 5 ? 3_000_000 : 10)]);
    const batches = [...insertBatches(t, rows, { maxRows: 500, maxBytes: 1_000_000 })];
    expect(batches.flatMap((b) => b.rows)).toEqual(rows);
    expect(batches.every((b) => b.rows.length <= 500)).toBe(true);
    // The 3 MB row goes on its own.
    expect(batches.some((b) => b.rows.length === 1 && (b.rows[0]![1] as string).length === 3_000_000)).toBe(true);
    expect(batches[0]!.sql).toMatch(/^INSERT INTO `t` \(`id`, `body`\) VALUES \(\?, \?\)(, \(\?, \?\))*$/);
    expect(batches[0]!.params).toHaveLength(batches[0]!.rows.length * 2);
  });
});
