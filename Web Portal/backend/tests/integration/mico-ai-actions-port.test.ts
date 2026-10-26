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
  taskService: { ...taskService, getTask: taskService.getTask },
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
  await prisma.actionItem.deleteMany({ where: { description: 'Book the calibration' } });
  await prisma.decision.deleteMany({ where: { title: 'Re-test on rig 3' } });
  await prisma.meeting.deleteMany({ where: { title: 'MAIP meeting' } });
  await prisma.tag.deleteMany({ where: { name: 'maip-tag' } });
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
  it('a task made as Sara (the main write: the task with its people), then announced; history lines marked via MICO AI', async () => {
    const made = await port.asMicoAi(() =>
      port.createTask(as(ids.sara), { projectId: ids.project, columnId: ids.todo, title: 'Replace the gauge', description: '', priority: 'HIGH', due: '2026-10-27', assigneeIds: [ids.sara, ids.owner] }),
    );
    expect(made).toMatchObject({ key: `${CODE}-1`, title: 'Replace the gauge', priority: 'HIGH', due: '2026-10-27', columnId: ids.todo, columnName: 'To do', activity: 1, tags: 0, watchers: 0, links: 0, createdById: ids.sara, nextCopyKey: null });
    expect([...made.assigneeIds].sort()).toEqual([ids.sara, ids.owner].sort());
    expect(broadcasts).toEqual([]);
    await port.asMicoAi(() => port.announceTask(as(ids.sara), made.id, [ids.sara, ids.owner]));
    const lines = await prisma.activity.findMany({ where: { taskId: made.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(lines.map((l) => [l.action, (l.meta as { via?: string }).via])).toEqual([
      ['CREATED', 'mico-ai'],
      ['ASSIGNED', 'mico-ai'],
      ['ASSIGNED', 'mico-ai'],
    ]);
    expect(broadcasts).toEqual(['task:created']);
    // Who wrote the lines after the first one, newest first.
    expect(await port.changedBy(made.id, 1)).toEqual([
      { userId: ids.sara, name: 'Sara Test', via: true },
      { userId: ids.sara, name: 'Sara Test', via: true },
    ]);
  });

  it('someone outside the project can’t make, change or remove its tasks; nor assign someone outside it', async () => {
    await expect(port.createTask(as(ids.outsider), { projectId: ids.project, columnId: ids.todo, title: 'X', description: '', priority: 'NORMAL', due: null, assigneeIds: [] })).rejects.toMatchObject({ status: 403 });
    const t = await port.createTask(as(ids.sara), { projectId: ids.project, columnId: ids.todo, title: 'Y', description: '', priority: 'NORMAL', due: null, assigneeIds: [] });
    await expect(port.updateTask(as(ids.outsider), t.id, { priority: 'HIGH' }, t.version)).rejects.toMatchObject({ status: 403 });
    await expect(port.setAssignees(as(ids.outsider), t.id, [ids.sara], [])).rejects.toMatchObject({ status: 403 });
    expect(await port.deleteCreatedTask(as(ids.outsider), t.id, { version: t.version, activity: t.activity, tags: 0, watchers: 0, links: 0, assigneeIds: t.assigneeIds })).toBe(false);
    await expect(port.createTask(as(ids.sara), { projectId: ids.project, columnId: ids.todo, title: 'Z', description: '', priority: 'NORMAL', due: null, assigneeIds: [ids.outsider] })).rejects.toMatchObject({ status: 400 });
    expect(await port.eligibleAssignees(ids.project, [ids.owner, ids.sara, ids.outsider])).toEqual(expect.arrayContaining([ids.owner, ids.sara]));
    expect(await port.eligibleAssignees(ids.project, [ids.outsider])).toEqual([]);
  });

  it('a change saved only from the version the person saw; a moved due date, status and people', async () => {
    const t = await port.createTask(as(ids.sara), { projectId: ids.project, columnId: ids.todo, title: 'Valve', description: '', priority: 'NORMAL', due: '2026-10-20', assigneeIds: [ids.owner] });
    await expect(port.updateTask(as(ids.sara), t.id, { priority: 'HIGH' }, t.version - 1)).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    const after = await port.asMicoAi(async () => {
      const r = await port.updateTask(as(ids.sara), t.id, { due: '2026-10-25', columnId: ids.done, priority: 'URGENT' }, t.version);
      expect(r.warning).toBeNull();
      await port.setAssignees(as(ids.sara), t.id, [ids.sara], [ids.owner]);
      return (await port.taskState(t.id))!;
    });
    expect(after).toMatchObject({ due: '2026-10-25', priority: 'URGENT', columnId: ids.done, category: 'DONE', assigneeIds: [ids.sara], version: t.version + 1 });
    expect(after.activity).toBe(t.activity + 3);
    expect((await port.changedBy(t.id, t.activity)).map((r) => r.via)).toEqual([true, true, true]);
    const latest = await prisma.activity.findMany({ where: { taskId: t.id }, orderBy: { createdAt: 'asc' }, select: { action: true, meta: true } });
    expect(latest.slice(-3).map((l) => [l.action, (l.meta as { via?: string }).via])).toEqual([
      ['UPDATED', 'mico-ai'],
      ['ASSIGNED', 'mico-ai'],
      ['UNASSIGNED', 'mico-ai'],
    ]);
  });

  it('Undo takes back the task its card made in one guarded write: only its creator, only untouched', async () => {
    const make = (title: string) => port.createTask(as(ids.sara), { projectId: ids.project, columnId: ids.todo, title, description: '', priority: 'NORMAL', due: null, assigneeIds: [ids.sara] });
    const touch = (t: Awaited<ReturnType<typeof make>>) => ({ version: t.version, activity: t.activity, tags: t.tags, watchers: t.watchers, links: t.links, assigneeIds: t.assigneeIds });
    // Untouched: gone for everyone.
    const a = await make('Undo me');
    expect(await port.deleteCreatedTask(as(ids.owner), a.id, touch(a))).toBe(false); // not its creator
    expect(await port.deleteCreatedTask(as(ids.sara), a.id, touch(a))).toBe(true);
    expect(await port.taskState(a.id)).toBeNull();
    expect((await prisma.task.findUnique({ where: { id: a.id } }))!.deletedAt).not.toBeNull();
    expect(broadcasts).toContain('task:deleted');
    // Tagged, watched, blocked, commented on (a history line) or edited since: it stays.
    const b = await make('Tagged');
    const tag = await prisma.tag.create({ data: { name: 'maip-tag' } });
    await prisma.taskTag.create({ data: { taskId: b.id, tagId: tag.id } });
    expect(await port.deleteCreatedTask(as(ids.sara), b.id, touch(b))).toBe(false);
    const c = await make('Watched');
    await prisma.taskWatcher.create({ data: { taskId: c.id, userId: ids.owner } });
    expect(await port.deleteCreatedTask(as(ids.sara), c.id, touch(c))).toBe(false);
    const d = await make('Blocked');
    await prisma.taskDependency.create({ data: { taskId: d.id, dependsOnTaskId: b.id } });
    expect(await port.deleteCreatedTask(as(ids.sara), d.id, touch(d))).toBe(false);
    const e = await make('Commented');
    await activityService.record({ taskId: e.id, userId: ids.owner, action: 'COMMENTED', meta: { commentId: 'x' } });
    expect(await port.deleteCreatedTask(as(ids.sara), e.id, touch(e))).toBe(false);
    const f = await make('Edited');
    await prisma.task.update({ where: { id: f.id }, data: { version: { increment: 1 } } });
    expect(await port.deleteCreatedTask(as(ids.sara), f.id, touch(f))).toBe(false);
    const g = await make('Reassigned');
    await prisma.taskAssignee.deleteMany({ where: { taskId: g.id } });
    await prisma.taskAssignee.create({ data: { taskId: g.id, userId: ids.owner } });
    expect(await port.deleteCreatedTask(as(ids.sara), g.id, touch(g))).toBe(false);
    for (const x of [b, c, d, e, f, g]) expect(await port.taskState(x.id)).not.toBeNull();
    // The port has no plain delete: nothing else can remove a task through it.
    expect((port as unknown as Record<string, unknown>).deleteTask).toBeUndefined();
  });

  it('a repeating task’s next copy is known (Undo says it stays)', async () => {
    const t = await port.createTask(as(ids.sara), { projectId: ids.project, columnId: ids.todo, title: 'Weekly check', description: '', priority: 'NORMAL', due: null, assigneeIds: [] });
    expect((await port.taskState(t.id))!.nextCopyKey).toBeNull();
    await prisma.task.create({ data: { key: `${CODE}-99`, title: 'Weekly check', projectId: ids.project, columnId: ids.todo, createdById: ids.owner, recurrenceSourceId: t.id } });
    expect((await port.taskState(t.id))!.nextCopyKey).toBe(`${CODE}-99`);
  });

  it('a meeting’s stamp changes when its people, agenda items, notes, action items or decisions do; final minutes saved and taken back out', async () => {
    const m = await prisma.meeting.create({ data: { title: 'MAIP meeting', organizerId: ids.owner, createdById: ids.owner, startAt: new Date('2026-10-27T06:00:00Z'), status: 'SCHEDULED' } });
    const stamps: string[] = [(await port.meetingStamp(m.id))!.stamp];
    const changed = async () => {
      const now0 = (await port.meetingStamp(m.id))!.stamp;
      expect(stamps).not.toContain(now0);
      stamps.push(now0);
    };
    await prisma.meetingAttendee.create({ data: { meetingId: m.id, userId: ids.sara } });
    await changed();
    const agenda = await prisma.agendaItem.create({ data: { meetingId: m.id, title: 'Pressure test' } });
    await changed();
    await prisma.agendaItem.update({ where: { id: agenda.id }, data: { title: 'Pressure test (rig 3)' } });
    await changed();
    const note = await prisma.meetingNote.create({ data: { meetingId: m.id, authorId: ids.owner, body: 'Re-test on rig 3.' } });
    await changed();
    await prisma.meetingNote.update({ where: { id: note.id }, data: { body: 'Re-test on rig 3 next week.', editedAt: new Date() } });
    await changed();
    const action = await prisma.actionItem.create({ data: { meetingId: m.id, description: 'Book the calibration', createdById: ids.owner } });
    await changed();
    await prisma.actionItem.update({ where: { id: action.id }, data: { status: 'COMPLETED' } });
    await changed();
    await prisma.decision.create({ data: { meetingId: m.id, title: 'Re-test on rig 3', createdById: ids.owner } });
    await changed();
    await expect(port.saveMinutes(as(ids.sara), m.id, { content: { summary: 'x', discussion: [], decisions: [], risks: [], nextSteps: [] }, status: 'DRAFT', approvedById: null, approvedAt: null })).rejects.toMatchObject({ status: 403 });
    const saved = await port.saveMinutes(as(ids.owner), m.id, { content: { summary: 'Draft', discussion: [], decisions: [], risks: [], nextSteps: [] }, status: 'DRAFT', approvedById: null, approvedAt: null });
    expect((await port.minutes(m.id))!.savedAt).toEqual(saved.savedAt);
    await port.clearMinutes(as(ids.owner), m.id);
    expect(await port.minutes(m.id)).toBeNull();
    expect(await port.draftMinutes(as(ids.owner), m.id)).toMatchObject({ summary: 'Drafted.', decisions: [] });
    await expect(port.draftMinutes(as(ids.sara), m.id)).rejects.toMatchObject({ status: 403 });
  });
});
