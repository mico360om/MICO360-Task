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
// 01:30 on 23 Oct in Muscat — still the 22nd in UTC: "today" is the company's day.
const NOW = new Date('2026-10-22T21:30:00Z');
const TODAY = new Date('2026-10-23T00:00:00.000Z');
const taskService = createTaskService({ tasks: createPrismaTaskRepository(prisma), projects: createPrismaProjectLookup(prisma), timeZone: TZ, now: () => NOW });
const recurrence = createRecurrenceService({ tasks: createPrismaRecurrencePort(prisma, { timeZone: TZ, now: () => NOW }), timeZone: TZ, now: () => NOW });
const CODES = ['PTSA', 'PTSB', 'PTSC'];
const EMAIL = 'project-settings@mico360.test';
let userId = '';

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } })).map((p) => p.id);
  await prisma.activity.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
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
  userId = (await prisma.user.create({ data: { email: EMAIL, username: 'project-settings', passwordHash: 'x', firstName: 'Project', lastName: 'Settings' } })).id;
});

describe('Project task settings in the database (integration)', () => {
  it('a project made without them carries forward and doesn’t fill in due dates', async () => {
    const p = await projectService.createProject({ code: 'PTSA', name: 'Defaults', createdById: userId });
    expect(p).toMatchObject({ carryForward: true, defaultDueToday: false });
    expect(await projects.findById(p.id)).toMatchObject({ carryForward: true, defaultDueToday: false });
  });

  it('keeps the settings it was made with, and an update without them leaves them alone', async () => {
    const p = await projectService.createProject({ code: 'PTSB', name: 'Chosen', createdById: userId, carryForward: false, defaultDueToday: true });
    expect(p).toMatchObject({ carryForward: false, defaultDueToday: true });
    expect(await projectService.updateProject(p.id, { name: 'Renamed' })).toMatchObject({ name: 'Renamed', carryForward: false, defaultDueToday: true });
    expect(await projectService.updateProject(p.id, { defaultDueToday: false })).toMatchObject({ carryForward: false, defaultDueToday: false });
    expect((await projects.list()).find((x) => x.id === p.id)).toMatchObject({ carryForward: false, defaultDueToday: false });
  });
});

describe('"New tasks are due today" on MySQL (integration)', () => {
  let dueTodayProject = '';
  let plainProject = '';
  let dueTodayColumn = '';
  let plainColumn = '';
  const storedDue = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id }, select: { dueDate: true } })).dueDate;

  beforeEach(async () => {
    const a = await projectService.createProject({ code: 'PTSA', name: 'Due today', createdById: userId, defaultDueToday: true });
    const b = await projectService.createProject({ code: 'PTSB', name: 'Plain', createdById: userId });
    dueTodayProject = a.id;
    plainProject = b.id;
    const firstOpen = (projectId: string) => prisma.kanbanColumn.findFirstOrThrow({ where: { projectId, category: 'TODO' }, select: { id: true } });
    dueTodayColumn = (await firstOpen(a.id)).id;
    plainColumn = (await firstOpen(b.id)).id;
  });

  it('a task added without a due date is stored as due today (the company’s day, as a pure date)', async () => {
    const t = await taskService.createTask({ title: 'Undated', projectId: dueTodayProject, columnId: dueTodayColumn, createdById: userId });
    expect(await storedDue(t.id)).toEqual(TODAY);
  });

  it('a task added to a later day’s board is stored as due on that day, and stays on that board', async () => {
    const t = await taskService.createTask({ title: 'Site visit', projectId: dueTodayProject, columnId: dueTodayColumn, createdById: userId, boardDate: new Date('2026-10-27T12:00:00Z') });
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id }, select: { dueDate: true, boardDate: true } });
    expect(row).toEqual({ dueDate: new Date('2026-10-27T00:00:00.000Z'), boardDate: new Date('2026-10-27T12:00:00.000Z') });
  });

  it('keeps a picked date, and leaves tasks of a project without the setting undated', async () => {
    const picked = await taskService.createTask({ title: 'Picked', projectId: dueTodayProject, columnId: dueTodayColumn, createdById: userId, dueDate: new Date('2026-11-05T00:00:00Z') });
    expect(await storedDue(picked.id)).toEqual(new Date('2026-11-05T00:00:00.000Z'));
    const plain = await taskService.createTask({ title: 'Plain', projectId: plainProject, columnId: plainColumn, createdById: userId });
    expect(await storedDue(plain.id)).toBeNull();
  });

  it('a date cleared later stays cleared', async () => {
    const t = await taskService.createTask({ title: 'Undated', projectId: dueTodayProject, columnId: dueTodayColumn, createdById: userId });
    await taskService.updateTask(t.id, { dueDate: null });
    expect(await storedDue(t.id)).toBeNull();
  });

  it('the next copy of a repeating task keeps the date its series gives it', async () => {
    const t = await taskService.createTask({
      title: 'Weekly check', projectId: dueTodayProject, columnId: dueTodayColumn, createdById: userId,
      dueDate: new Date('2026-10-28T00:00:00Z'), recurrenceRule: { freq: 'WEEKLY', interval: 1 },
    });
    const next = await recurrence.onTaskCompleted({ id: t.id, dueDate: t.dueDate, recurrenceRule: t.recurrenceRule, recurrenceParentId: null });
    expect(next).not.toBeNull();
    expect(await storedDue(next!.id)).toEqual(new Date('2026-11-04T00:00:00.000Z'));
  });
});
