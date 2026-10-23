import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createPrismaSearchDataSource, taskSearchWhere } from './prisma-search-data-source';

describe('taskSearchWhere', () => {
  it('scopes to live tasks of live projects the caller may see', () => {
    const where = taskSearchWhere('report', ['p1', 'p2']);
    expect(where).toMatchObject({ deletedAt: null, project: { is: { deletedAt: null } }, projectId: { in: ['p1', 'p2'] } });
    expect(taskSearchWhere('report', null)).not.toHaveProperty('projectId');
  });

  it('pre-filters titles by every term, or keys — the current one or an old one — by the query', () => {
    expect(taskSearchWhere('Fix bug', null).OR).toEqual([
      { AND: [{ title: { contains: 'fix' } }, { title: { contains: 'bug' } }] },
      { key: { contains: 'fix bug' } },
      { keyAliases: { some: { key: { contains: 'fix bug' } } } },
    ]);
  });
});

describe('createPrismaSearchDataSource.searchTasks', () => {
  function fake(rows: { id: string; key: string; title: string; projectId: string; keyAliases?: { key: string }[] }[]) {
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

  it('finds a task by a key it had before it moved project, and says which keys it had', async () => {
    const { source, findMany } = fake([
      { id: 'a', key: 'OPS-17', title: 'Inspect the rig', projectId: 'p2', keyAliases: [{ key: 'RIG-4' }] },
      { id: 'b', key: 'RIG-40', title: 'Other', projectId: 'p1', keyAliases: [] },
    ]);
    const hits = await source.searchTasks!('rig-4', null, 50);
    expect(hits).toEqual([
      { id: 'a', key: 'OPS-17', title: 'Inspect the rig', projectId: 'p2', formerKeys: ['RIG-4'] },
      { id: 'b', key: 'RIG-40', title: 'Other', projectId: 'p1', formerKeys: [] },
    ]);
    const args = (findMany.mock.calls[0] as unknown as [{ select: Record<string, unknown> }])[0];
    expect(args.select.keyAliases).toEqual({ select: { key: true }, orderBy: { createdAt: 'asc' } });
  });

  it('puts the task whose key (or old key) is exactly the query first', async () => {
    const { source } = fake([
      { id: 'x40', key: 'RIG-40', title: 'Forty', projectId: 'p1' },
      { id: 'x41', key: 'RIG-41', title: 'Forty-one', projectId: 'p1' },
      { id: 'moved', key: 'OPS-17', title: 'Was four', projectId: 'p2', keyAliases: [{ key: 'RIG-4' }] },
      { id: 'x4', key: 'RIG-4X', title: 'Not it', projectId: 'p1' },
    ]);
    expect((await source.searchTasks!('RIG-4', null, 50)).map((t) => t.id)).toEqual(['moved', 'x40', 'x41', 'x4']);
    expect((await source.searchTasks!('RIG-41', null, 1)).map((t) => t.id)).toEqual(['x41']);
  });

  it('caps the results and skips the database for callers with no projects', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, key: `MICO-${i}`, title: 'report', projectId: 'p1' }));
    const { source, findMany } = fake(rows);
    expect(await source.searchTasks!('report', null, 3)).toHaveLength(3);
    expect(await source.searchTasks!('report', [], 3)).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
