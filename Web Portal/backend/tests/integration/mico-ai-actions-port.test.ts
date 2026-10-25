import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createMicoAiActionsPort } from '../../src/modules/mico-ai/mico-ai-actions-port';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createPrismaProjectLookup, createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';
import { createAssigneeService } from '../../src/modules/tasks/assignee-service';
import { createPrismaAssigneeRepository, createPrismaTaskLookup } from '../../src/modules/tasks/prisma-assignee-repository';
import { createActivityService } from '../../src/modules/activity/activity-service';
import { createPrismaActivityRepository } from '../../src/modules/activity/prisma-activity-repository';
import { createProjectAccess } from '../../src/modules/projects/project-access';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createPrismaProjectManagerLookup } from '../../src/modules/projects/prisma-member-repository';
import { createPrismaFinalMinutesRepository } from '../../src/modules/meetings/final-minutes-repository';
import { taskChanges } from '../../src/modules/tasks/task-changes';
import type { Viewer } from '../../src/modules/mico-ai/mico-ai-data';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. MICO AI's changes through the
// app's own task, assignee and history services, as the person: their access is checked on every
// write, the history lines are the usual ones marked "via MICO AI", and a task's version and history
// count say whether anyone changed it since.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const CODE = 'MAIP';
const EMAILS = ['maip-owner@mico360.test', 'maip-sara@mico360.test', 'maip-out@mico360.test'];
const activityService = createActivityService({ activities: createPrismaActivityRepository(prisma) });
const taskService = createTaskService({
  tasks: createPrismaTaskRepository(prisma),
  projects: createPrismaProjectLookup(prisma),
  timeZone: TZ,
  onCreated: async (t) => void (await activityService.record({ taskId: t.id, projectId: t.projectId, userId: t.createdById, action: 'CREATED', meta: { title: t.title } })),
  onUpdated: async (before, after, actorId) => {
    if (actorId) await activityService.record({ taskId: after.id, projectId: after.projectId, userId: actorId, action: 'UPDATED', meta: { changes: taskChanges(before, after, TZ) } });
  },
});
const assigneeService = createAssigneeService({
  repo: createPrismaAssigneeRepository(prisma),
  taskLookup: createPrismaTaskLookup(prisma),
  onAssigned: async (taskId, userIds, actorId) => {
    for (const userId of userIds) await activityService.record({ taskId, userId: actorId!, action: 'ASSIGNED', meta: { assigneeId: userId } });
  },
  onUnassigned: async (taskId, userId, actorId) => void (await activityService.record({ taskId, userId: actorId!, action: 'UNASSIGNED', meta: { assigneeId: userId } })),
});
const projectAccess = createProjectAccess({ projects: createPrismaProjectRepository(prisma), managers: createPrismaProjectManagerLookup(prisma) });
const finalMinutes = createPrismaFinalMinutesRepository(prisma);
const broadcasts: string[] = [];
const port = createMicoAiActionsPort({
  prisma,
  timeZone: TZ,
  taskService,
  assigneeService,
  projectAccess,
  meetingService: { canEditMeeting: async (userId: string) => userId === ids.owner } as never,
  attendeeService: {} as never,
  agendaService: {} as never,
  meetingNotify: {} as never,
  finalMinutes,
  minutesFacts: async () => 'facts',
  draftMinutesWithAi: async () => ({ summary: 'Drafted.' }),
  workingDays: async () => [0, 1, 2, 3, 4],
  isActiveUser: async () => true,
  broadcast: (_p, event) => void broadcasts.push(event),
  audit: { record: async () => undefined },
});

const ids = { owner: '', sara: '', outsider: '', project: '', todo: '', done: '' };
const as = (userId: string): Viewer => ({ userId, roles: ['EMPLOYEE'] });

async function cleanup() {
  const projects = (await prisma.project.findMany({ where: { code: CODE }, select: { id: true } })).map((p) => p.id);
  await prisma.meeting.deleteMany({ where: { title: 'MAIP meeting' } });
  await prisma.activity.deleteMany({ where: { task: { projectId: { in: projects } } } });
  await prisma.taskAssignee.deleteMany({ where: { task: { projectId: { in: projects } } } });
  await prisma.task.deleteMany({ where: { projectId: { in: projects } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: projects } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: projects } } });
  await prisma.project.deleteMany({ where: { id: { in: projects } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
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
  broadcasts.length = 0;
  // One at a time: three inserts at once can deadlock on the unique indexes just after the cleanup.
  const users = [];
  for (const [i, email] of EMAILS.entries()) users.push(await prisma.user.create({ data: { email, username: `maip-${i}`, passwordHash: 'x', firstName: ['Omar', 'Sara', 'Layla'][i]!, lastName: 'Test' } }));
  const [owner, sara, outsider] = users;
  const project = await prisma.project.create({ data: { code: CODE, name: 'MICO AI port', createdById: owner!.id, ownerId: owner!.id } });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: sara!.id } });
  const todo = await prisma.kanbanColumn.create({ data: { projectId: project.id, name: 'To do', category: 'TODO', position: 0 } });
  const done = await prisma.kanbanColumn.create({ data: { projectId: project.id, name: 'Done', category: 'DONE', position: 1 } });
  Object.assign(ids, { owner: owner!.id, sara: sara!.id, outsider: outsider!.id, project: project.id, todo: todo.id, done: done.id });
});

