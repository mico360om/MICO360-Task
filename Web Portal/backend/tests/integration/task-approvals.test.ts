import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createProjectService } from '../../src/modules/projects/project-service';
import { createPrismaProjectLookup, createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createPrismaRecurrencePort } from '../../src/modules/tasks/prisma-recurrence-port';
import { createRecurrenceService } from '../../src/modules/tasks/recurrence-service';
import { createPrismaApprovalSource } from '../../src/modules/tasks/prisma-approval-source';
import { managesProject } from '../../src/modules/projects/project-managers';
import { runBackfill } from './company-helpers';
import { createProjectCompanies } from '../../src/modules/companies/project-companies';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const projects = createPrismaProjectRepository(prisma);
// companies: the rules choose a new project's companies, as on the server (here: its creator's primary company).
const projectService = createProjectService({ projects, companies: createProjectCompanies(prisma, { site: async () => ({ timeZone: 'Asia/Muscat', weekStart: 0 }) }) });
const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-30T06:00:00Z');
const recurrence = createRecurrenceService({ tasks: createPrismaRecurrencePort(prisma, { timeZone: TZ, now: () => NOW }), timeZone: TZ, now: () => NOW });
const CODES = ['APRA', 'APRB'];
const EMAILS = ['approvals-manager@mico360.test', 'approvals-worker@mico360.test', 'approvals-admin@mico360.test'];
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
  await runBackfill(prisma); // companies: everyone and every project here in the one company, as after the upgrade
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

  it('the project setting is kept, changed, left alone by an update without it, and ticks a template’s tasks', async () => {
    expect((await projects.findById(projectId))?.newTasksNeedApproval).toBe(false);
    expect(await projectService.updateProject(projectId, { newTasksNeedApproval: true })).toMatchObject({ newTasksNeedApproval: true });
    expect(await projectService.updateProject(projectId, { name: 'Renamed' })).toMatchObject({ newTasksNeedApproval: true });
    const fromTemplate = await projects.create({
      code: 'APRB',
      name: 'From a template',
      createdById: managerId,
      newTasksNeedApproval: true,
      startWith: {
        columns: [{ name: 'To do', category: 'TODO', color: '#3A6EA5' }, { name: 'Done', category: 'DONE', color: '#2E7D53' }],
        startColumn: 0,
        tasks: [{ title: 'Kick-off', description: null, priority: 'NORMAL', startDate: null, dueDate: null, assigneeIds: [], checklist: [] }],
        boardDate: NOW,
        templateName: 'Rig job',
      },
    });
    expect(fromTemplate.newTasksNeedApproval).toBe(true);
    expect(await prisma.task.findMany({ where: { projectId: fromTemplate.id }, select: { needsApproval: true } })).toEqual([{ needsApproval: true }]);
  });

  it('only the project’s manager may turn approval off; in a project that ticks new tasks a worker’s "off" is kept on (owner, 30 Oct)', async () => {
    const t = await taskService.createTask({ title: 'Isometric drawing', projectId, columnId: await col('IN_PROGRESS'), createdById: workerId, needsApproval: true });
    await expect(taskService.updateTask(t.id, { needsApproval: false }, t.version, 'one', workerId)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: t.id }, select: { needsApproval: true, version: true } })).toEqual({ needsApproval: true, version: t.version });
    // An edit that leaves the tick out (an older app) keeps it.
    expect(await taskService.updateTask(t.id, { title: 'Isometric drawing, rev B' }, t.version, 'one', workerId)).toMatchObject({ needsApproval: true });
    expect(await taskService.updateTask(t.id, { needsApproval: false }, undefined, 'one', managerId)).toMatchObject({ needsApproval: false });
    await prisma.project.update({ where: { id: projectId }, data: { newTasksNeedApproval: true } });
    const kept = await taskService.createTask({ title: 'Valve log', projectId, columnId: await col('TODO'), createdById: workerId, needsApproval: false });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: kept.id }, select: { needsApproval: true } })).toEqual({ needsApproval: true });
    const managers = await taskService.createTask({ title: 'Valve log (manager)', projectId, columnId: await col('TODO'), createdById: managerId, needsApproval: false });
    expect(managers.needsApproval).toBe(false);
  });

  it('two approvals at the same moment: one wins, the other is told it isn’t waiting any more', async () => {
    const t = await taskService.createTask({ title: 'Survey', projectId, columnId: await col('IN_PROGRESS'), createdById: workerId, needsApproval: true });
    await taskService.moveTask(t.id, await col('DONE'), undefined, workerId);
    const results = await Promise.allSettled([taskService.approveTask(t.id, managerId), taskService.approveTask(t.id, managerId)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'NOT_WAITING' });
  });
});

