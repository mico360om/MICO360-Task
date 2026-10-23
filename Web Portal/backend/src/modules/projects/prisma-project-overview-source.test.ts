import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createPrismaProjectOverviewSource } from './prisma-project-overview-source';

// Query-shape tests against a stand-in client (the real queries run in tests/integration/project-overview.test.ts).

function fakeClient() {
  const groupBy = vi.fn(async (args: { by: string[] }) =>
    args.by.includes('dueDate')
      ? [{ projectId: 'p1', dueDate: new Date('2026-10-30T00:00:00Z'), _count: { _all: 2 } }]
      : [{ projectId: 'p1', _count: { _all: 5 }, _max: { updatedAt: new Date('2026-10-22T10:00:00Z') } }],
  );
  const memberFindMany = vi.fn(async () => [
    { projectId: 'p1', user: { id: 'u1', firstName: 'Sara', lastName: 'Ahmed', username: 'sara', avatarUrl: null } },
    { projectId: 'p1', user: { id: 'u2', firstName: '', lastName: '', username: 'omar', avatarUrl: '/uploads/a.png' } },
  ]);
  const userFindMany = vi.fn(async () => [{ id: 'u1', firstName: 'Sara', lastName: 'Ahmed', username: 'sara', avatarUrl: null }]);
  const client = { task: { groupBy }, projectMember: { findMany: memberFindMany }, user: { findMany: userFindMany } } as unknown as PrismaClient;
  return { client, groupBy, memberFindMany, userFindMany };
}

describe('createPrismaProjectOverviewSource', () => {
  it('asks the same four grouped questions however many projects there are (no query per project)', async () => {
    const few = fakeClient();
    await createPrismaProjectOverviewSource(few.client).load(['p1'], ['u1']);
    const many = fakeClient();
    await createPrismaProjectOverviewSource(many.client).load(Array.from({ length: 50 }, (_, i) => `p${i}`), ['u1', 'u2']);
    for (const f of [few, many]) {
      expect(f.groupBy).toHaveBeenCalledTimes(2);
      expect(f.memberFindMany).toHaveBeenCalledTimes(1);
      expect(f.userFindMany).toHaveBeenCalledTimes(1);
    }
  });

  it('counts live tasks per project, and open ones (not in a Done column, not completed) per due date', async () => {
    const f = fakeClient();
    await createPrismaProjectOverviewSource(f.client).load(['p1', 'p2'], []);
    const [totals, open] = f.groupBy.mock.calls.map((c) => c[0] as unknown as Record<string, unknown>);
    expect(totals).toMatchObject({ by: ['projectId'], where: { deletedAt: null, projectId: { in: ['p1', 'p2'] } }, _count: { _all: true }, _max: { updatedAt: true } });
    expect(open).toMatchObject({
      by: ['projectId', 'dueDate'],
      where: { deletedAt: null, projectId: { in: ['p1', 'p2'] }, completedAt: null, column: { category: { not: 'DONE' } } },
      _count: { _all: true },
    });
    // No owners to look up: no query for them.
    expect(f.userFindMany).not.toHaveBeenCalled();
  });

  it('hands back the grouped rows, with people named by their full name, else their username', async () => {
    const rows = await createPrismaProjectOverviewSource(fakeClient().client).load(['p1'], ['u1']);
    expect(rows.totals).toEqual([{ projectId: 'p1', total: 5, lastTaskUpdate: new Date('2026-10-22T10:00:00Z') }]);
    expect(rows.openByDue).toEqual([{ projectId: 'p1', dueDate: new Date('2026-10-30T00:00:00Z'), count: 2 }]);
    expect(rows.members).toEqual([
      { projectId: 'p1', person: { id: 'u1', name: 'Sara Ahmed', avatarUrl: null } },
      { projectId: 'p1', person: { id: 'u2', name: 'omar', avatarUrl: '/uploads/a.png' } },
    ]);
    expect(rows.owners).toEqual([{ id: 'u1', name: 'Sara Ahmed', avatarUrl: null }]);
  });

  it('asks nothing at all for an empty list', async () => {
    const f = fakeClient();
    const rows = await createPrismaProjectOverviewSource(f.client).load([], []);
    expect(rows).toEqual({ totals: [], openByDue: [], members: [], owners: [] });
    expect(f.groupBy).not.toHaveBeenCalled();
    expect(f.memberFindMany).not.toHaveBeenCalled();
  });
});
