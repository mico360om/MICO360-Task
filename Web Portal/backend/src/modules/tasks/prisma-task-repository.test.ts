/* eslint-disable @typescript-eslint/no-explicit-any -- these tests inspect the loosely typed Prisma call arguments a fake client receives */
import { describe, it, expect, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createPrismaTaskRepository, createPrismaCarryForwardRepo, isTaskKeyConflict } from './prisma-task-repository';
import { createPrismaRecurrencePort } from './prisma-recurrence-port';
import { TaskKeyConflictError } from './task-repository';

// These tests pin the query shapes against a stand-in client (no database needed).

const keyConflict = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0', meta: { target: ['key'] } });

const row = (over: Record<string, unknown> = {}) => ({
  id: 't1', key: 'MICO-1', title: 'T', description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL',
  startDate: null, dueDate: null, estimatedHours: null, actualHours: null, progress: 0, createdById: 'u1', completedAt: null,
  boardDate: null, carryForwardLog: null, recurrenceRule: null, recurrenceParentId: null, version: 0,
  createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-01T00:00:00Z'), deletedAt: null,
  column: { category: 'TODO' }, tags: [],
  ...over,
});

describe('isTaskKeyConflict', () => {
  it('recognises a unique violation on the task key only', () => {
    expect(isTaskKeyConflict(keyConflict())).toBe(true);
    const other = new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: '5.22.0', meta: { target: ['name'] } });
    expect(isTaskKeyConflict(other)).toBe(false);
    expect(isTaskKeyConflict(new Error('x'))).toBe(false);
  });
});

describe('createPrismaTaskRepository', () => {
  it('creates the task, its tags and its assignees in one nested write', async () => {
    const create = vi.fn(async () => row());
    const repo = createPrismaTaskRepository({ task: { create } } as unknown as PrismaClient);
    await repo.create({ key: 'MICO-1', title: 'T', projectId: 'p1', columnId: 'c1', createdById: 'u1', tagNames: ['Urgent'], assigneeIds: ['u2', 'u2', 'u3'] });
    const data = (create.mock.calls[0] as unknown as [{ data: Record<string, any> }])[0].data;
    expect(data.tags.create).toEqual([{ tag: { connectOrCreate: { where: { name: 'Urgent' }, create: { name: 'Urgent', color: expect.any(String) } } } }]);
    expect(data.assignees.create).toEqual([{ userId: 'u2' }, { userId: 'u3' }]);
  });

  it('turns a duplicate key into TaskKeyConflictError (so the service can retry)', async () => {
    const repo = createPrismaTaskRepository({ task: { create: vi.fn(async () => { throw keyConflict(); }) } } as unknown as PrismaClient);
    await expect(repo.create({ key: 'MICO-1', title: 'T', projectId: 'p1', columnId: 'c1', createdById: 'u1' })).rejects.toBeInstanceOf(TaskKeyConflictError);
  });

  it('lists only live tasks of live projects, scoped in the query, without the carry-forward log', async () => {
    const findMany = vi.fn(async () => [row({ carryForwardLog: undefined, assignees: [], checklist: [], _count: { comments: 0, attachments: 0 } })]);
    const repo = createPrismaTaskRepository({ task: { findMany } } as unknown as PrismaClient);
    const [t] = await repo.list({ projectIds: ['p1', 'p2'], priorities: ['HIGH'] });
    const args = (findMany.mock.calls[0] as unknown as [{ where: Record<string, any>; select: Record<string, unknown> }])[0];
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.project).toEqual({ is: { deletedAt: null } });
    expect(args.where.AND).toEqual([{ projectId: { in: ['p1', 'p2'] } }, { priority: { in: ['HIGH'] } }]);
    expect(args.select.carryForwardLog).toBeUndefined();
    expect(t).not.toHaveProperty('carryForwardLog');
  });

  it('hides a task of a deleted project from findById', async () => {
    const findFirst = vi.fn(async () => null);
    const repo = createPrismaTaskRepository({ task: { findFirst } } as unknown as PrismaClient);
    expect(await repo.findById('t1')).toBeNull();
    expect((findFirst.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toEqual({ id: 't1', deletedAt: null, project: { is: { deletedAt: null } } });
  });

  it('series updates skip the edited task and completed occurrences when asked', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repo = createPrismaTaskRepository({ task: { updateMany } } as unknown as PrismaClient);
    await repo.updateSeries('s1', { title: 'x' }, { excludeId: 't9', openOnly: true });
    const where = (updateMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ id: { not: 't9' }, completedAt: null, column: { category: { not: 'DONE' } } });
  });

  it('reorders only live tasks of the given column, in one transaction', async () => {
    const updateMany = vi.fn((args: unknown) => args);
    const $transaction = vi.fn(async (ops: unknown[]) => ops);
    const repo = createPrismaTaskRepository({ task: { updateMany }, $transaction } as unknown as PrismaClient);
    await repo.reorderInColumn('c1', ['a', 'b']);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: 'a', columnId: 'c1', deletedAt: null }, data: { position: 0 } },
      { where: { id: 'b', columnId: 'c1', deletedAt: null }, data: { position: 1 } },
    ]);
  });
});