describe('The To approve list and who is told, on MySQL (integration)', () => {
  // As the server wires it: admins, and whoever runs the project (owner, named manager, MANAGER members).
  const source = createPrismaApprovalSource(prisma, {
    canManageProject: async (userId, roles, pid) => {
      if (roles.includes('ADMIN')) return true;
      const p = await prisma.project.findUniqueOrThrow({ where: { id: pid }, select: { ownerId: true, managerId: true, members: { select: { userId: true, role: true } } } });
      return managesProject(p, userId);
    },
  });
  let adminId = '';
  beforeEach(async () => {
    const role = await prisma.role.upsert({ where: { name: 'ADMIN' }, update: {}, create: { name: 'ADMIN' } });
    adminId = (await prisma.user.create({ data: { email: EMAILS[2]!, username: 'approvals-admin', passwordHash: 'x', firstName: 'Ada', lastName: 'Admin', roles: { create: [{ roleId: role.id }] } } })).id;
  });
  async function waitingTask(title = 'Inspection report') {
    const t = await taskService.createTask({ title, projectId, columnId: await col('IN_PROGRESS'), createdById: workerId, needsApproval: true, assigneeIds: [workerId] });
    return taskService.moveTask(t.id, await col('DONE'), undefined, workerId);
  }

  it('lists the waiting tasks for whoever runs the project and for admins, longest waiting first — nobody else', async () => {
    const first = await waitingTask('First');
    await prisma.task.update({ where: { id: first.id }, data: { approvalRequestedAt: new Date('2026-10-29T06:00:00Z') } });
    const second = await waitingTask('Second');
    await taskService.createTask({ title: 'Not finished', projectId, columnId: await col('TODO'), createdById: workerId, needsApproval: true });
    const mine = await source.list({ id: managerId, roles: ['EMPLOYEE'] });
    expect(mine.map((t) => t.id)).toEqual([first.id, second.id]);
    expect(mine[1]).toMatchObject({ key: second.key, project: { id: projectId, code: 'APRA', name: 'Approvals' }, requestedBy: { id: workerId, name: 'Sara Worker' }, assignees: [{ id: workerId, name: 'Sara Worker' }] });
    expect((await source.list({ id: adminId, roles: ['ADMIN'] })).map((t) => t.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(await source.list({ id: workerId, roles: ['EMPLOYEE'] })).toEqual([]);
    expect(await source.canApproveAny({ id: managerId, roles: ['EMPLOYEE'] })).toBe(true);
    expect(await source.canApproveAny({ id: workerId, roles: ['EMPLOYEE'] })).toBe(false);
    expect(await source.countFor(managerId)).toBe(2);
    expect(await source.countFor(workerId)).toBe(0);
    expect(await source.countFor(adminId)).toBeGreaterThanOrEqual(2);
  });

  it('a task’s details: who may approve, who finished it, the one approver’s name', async () => {
    const w = await waitingTask();
    expect(await source.details({ id: managerId, roles: ['EMPLOYEE'] }, w)).toEqual({ canApprove: true, requestedBy: { id: workerId, name: 'Sara Worker' }, approvedBy: null, approverName: 'Omar Manager' });
    expect((await source.details({ id: workerId, roles: ['EMPLOYEE'] }, w)).canApprove).toBe(false);
    const approved = await taskService.approveTask(w.id, managerId);
    expect((await source.details({ id: workerId, roles: ['EMPLOYEE'] }, approved)).approvedBy).toEqual({ id: managerId, name: 'Omar Manager' });
  });

  it('who is told a task waits: the people who run the project (never the finisher) — the admins when nobody does', async () => {
    expect(await source.approvers(projectId, workerId)).toEqual([managerId]);
    await prisma.project.update({ where: { id: projectId }, data: { managerId: null } });
    const told = await source.approvers(projectId, workerId);
    expect(told).toContain(adminId);
    expect(told).not.toContain(workerId);
    expect(told).not.toContain(managerId);
  });
});
