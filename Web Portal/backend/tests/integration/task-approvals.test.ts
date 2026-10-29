import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createProjectService } from '../../src/modules/projects/project-service';
import { createPrismaProjectLookup, createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createPrismaRecurrencePort } from '../../src/modules/tasks/prisma-recurrence-port';
import { createRecurrenceService } from '../../src/modules/tasks/recurrence-service';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const projects = createPrismaProjectRepository(prisma);
const projectService = createProjectService({ projects });
const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-30T06:00:00Z');
const recurrence = createRecurrenceService({ tasks: createPrismaRecurrencePort(prisma, { timeZone: TZ, now: () => NOW }), timeZone: TZ, now: () => NOW });
const CODES = ['APRA', 'APRB'];
const EMAILS = ['approvals-manager@mico360.test', 'approvals-worker@mico360.test'];
let managerId = '';
let workerId = '';
const copies: string[] = [];

const taskService = createTaskService({
  tasks: createPrismaTaskRepository(prisma),
  projects: createPrismaProjectLookup(prisma),
  timeZone: TZ,
  now: () => NOW,
  approvals: {
    canApprove: async (userId) => userId === managerId,
    columnsOf: (projectId) => prisma.kanbanColumn.findMany({ where: { projectId }, select: { id: true, category: true, position: true, enabled: true } }),
  },
  // As the server's status effects do: a repeating task that became done makes its next copy.
  onMoved: async (task) => {
    if (task.completedAt && task.recurrenceRule) {
      const next = await recurrence.onTaskCompleted({ id: task.id, dueDate: task.dueDate, recurrenceRule: task.recurrenceRule, recurrenceParentId: task.recurrenceParentId });
      if (next) copies.push(next.id);
    }
  },
});

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } })).map((p) => p.id);
  await prisma.activity.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

let projectId = '';
const col = async (category: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE') => (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId, category }, select: { id: true } })).id;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await cleanup();
  copies.length = 0;
  managerId = (await prisma.user.create({ data: { email: EMAILS[0]!, username: 'approvals-manager', passwordHash: 'x', firstName: 'Omar', lastName: 'Manager' } })).id;
  workerId = (await prisma.user.create({ data: { email: EMAILS[1]!, username: 'approvals-worker', passwordHash: 'x', firstName: 'Sara', lastName: 'Worker' } })).id;
  projectId = (await projectService.createProject({ code: 'APRA', name: 'Approvals', createdById: managerId, managerId })).id;
});

describe('Task approvals on MySQL (integration)', () => {
  it('a task made before approvals existed reads as not needing approval, with no approval state', async () => {
    const t = await prisma.task.create({ data: { key: 'APRA-1', title: 'Old row', projectId, columnId: await col('TODO'), createdById: workerId } });
    expect(await taskService.getTask(t.id)).toMatchObject({ needsApproval: false, approvalRequestedAt: null, approvalRequestedById: null, approvedAt: null, approvedById: null });
  });

  it('the project setting ticks new tasks; finishing one waits in Review and every read says so', async () => {
    const other = await projectService.createProject({ code: 'APRB', name: 'Ticked', createdById: managerId, managerId });
    await prisma.project.update({ where: { id: other.id }, data: { newTasksNeedApproval: true } });
    const todo = (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: other.id, category: 'TODO' } })).id;
    const done = (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: other.id, category: 'DONE' } })).id;
    const t = await taskService.createTask({ title: 'Drawing', projectId: other.id, columnId: todo, createdById: workerId });
    expect(t.needsApproval).toBe(true);
    const waiting = await taskService.moveTask(t.id, done, undefined, workerId);
    expect(waiting).toMatchObject({ columnCategory: 'REVIEW', completedAt: null, approvalRequestedById: workerId });
    expect(waiting.approvalRequestedAt).toEqual(NOW);
    expect((await taskService.listTasks({ projectId: other.id }))[0]).toMatchObject({ needsApproval: true, approvalRequestedById: workerId, columnCategory: 'REVIEW' });
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id }, select: { completedAt: true, approvalRequestedAt: true } });
    expect(row).toEqual({ completedAt: null, approvalRequestedAt: NOW });
  });

  it('approving a repeating task completes it now and makes one next copy, which keeps the tick and doesn’t wait', async () => {
    const t = await taskService.createTask({
      title: 'Weekly HSE report',
      projectId,
      columnId: await col('IN_PROGRESS'),
      createdById: workerId,
      needsApproval: true,
      dueDate: new Date('2026-10-30T00:00:00Z'),
      recurrenceRule: { freq: 'WEEKLY', interval: 1 },
    });
    const waiting = await taskService.moveTask(t.id, await col('DONE'), undefined, workerId);
    expect(copies).toHaveLength(0); // waiting is not done: no next copy yet
    const approved = await taskService.approveTask(t.id, managerId, { expectedVersion: waiting.version });
    expect(approved).toMatchObject({ columnCategory: 'DONE', approvedById: managerId, approvalRequestedAt: null, progress: 100 });
    expect(approved.completedAt).toEqual(NOW);
    expect(copies).toHaveLength(1);
    const copy = await prisma.task.findUniqueOrThrow({ where: { id: copies[0]! } });
    expect(copy).toMatchObject({ needsApproval: true, approvalRequestedAt: null, approvedAt: null, completedAt: null });
    // A second approval finds nothing waiting, and makes no second copy.
    await expect(taskService.approveTask(t.id, managerId)).rejects.toMatchObject({ code: 'NOT_WAITING' });
    expect(await prisma.task.count({ where: { recurrenceSourceId: t.id } })).toBe(1);
  });

  it('send back returns it to In progress; re-opening an approved task clears the approval', async () => {
    const t = await taskService.createTask({ title: 'Client deliverable', projectId, columnId: await col('IN_PROGRESS'), createdById: workerId, needsApproval: true });
    await taskService.moveTask(t.id, await col('DONE'), undefined, workerId);
    const back = await taskService.sendBackTask(t.id, managerId, 'Add the signatures');
    expect(back).toMatchObject({ columnCategory: 'IN_PROGRESS', approvalRequestedAt: null, completedAt: null });
    await taskService.moveTask(t.id, await col('DONE'), undefined, workerId);
    await taskService.approveTask(t.id, managerId);
    const reopened = await taskService.moveTask(t.id, await col('IN_PROGRESS'), undefined, workerId);
    expect(reopened).toMatchObject({ completedAt: null, approvedAt: null, approvedById: null, needsApproval: true });
  });

  it('two approvals at the same moment: one wins, the other is told it isn’t waiting any more', async () => {
    const t = await taskService.createTask({ title: 'Survey', projectId, columnId: await col('IN_PROGRESS'), createdById: workerId, needsApproval: true });
    await taskService.moveTask(t.id, await col('DONE'), undefined, workerId);
    const results = await Promise.allSettled([taskService.approveTask(t.id, managerId), taskService.approveTask(t.id, managerId)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'NOT_WAITING' });
  });
});
