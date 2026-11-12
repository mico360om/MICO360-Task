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
  // companies: every read takes its companies' statuses along (ARCHIVE_INCLUDE).
  companies: [{ company: { status: 'ACTIVE' } }],
};

describe('createPrismaProjectRepository.create', () => {
  // Companies: a site with one active company, and a creator with no primary company of their own.
  const oneCompany = { companyMember: { findFirst: vi.fn(async () => null) }, company: { findMany: vi.fn(async () => [{ id: 'company_prolens' }]) } };

  it('creates the default board columns in the same write as the project', async () => {
    const create = vi.fn(async () => projectRow);
    const repo = createPrismaProjectRepository({ project: { create }, ...oneCompany } as unknown as PrismaClient);
    await repo.create({ code: 'MICO', name: 'MICO', createdById: 'admin', companyIds: ['company_prolens', 'B', 'company_prolens'] });
    const data = (create.mock.calls[0] as unknown as [{ data: { columns: { create: { name: string; category: string; position: number }[] }; mainCompanyId?: string; companies?: unknown } }])[0].data;
    expect(data.columns.create.map((c) => [c.name, c.category, c.position])).toEqual([
      ['Backlog', 'BACKLOG', 0],
      ['To Do', 'TODO', 1],
      ['In Progress', 'IN_PROGRESS', 2],
      ['Review', 'REVIEW', 3],
      ['Done', 'DONE', 4],
    ]);
    // …and in the companies the rules chose (the first its main company), each once, in the same write.
    expect(data.mainCompanyId).toBe('company_prolens');
    expect(data.companies).toEqual({ create: [{ companyId: 'company_prolens' }, { companyId: 'B' }] });
    // The repository decides nothing: no companies given, none written (the project service's rules choose them).
    await repo.create({ code: 'MICO2', name: 'MICO', createdById: 'admin' });
    const plain = (create.mock.calls[1] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(plain).not.toHaveProperty('mainCompanyId');
    expect(plain).not.toHaveProperty('companies');
  });

  it('says whether a project counts as archived: its own status, or all its companies archived', async () => {
    const rows = [
      { ...projectRow, id: 'live', companies: [{ company: { status: 'ARCHIVED' } }, { company: { status: 'ACTIVE' } }] },
      { ...projectRow, id: 'gone-with-company', companies: [{ company: { status: 'ARCHIVED' } }] },
      { ...projectRow, id: 'own', status: 'ARCHIVED', companies: [{ company: { status: 'ACTIVE' } }] },
    ];
    const findMany = vi.fn(async () => rows);
    const repo = createPrismaProjectRepository({ project: { findMany } } as unknown as PrismaClient);
    const listed = await repo.list();
    expect(listed.map((p) => [p.id, p.status, p.archived])).toEqual([
      ['live', 'PLANNING', false],
      ['gone-with-company', 'PLANNING', true], // the stored status is never rewritten
      ['own', 'ARCHIVED', true],
    ]);
    expect((findMany.mock.calls[0] as unknown as [{ include: unknown }])[0].include).toEqual({ companies: { select: { company: { select: { status: true } } } } });
  });

  it('reports a code taken by a (possibly deleted) project as a 409', async () => {
    const dup = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0', meta: { target: ['code'] } });
    const repo = createPrismaProjectRepository({ project: { create: vi.fn(async () => { throw dup; }) }, ...oneCompany } as unknown as PrismaClient);
    await expect(repo.create({ code: 'OLD', name: 'x', createdById: 'admin' })).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_PROJECT_CODE' });
  });
});

describe('createPrismaMemberRepository', () => {
  it('removes a leaver’s assignments and watches in that project only, in one transaction', async () => {
    const taskAssignee = { deleteMany: vi.fn((a: unknown) => a), findMany: vi.fn(async () => [{ taskId: 't1' }]) };
    const taskWatcher = { deleteMany: vi.fn((a: unknown) => a) };
    const activity = { createMany: vi.fn((a: unknown) => a) };
    const user = { findUnique: vi.fn(async () => ({ firstName: 'Sara', lastName: 'Ali', username: 'sara' })) };
    const $transaction = vi.fn(async (ops: unknown[]) => ops);
    const repo = createPrismaMemberRepository({ taskAssignee, taskWatcher, activity, user, $transaction } as unknown as PrismaClient);
    await repo.removeTaskLinks!('p1', 'u1', 'mgr');
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(taskAssignee.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', task: { projectId: 'p1' } } });
    expect(taskWatcher.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', task: { projectId: 'p1' } } });
    // KPIs: each task they were on says who took them off, and that it released them.
    expect(activity.createMany).toHaveBeenCalledWith({ data: [{ taskId: 't1', projectId: 'p1', userId: 'mgr', action: 'UNASSIGNED', meta: { assigneeId: 'u1', assignee: 'Sara Ali', released: true } }] });
  });

  it('sees implicit access for the owner/manager or an admin — not the creator as such', async () => {
    const findFirst = vi.fn(async (_a: unknown) => null as unknown);
    const fake = (project: unknown, admin: unknown) => {
      findFirst.mockImplementation(async () => project);
      return createPrismaMemberRepository({
        project: { findFirst },
        userRole: { findFirst: vi.fn(async () => admin) },
      } as unknown as PrismaClient);
    };
    expect(await fake({ id: 'p1' }, null).hasImplicitAccess!('p1', 'u1')).toBe(true);
    expect(await fake(null, { userId: 'u1' }).hasImplicitAccess!('p1', 'u1')).toBe(true);
    expect(await fake(null, null).hasImplicitAccess!('p1', 'u1')).toBe(false);
    expect((findFirst.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toEqual({ id: 'p1', OR: [{ ownerId: 'u1' }, { managerId: 'u1' }] });
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

  it('re-points soft-deleted (and, task archive, archived) tasks to another column, then deletes the column', async () => {
    const { repo, tx } = fake({ live: 0, all: 3 }, { id: 'c0' });
    expect(await repo.remove('c9')).toEqual({ projectId: 'p1' });
    expect(tx.task.updateMany).toHaveBeenCalledWith({ where: { columnId: 'c9', OR: [{ deletedAt: { not: null } }, { archivedAt: { not: null } }] }, data: { columnId: 'c0' } });
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
