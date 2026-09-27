import { describe, it, expect, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createPrismaProjectRepository } from './prisma-project-repository';
import { createPrismaMemberRepository, createPrismaProjectManagerLookup } from './prisma-member-repository';
import { createPrismaColumnRepository } from './prisma-column-repository';
import { ConflictError } from '../../lib/http-errors';

// Query-shape tests against a stand-in client (no database needed).

const projectRow = {
  id: 'p1', code: 'MICO', name: 'MICO', description: null, clientName: null, managerId: null, ownerId: null, status: 'PLANNING',
  priority: 'NORMAL', color: '#8B1E1E', imageUrl: null, startDate: null, targetDate: null, notes: null, createdById: 'admin',
  createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
};

describe('createPrismaProjectRepository.create', () => {
  it('creates the default board columns in the same write as the project', async () => {
    const create = vi.fn(async () => projectRow);
    const repo = createPrismaProjectRepository({ project: { create } } as unknown as PrismaClient);
    await repo.create({ code: 'MICO', name: 'MICO', createdById: 'admin' });
    const data = (create.mock.calls[0] as unknown as [{ data: { columns: { create: { name: string; category: string; position: number }[] } } }])[0].data;
    expect(data.columns.create.map((c) => [c.name, c.category, c.position])).toEqual([
      ['Backlog', 'BACKLOG', 0],
      ['To Do', 'TODO', 1],
      ['In Progress', 'IN_PROGRESS', 2],
      ['Review', 'REVIEW', 3],
      ['Done', 'DONE', 4],
    ]);
  });

  it('reports a code taken by a (possibly deleted) project as a 409', async () => {
    const dup = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0', meta: { target: ['code'] } });
    const repo = createPrismaProjectRepository({ project: { create: vi.fn(async () => { throw dup; }) } } as unknown as PrismaClient);
    await expect(repo.create({ code: 'OLD', name: 'x', createdById: 'admin' })).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_PROJECT_CODE' });
  });
});

describe('createPrismaMemberRepository', () => {
  it('removes a leaver’s assignments and watches in that project only, in one transaction', async () => {
    const taskAssignee = { deleteMany: vi.fn((a: unknown) => a) };
    const taskWatcher = { deleteMany: vi.fn((a: unknown) => a) };
    const $transaction = vi.fn(async (ops: unknown[]) => ops);
    const repo = createPrismaMemberRepository({ taskAssignee, taskWatcher, $transaction } as unknown as PrismaClient);
    await repo.removeTaskLinks!('p1', 'u1');
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(taskAssignee.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', task: { projectId: 'p1' } } });
    expect(taskWatcher.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', task: { projectId: 'p1' } } });
  });

  it('sees implicit access for the owner/manager/creator or an admin', async () => {
    const fake = (project: unknown, admin: unknown) =>
      createPrismaMemberRepository({
        project: { findFirst: vi.fn(async () => project) },
        userRole: { findFirst: vi.fn(async () => admin) },
      } as unknown as PrismaClient);
    expect(await fake({ id: 'p1' }, null).hasImplicitAccess!('p1', 'u1')).toBe(true);
    expect(await fake(null, { userId: 'u1' }).hasImplicitAccess!('p1', 'u1')).toBe(true);
    expect(await fake(null, null).hasImplicitAccess!('p1', 'u1')).toBe(false);
  });

  it('resolves a task of a deleted project to no project (so access checks fail)', async () => {
    const findFirst = vi.fn(async () => null);
    const lookup = createPrismaProjectManagerLookup({ task: { findFirst } } as unknown as PrismaClient);
    expect(await lookup.projectIdOfTask('t1')).toBeNull();
    expect((findFirst.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toEqual({ id: 't1', deletedAt: null, project: { is: { deletedAt: null } } });
  });
});

describe('createPrismaColumnRepository.remove', () => {
  function fake(counts: { live: number; all: number }, fallback: { id: string } | null) {
    const tx = {
      kanbanColumn: {
        findUnique: vi.fn(async () => ({ projectId: 'p1' })),
        findFirst: vi.fn(async () => fallback),
        delete: vi.fn(async () => ({})),
      },
      task: {
        count: vi.fn(async ({ where }: { where: { deletedAt?: unknown } }) => (where.deletedAt === null ? counts.live : counts.all)),
        updateMany: vi.fn(async () => ({ count: counts.all })),
      },
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaClient;
    return { repo: createPrismaColumnRepository(prisma), tx };
  }

  it('re-points soft-deleted tasks to another column, then deletes the column', async () => {
    const { repo, tx } = fake({ live: 0, all: 3 }, { id: 'c0' });
    expect(await repo.remove('c9')).toEqual({ projectId: 'p1' });
    expect(tx.task.updateMany).toHaveBeenCalledWith({ where: { columnId: 'c9', deletedAt: { not: null } }, data: { columnId: 'c0' } });
    expect(tx.kanbanColumn.delete).toHaveBeenCalledWith({ where: { id: 'c9' } });
  });

  it('refuses while live tasks remain, or when there is no other column to park deleted tasks on', async () => {
    await expect(fake({ live: 1, all: 1 }, { id: 'c0' }).repo.remove('c9')).rejects.toBeInstanceOf(ConflictError);
    await expect(fake({ live: 0, all: 2 }, null).repo.remove('c9')).rejects.toMatchObject({ code: 'LAST_COLUMN' });
  });

  it('deletes an untouched column directly', async () => {
    const { repo, tx } = fake({ live: 0, all: 0 }, null);
    expect(await repo.remove('c9')).toEqual({ projectId: 'p1' });
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });
});
