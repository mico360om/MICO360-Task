import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createPrismaSearchDataSource, taskSearchWhere } from './prisma-search-data-source';

describe('taskSearchWhere', () => {
  it('scopes to live tasks of live projects the caller may see', () => {
    const where = taskSearchWhere('report', ['p1', 'p2']);
    expect(where).toMatchObject({ deletedAt: null, project: { is: { deletedAt: null } }, projectId: { in: ['p1', 'p2'] } });
    expect(taskSearchWhere('report', null)).not.toHaveProperty('projectId');
  });

  it('pre-filters titles by every term, or keys by the query', () => {
    expect(taskSearchWhere('Fix bug', null).OR).toEqual([
      { AND: [{ title: { contains: 'fix' } }, { title: { contains: 'bug' } }] },
      { key: { contains: 'fix bug' } },
    ]);
  });
});

describe('createPrismaSearchDataSource.searchTasks', () => {
  function fake(rows: { id: string; key: string; title: string; projectId: string }[]) {
    const findMany = vi.fn(async () => rows);
    return { source: createPrismaSearchDataSource({ task: { findMany } } as unknown as PrismaClient), findMany };
  }

  it('queries per request, newest first, and keeps only exact (normalised) matches', async () => {
    const { source, findMany } = fake([
      { id: 'a', key: 'MICO-2', title: 'إدارة المشروع', projectId: 'p1' },
      { id: 'b', key: 'MICO-3', title: 'مدير الرواتب', projectId: 'p1' }, // passes the letter pre-filter only
    ]);
    const hits = await source.searchTasks!('ادارة', ['p1'], 50);
    expect(hits.map((t) => t.id)).toEqual(['a']);
    const args = (findMany.mock.calls[0] as unknown as [{ orderBy: unknown; take: number }])[0];
    expect(args.orderBy).toEqual({ updatedAt: 'desc' });
    expect(args.take).toBeGreaterThan(50);
  });

  it('caps the results and skips the database for callers with no projects', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, key: `MICO-${i}`, title: 'report', projectId: 'p1' }));
    const { source, findMany } = fake(rows);
    expect(await source.searchTasks!('report', null, 3)).toHaveLength(3);
    expect(await source.searchTasks!('report', [], 3)).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
