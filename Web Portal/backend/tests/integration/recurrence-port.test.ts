import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { createPrismaRecurrencePort } from '../../src/modules/tasks/prisma-recurrence-port';
import { createRecurrenceService } from '../../src/modules/tasks/recurrence-service';
import { createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';
import type { RecurrenceRule } from '../../src/modules/tasks/recurrence';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-01T06:00:00Z'); // 10:00 on 1 Oct in Muscat
const port = createPrismaRecurrencePort(prisma, { timeZone: TZ, now: () => NOW });
const service = createRecurrenceService({ tasks: port, timeZone: TZ, now: () => NOW });

let userId = '';
let projectId = '';
let todoId = '';

async function cleanup() {
  const projects = await prisma.project.findMany({ where: { code: 'RECUR' }, select: { id: true } });
  const ids = projects.map((p) => p.id);
  await prisma.activity.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.tag.deleteMany({ where: { name: 'recur-test' } });
  await prisma.user.deleteMany({ where: { email: { in: ['recur-owner@mico360.test', 'recur-mate@mico360.test'] } } });
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await cleanup();
  const owner = await prisma.user.create({ data: { email: 'recur-owner@mico360.test', username: 'recur-owner', passwordHash: 'x', firstName: 'Recur', lastName: 'Owner' } });
  const mate = await prisma.user.create({ data: { email: 'recur-mate@mico360.test', username: 'recur-mate', passwordHash: 'x', firstName: 'Recur', lastName: 'Mate' } });
  userId = owner.id;
  const project = await prisma.project.create({
    data: { code: 'RECUR', name: 'Recurring', createdById: owner.id, ownerId: owner.id, members: { create: [{ userId: mate.id }] } },
  });
  projectId = project.id;
  const todo = await prisma.kanbanColumn.create({ data: { projectId, name: 'To do', category: 'TODO', position: 0 } });
  await prisma.kanbanColumn.create({ data: { projectId, name: 'Done', category: 'DONE', position: 1 } });
  todoId = todo.id;
});

async function recurringTask(rule: RecurrenceRule, dueDate: string, key = 'RECUR-1') {
  const mate = await prisma.user.findUniqueOrThrow({ where: { email: 'recur-mate@mico360.test' } });
  return prisma.task.create({
    data: {
      key,
      title: 'Weekly safety check — فحص السلامة',
      description: 'Walk the site',
      priority: 'HIGH',
      estimatedHours: 1.5,
      projectId,
      columnId: todoId,
      createdById: userId,
      dueDate: new Date(`${dueDate}T00:00:00.000Z`),
      recurrenceRule: rule as unknown as Prisma.InputJsonValue,
      assignees: { create: [{ userId }, { userId: mate.id }] },
      tags: { create: [{ tag: { create: { name: 'recur-test' } } }] },
      checklist: { create: [{ text: 'Fire exits', position: 0, done: true }] },
    },
  });
}

describe('Recurring tasks on MySQL (integration)', () => {
  it('completing the same task from three apps at once makes exactly one next copy', async () => {
    const source = await recurringTask({ freq: 'WEEKLY', interval: 1 }, '2026-09-28');
    const completed = { id: source.id, dueDate: source.dueDate, recurrenceRule: { freq: 'WEEKLY', interval: 1 } as RecurrenceRule, recurrenceParentId: null };
    const results = await Promise.all([service.onTaskCompleted(completed), service.onTaskCompleted(completed), service.onTaskCompleted(completed)]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const copies = await prisma.task.findMany({ where: { recurrenceParentId: source.id, NOT: { id: source.id } }, include: { assignees: true, tags: { include: { tag: true } }, checklist: true } });
    expect(copies).toHaveLength(1);
    const copy = copies[0]!;
    // Next week's date, with the details and people carried over and the checklist unticked.
    expect(copy.dueDate?.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(copy).toMatchObject({ title: source.title, description: 'Walk the site', priority: 'HIGH', estimatedHours: 1.5, recurrenceSourceId: source.id, columnId: todoId });
    expect(copy.assignees.map((a) => a.userId).sort()).toEqual((await prisma.taskAssignee.findMany({ where: { taskId: source.id } })).map((a) => a.userId).sort());
    expect(copy.tags.map((t) => t.tag.name)).toEqual(['recur-test']);
    expect(copy.checklist.map((c) => ({ text: c.text, done: c.done }))).toEqual([{ text: 'Fire exits', done: false }]);
    // The first task stays part of its series (so every app shows it as such) — counted once.
    expect((await prisma.task.findUniqueOrThrow({ where: { id: source.id } })).recurrenceParentId).toBe(source.id);
    expect(await port.countInstances(source.id)).toBe(2);
    // Each task knows the copy made from it; the newest copy has none yet.
    const repo = createPrismaTaskRepository(prisma);
    expect((await repo.findById(source.id))?.recurrenceNextId).toBe(copy.id);
    expect((await repo.findById(copy.id))?.recurrenceNextId).toBeNull();
    // The rule moved to the copy: it is now the only head of the series.
    expect((await port.listSeriesHeads()).map((h) => h.id).filter((id) => id === source.id || id === copy.id)).toEqual([copy.id]);
  });

  it('completing it again later makes nothing more', async () => {
    const source = await recurringTask({ freq: 'DAILY', interval: 1 }, '2026-10-01');
    const task = { id: source.id, dueDate: source.dueDate, recurrenceRule: { freq: 'DAILY', interval: 1 } as RecurrenceRule, recurrenceParentId: null };
    expect(await service.onTaskCompleted(task)).not.toBeNull();
    expect(await service.onTaskCompleted(task)).toBeNull();
    expect(await prisma.task.count({ where: { recurrenceParentId: source.id, NOT: { id: source.id } } })).toBe(1);
  });

  it('an archived or completed project makes no more on-schedule copies', async () => {
    const source = await recurringTask({ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' }, '2026-09-28');
    for (const status of ['ARCHIVED', 'COMPLETED'] as const) {
      await prisma.project.update({ where: { id: projectId }, data: { status } });
      expect((await service.runSchedule()).filter((m) => m.projectId === projectId)).toEqual([]);
    }
    await prisma.project.update({ where: { id: projectId }, data: { status: 'ACTIVE' } });
    expect((await service.runSchedule()).filter((m) => m.projectId === projectId)).toHaveLength(1);
    expect(await prisma.task.count({ where: { recurrenceSourceId: source.id } })).toBe(1);
  });

  it('an on-schedule series gets one copy per due date, however often the sweep runs', async () => {
    const rule: RecurrenceRule = { freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' };
    const source = await recurringTask(rule, '2026-09-28');
    const [first, second] = await Promise.all([service.runSchedule(), service.runSchedule()]);
    const mine = [...first, ...second].filter((m) => m.projectId === projectId);
    expect(mine).toHaveLength(1);
    expect(await service.runSchedule()).toEqual([]);
    const copies = await prisma.task.findMany({ where: { recurrenceParentId: source.id, NOT: { id: source.id } } });
    // Missed days collapse into today's copy.
    expect(copies.map((c) => c.dueDate?.toISOString())).toEqual(['2026-10-01T00:00:00.000Z']);
  });
});