describe('createPrismaCarryForwardRepo', () => {
  it('skips tasks of deleted projects and keeps updatedAt when carrying', async () => {
    const findMany = vi.fn(async () => []);
    const updatedAt = new Date('2026-09-01T08:00:00Z');
    const findUnique = vi.fn(async () => ({ carryForwardLog: [{ from: 'a', to: 'b', at: 'c' }], updatedAt }));
    const update = vi.fn(async () => ({}));
    const repo = createPrismaCarryForwardRepo({ task: { findMany, findUnique, update } } as unknown as PrismaClient);
    await repo.listCarryCandidates(new Date());
    expect((findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where).toMatchObject({ deletedAt: null, project: { is: { deletedAt: null } } });
    await repo.applyCarry('t1', new Date('2026-09-02T12:00:00Z'), { from: 'b', to: 'd', at: 'e' });
    const data = (update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.updatedAt).toBe(updatedAt);
    expect(data.carryForwardLog).toHaveLength(2);
  });
});

describe('createPrismaRecurrencePort', () => {
  function fakePrisma(opts: { failFirstCreate?: boolean } = {}) {
    const source = {
      id: 's1', projectId: 'p1', title: 'Daily standup', description: 'notes', columnId: 'done', priority: 'HIGH', estimatedHours: 1,
      createdById: 'creator', recurrenceParentId: null, project: { code: 'MICO' },
      assignees: [{ userId: 'u1' }, { userId: 'gone' }], watchers: [{ userId: 'w1' }], tags: [{ tagId: 'tag1' }],
      checklist: [{ text: 'Prepare slides', position: 0 }],
    };
    let attempts = 0;
    const created: Record<string, any>[] = [];
    const fake: Record<string, any> = {
      task: {
        findFirst: vi.fn(async () => source),
        count: vi.fn(async () => 4),
        create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
          attempts += 1;
          if (opts.failFirstCreate && attempts === 1) throw keyConflict();
          created.push(data);
          return { id: 'next', projectId: data.projectId, title: data.title };
        }),
        update: vi.fn(async () => ({})),
      },
      kanbanColumn: { findFirst: vi.fn(async () => ({ id: 'backlog' })) },
      project: { findFirst: vi.fn(async () => ({ ownerId: 'owner', managerId: null, createdById: 'creator', members: [{ userId: 'u1' }, { userId: 'w1' }] })) },
      // 'gone' has left (inactive / no access): the audience query doesn't return them.
      user: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => id !== 'gone').map((id) => ({ id }))) },
      activity: { create: vi.fn(async () => ({})) },
    };
    fake.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(fake));
    return { fake, created };
  }

  it('creates a visible next occurrence: today’s board, start now, people/tags/checklist copied, activity logged', async () => {
    const { fake, created } = fakePrisma();
    const now = new Date('2026-09-26T21:00:00Z'); // 01:00 on the 27th in Muscat
    const port = createPrismaRecurrencePort(fake as unknown as PrismaClient, { timeZone: 'Asia/Muscat', now: () => now });
    const rule = { freq: 'DAILY' as const, interval: 1 };
    const res = await port.spawnNext('s1', new Date('2026-09-28T00:00:00Z'), rule);
    expect(res).toEqual({ id: 'next', projectId: 'p1' });
    const data = created[0]!;
    expect(data.key).toBe('MICO-5');
    expect(data.boardDate.toISOString()).toBe('2026-09-27T12:00:00.000Z');
    expect(data.startDate).toBe(now);
    expect(data.columnId).toBe('backlog');
    expect(data.recurrenceRule).toEqual(rule);
    expect(data.recurrenceParentId).toBe('s1');
    expect(data.assignees.create).toEqual([{ userId: 'u1' }]);
    expect(data.watchers.create).toEqual([{ userId: 'w1' }]);
    expect(data.tags.create).toEqual([{ tagId: 'tag1' }]);
    expect(data.checklist.create).toEqual([{ text: 'Prepare slides', position: 0 }]);
    expect(fake.task.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { recurrenceRule: Prisma.DbNull } });
    expect(fake.activity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ taskId: 'next', projectId: 'p1', action: 'CREATED' }) });
  });

  it('retries with the next key number when a concurrent create took it', async () => {
    const { fake, created } = fakePrisma({ failFirstCreate: true });
    const port = createPrismaRecurrencePort(fake as unknown as PrismaClient, { timeZone: 'UTC' });
    await port.spawnNext('s1', new Date('2026-09-28T00:00:00Z'), { freq: 'DAILY', interval: 1 });
    expect(created[0]!.key).toBe('MICO-6');
  });
});