describe('MICO AI’s changes through the app’s services (integration)', () => {
  it('a task made as Sara, assigned, its history lines marked via MICO AI; its state says who and how far', async () => {
    const made = await port.asMicoAi(() =>
      port.createTask(as(ids.sara), { projectId: ids.project, columnId: ids.todo, title: 'Replace the gauge', description: '', priority: 'HIGH', due: '2026-10-27', assigneeIds: [ids.sara] }),
    );
    expect(made).toMatchObject({ key: `${CODE}-1`, title: 'Replace the gauge', priority: 'HIGH', due: '2026-10-27', assigneeIds: [ids.sara], columnId: ids.todo, columnName: 'To do', lastActor: 'Sara Test' });
    const lines = await prisma.activity.findMany({ where: { taskId: made.id }, orderBy: { createdAt: 'asc' } });
    expect(lines.map((l) => [l.action, (l.meta as { via?: string }).via])).toEqual([
      ['CREATED', 'mico-ai'],
      ['ASSIGNED', 'mico-ai'],
    ]);
    expect(made.activity).toBe(2);
    expect(broadcasts).toEqual(['task:created']);
  });

  it('someone outside the project can’t make, change or remove its tasks; nor assign someone outside it', async () => {
    await expect(port.createTask(as(ids.outsider), { projectId: ids.project, columnId: ids.todo, title: 'X', description: '', priority: 'NORMAL', due: null, assigneeIds: [] })).rejects.toMatchObject({ status: 403 });
    const t = await port.createTask(as(ids.sara), { projectId: ids.project, columnId: ids.todo, title: 'Y', description: '', priority: 'NORMAL', due: null, assigneeIds: [] });
    await expect(port.updateTask(as(ids.outsider), t.id, { priority: 'HIGH' }, t.version)).rejects.toMatchObject({ status: 403 });
    await expect(port.setAssignees(as(ids.outsider), t.id, [ids.sara], [])).rejects.toMatchObject({ status: 403 });
    await expect(port.deleteTask(as(ids.outsider), t.id)).rejects.toMatchObject({ status: 403 });
    await expect(port.createTask(as(ids.sara), { projectId: ids.project, columnId: ids.todo, title: 'Z', description: '', priority: 'NORMAL', due: null, assigneeIds: [ids.outsider] })).rejects.toMatchObject({ status: 400 });
    expect(await port.eligibleAssignees(ids.project, [ids.owner, ids.sara, ids.outsider])).toEqual(expect.arrayContaining([ids.owner, ids.sara]));
    expect(await port.eligibleAssignees(ids.project, [ids.outsider])).toEqual([]);
  });

  it('a change saved only from the version the person saw; a moved due date, status and people', async () => {
    const t = await port.createTask(as(ids.sara), { projectId: ids.project, columnId: ids.todo, title: 'Valve', description: '', priority: 'NORMAL', due: '2026-10-20', assigneeIds: [ids.owner] });
    await expect(port.updateTask(as(ids.sara), t.id, { priority: 'HIGH' }, t.version - 1)).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    const after = await port.asMicoAi(async () => {
      await port.updateTask(as(ids.sara), t.id, { due: '2026-10-25', columnId: ids.done, priority: 'URGENT' }, t.version);
      await port.setAssignees(as(ids.sara), t.id, [ids.sara], [ids.owner]);
      return (await port.taskState(t.id))!;
    });
    expect(after).toMatchObject({ due: '2026-10-25', priority: 'URGENT', columnId: ids.done, category: 'DONE', assigneeIds: [ids.sara], version: t.version + 1 });
    expect(after.activity).toBe(t.activity + 3);
    const latest = await prisma.activity.findMany({ where: { taskId: t.id }, orderBy: { createdAt: 'asc' }, select: { action: true, meta: true } });
    expect(latest.slice(-3).map((l) => [l.action, (l.meta as { via?: string }).via])).toEqual([
      ['UPDATED', 'mico-ai'],
      ['ASSIGNED', 'mico-ai'],
      ['UNASSIGNED', 'mico-ai'],
    ]);
  });

  it('Undo can take back the task this card made (soft-deleted, gone for everyone)', async () => {
    const t = await port.createTask(as(ids.sara), { projectId: ids.project, columnId: ids.todo, title: 'Undo me', description: '', priority: 'NORMAL', due: null, assigneeIds: [] });
    await port.deleteTask(as(ids.sara), t.id);
    expect(await port.taskState(t.id)).toBeNull();
    expect((await prisma.task.findUnique({ where: { id: t.id } }))!.deletedAt).not.toBeNull();
  });

  it('a meeting’s stamp changes when its people or agenda do; final minutes saved and taken back out', async () => {
    const m = await prisma.meeting.create({ data: { title: 'MAIP meeting', organizerId: ids.owner, createdById: ids.owner, startAt: new Date('2026-10-27T06:00:00Z'), status: 'SCHEDULED' } });
    const before = (await port.meetingStamp(m.id))!.stamp;
    await prisma.meetingAttendee.create({ data: { meetingId: m.id, userId: ids.sara } });
    expect((await port.meetingStamp(m.id))!.stamp).not.toBe(before);
    await expect(port.saveMinutes(as(ids.sara), m.id, { content: { summary: 'x', discussion: [], decisions: [], risks: [], nextSteps: [] }, status: 'DRAFT', approvedById: null, approvedAt: null })).rejects.toMatchObject({ status: 403 });
    const saved = await port.saveMinutes(as(ids.owner), m.id, { content: { summary: 'Draft', discussion: [], decisions: [], risks: [], nextSteps: [] }, status: 'DRAFT', approvedById: null, approvedAt: null });
    expect((await port.minutes(m.id))!.savedAt).toEqual(saved.savedAt);
    await port.clearMinutes(as(ids.owner), m.id);
    expect(await port.minutes(m.id)).toBeNull();
    expect(await port.draftMinutes(as(ids.owner), m.id)).toMatchObject({ summary: 'Drafted.', decisions: [] });
    await expect(port.draftMinutes(as(ids.sara), m.id)).rejects.toMatchObject({ status: 403 });
  });
});
