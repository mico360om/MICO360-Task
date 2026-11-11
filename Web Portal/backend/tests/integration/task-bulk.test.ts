import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaTaskRepository, createPrismaProjectLookup } from '../../src/modules/tasks/prisma-task-repository';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createAssigneeService } from '../../src/modules/tasks/assignee-service';
import { createPrismaAssigneeRepository, createPrismaTaskLookup } from '../../src/modules/tasks/prisma-assignee-repository';
import { createGuestService } from '../../src/modules/guests/guest-service';
import { createCategoryService } from '../../src/modules/categories/category-service';
import { createTaskMoveService } from '../../src/modules/tasks/task-move-service';
import { createPrismaTaskMoveRepository } from '../../src/modules/tasks/prisma-task-move-repository';
import { createAuditService } from '../../src/modules/audit/audit-service';
import { createPrismaAuditRepository } from '../../src/modules/audit/prisma-audit-repository';
import { createActivityService } from '../../src/modules/activity/activity-service';
import { createPrismaActivityRepository } from '../../src/modules/activity/prisma-activity-repository';
import { createPrismaArchiveLookup } from '../../src/modules/companies/archive-guard';
import { createPrismaBinStore } from '../../src/modules/recycle-bin/prisma-bin-store';
import { createBinService } from '../../src/modules/recycle-bin/bin-service';
import { createTaskArchiveService } from '../../src/modules/tasks/task-archive';
import { createPrismaTaskArchiveStore } from '../../src/modules/tasks/prisma-task-archive-store';
import { createNotificationService } from '../../src/modules/notifications/notification-service';
import { createPrismaNotificationRepository } from '../../src/modules/notifications/prisma-notification-repository';
import { createTaskBulkService, type BulkActor } from '../../src/modules/tasks/bulk/task-bulk';
import { createBulkPorts } from '../../src/modules/tasks/bulk/bulk-wiring';
import type { TaskDuplicateService } from '../../src/modules/tasks/task-duplicate';

// Bulk task changes on a real database (TEST_DATABASE_URL): each task through its single-task service,
// approvals, the guests rule, archive / delete / move and their Undo (the old number back), one combined
// notice per person, one audit line, Undo once only and only by its maker.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const clock = new Date('2026-11-12T06:00:00Z');
const audit = createAuditService({ audit: createPrismaAuditRepository(prisma) });
const activity = createActivityService({ activities: createPrismaActivityRepository(prisma) });
const recordActivity = async (e: { taskId: string; userId: string; action: string; meta?: Record<string, unknown> }) => {
  const t = await prisma.task.findUnique({ where: { id: e.taskId }, select: { projectId: true } });
  await activity.record({ ...e, projectId: t?.projectId ?? null });
};
const notifications = createNotificationService({ notifications: createPrismaNotificationRepository(prisma) });
const archiveLookup = createPrismaArchiveLookup(prisma);
const isAdmin = (roles: string[]) => roles.includes('ADMIN');
let world: { admin: string; boss: string; mate: string; other: string; P1: string; P2: string; todo1: string; review1: string; done1: string; todo2: string; done2: string; guest: string } = {} as never;
const runs = async (userId: string, projectId: string) =>
  (await prisma.project.count({ where: { id: projectId, OR: [{ ownerId: userId }, { managerId: userId }, { members: { some: { userId, role: 'MANAGER' } } }] } })) > 0;
const sees = async (userId: string, roles: string[], projectId: string) =>
  isAdmin(roles) || (await prisma.project.count({ where: { id: projectId, OR: [{ ownerId: userId }, { members: { some: { userId } } }] } })) > 0;

const guestService = createGuestService({ prisma, recordActivity });
const categoryService = createCategoryService({ prisma, recordActivity });
const assigneeService = createAssigneeService({
  repo: createPrismaAssigneeRepository(prisma),
  taskLookup: createPrismaTaskLookup(prisma),
  beforeUnassign: (taskId, ids) => guestService.assertTeamStays(taskId, ids),
  onAssigned: async (taskId, userIds, actorId) => {
    for (const userId of userIds) if (userId !== actorId) await notifications.notify({ userId, type: 'TASK_ASSIGNED', title: 'You were assigned a task', body: taskId, entityType: 'task', entityId: taskId });
  },
});
const taskService = createTaskService({
  tasks: createPrismaTaskRepository(prisma),
  projects: createPrismaProjectLookup(prisma),
  timeZone: TZ,
  now: () => clock,
  approvals: {
    canApprove: async (userId, projectId) => (await prisma.userRole.count({ where: { userId, role: { name: 'ADMIN' } } })) > 0 || runs(userId, projectId),
    columnsOf: (projectId) => prisma.kanbanColumn.findMany({ where: { projectId }, select: { id: true, category: true, position: true, enabled: true } }),
  },
});
const taskMoveService = createTaskMoveService({ repo: createPrismaTaskMoveRepository(prisma), timeZone: TZ, now: () => clock });
const binService = createBinService({
  store: createPrismaBinStore(prisma),
  timeZone: TZ,
  now: () => clock,
  adminScope: async () => null,
  isArchived: (projectId) => archiveLookup.isArchived(projectId),
  canViewProject: (viewer, projectId) => sees(viewer.id, viewer.roles, projectId),
  record: (e) => activity.record(e).then(() => undefined),
});
const taskArchiveService = createTaskArchiveService({
  ...createPrismaTaskArchiveStore(prisma),
  canViewTask: async (a, taskId) => {
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
    return t ? sees(a.id, a.roles, t.projectId) : false;
  },
  runsProject: async (a, projectId) => isAdmin(a.roles) || runs(a.id, projectId),
  isProjectArchived: (projectId) => archiveLookup.isArchived(projectId),
  recordActivity,
  now: () => clock,
});
const bulk = createTaskBulkService({
  ...createBulkPorts({
    prisma,
    timeZone: TZ,
    taskService,
    assigneeService,
    categoryService,
    guestService,
    taskMoveService,
    taskDuplicateService: { duplicate: async () => { throw new Error('not in this test'); } } as unknown as TaskDuplicateService,
    taskArchiveService,
    binService,
    canViewProject: sees,
    canManageProject: async (userId, roles, projectId) => isAdmin(roles) || runs(userId, projectId),
    isProjectArchived: (projectId) => archiveLookup.isArchived(projectId),
    notify: (n) => notifications.notify(n),
    audit: (e) => audit.record(e),
  }),
  now: () => clock,
});

const CODES = ['BKA', 'BKB'];
const EMAILS = ['bk-admin@mico360.test', 'bk-boss@mico360.test', 'bk-mate@mico360.test', 'bk-other@mico360.test'];
const COMPANY = 'bk_company';
const as = (id: string, roles: string[] = ['EMPLOYEE']): BulkActor => ({ id, roles });
let n = 0;

async function cleanup() {
  const pids = (await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } })).map((p) => p.id);
  const tids = (await prisma.task.findMany({ where: { projectId: { in: pids } }, select: { id: true } })).map((t) => t.id);
  const uids = (await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } })).map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: uids } } });
  await prisma.activity.deleteMany({ where: { OR: [{ projectId: { in: pids } }, { taskId: { in: tids } }] } });
  await prisma.taskKeyAlias.deleteMany({ where: { OR: [{ projectId: { in: pids } }, { taskId: { in: tids } }] } });
  await prisma.task.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.projectCategory.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.project.deleteMany({ where: { id: { in: pids } } });
  await prisma.taskBulkAction.deleteMany({ where: { actorId: { in: uids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: uids } } });
  await prisma.guestContact.deleteMany({ where: { companyId: COMPANY } });
  await prisma.companyMember.deleteMany({ where: { companyId: COMPANY } });
  await prisma.company.deleteMany({ where: { id: COMPANY } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

async function task(projectId: string, columnId: string, extra: { assignees?: string[]; needsApproval?: boolean; createdById?: string } = {}) {
  n += 1;
  const code = projectId === world.P1 ? 'BKA' : 'BKB';
  const t = await prisma.task.create({ data: { key: `${code}-${n}`, title: `Task ${n}`, projectId, columnId, createdById: extra.createdById ?? world.boss, needsApproval: extra.needsApproval ?? false } });
  for (const userId of extra.assignees ?? [world.mate]) await prisma.taskAssignee.create({ data: { taskId: t.id, userId } });
  return t.id;
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
  await prisma.company.create({ data: { id: COMPANY, name: 'BK Co', code: 'BKC' } });
  const user = (email: string, username: string, admin = false) =>
    prisma.user.create({ data: { email, username, passwordHash: 'x', firstName: username, lastName: 'BK', ...(admin ? { roles: { create: { role: { connectOrCreate: { where: { name: 'ADMIN' }, create: { name: 'ADMIN' } } } } } } : {}) } }).then((u) => u.id);
  const admin = await user(EMAILS[0]!, 'bkadmin', true);
  const boss = await user(EMAILS[1]!, 'bkboss');
  const mate = await user(EMAILS[2]!, 'bkmate');
  const other = await user(EMAILS[3]!, 'bkother');
  await prisma.companyMember.createMany({ data: [admin, boss, mate, other].map((userId) => ({ companyId: COMPANY, userId })) });
  const project = async (code: string, members: { userId: string; role?: 'MANAGER' | 'MEMBER' }[]) => {
    const p = await prisma.project.create({ data: { code, name: `Project ${code}`, createdById: boss, ownerId: admin, mainCompanyId: COMPANY, companies: { create: [{ companyId: COMPANY }] }, members: { create: members.map((m) => ({ userId: m.userId, role: m.role ?? 'MEMBER' })) } } });
    const col = (name: string, category: 'TODO' | 'REVIEW' | 'DONE', position: number) => prisma.kanbanColumn.create({ data: { projectId: p.id, name, category, position } }).then((c) => c.id);
    return { id: p.id, col };
  };
  const p1 = await project('BKA', [{ userId: boss, role: 'MANAGER' }, { userId: mate }, { userId: other }]);
  const todo1 = await p1.col('To do', 'TODO', 0);
  const review1 = await p1.col('Review', 'REVIEW', 1);
  const done1 = await p1.col('Done', 'DONE', 2);
  const p2 = await project('BKB', [{ userId: boss, role: 'MANAGER' }, { userId: mate }]);
  const todo2 = await p2.col('Next', 'TODO', 0);
  const done2 = await p2.col('Finished', 'DONE', 1);
  const guest = (await prisma.guestContact.create({ data: { companyId: COMPANY, name: 'Ahmed', nameKey: 'ahmed', createdById: boss } })).id;
  world = { admin, boss, mate, other, P1: p1.id, P2: p2.id, todo1, review1, done1, todo2, done2, guest };
});

describe('bulk changes on a real database', () => {
  it('status Done: done where they may; waiting for approval where it needs it; Undo puts each back', async () => {
    const a = await task(world.P1, world.todo1);
    const b = await task(world.P1, world.todo1, { needsApproval: true });
    const r = await bulk.run(as(world.mate), { taskIds: [a, b], action: { type: 'status', status: 'DONE' } });
    expect(r.changed.map((c) => c.note?.code ?? null)).toEqual([null, 'WAITS_FOR_APPROVAL']);
    expect(await prisma.task.findUnique({ where: { id: a } })).toMatchObject({ columnId: world.done1 });
    expect(await prisma.task.findUnique({ where: { id: b } })).toMatchObject({ columnId: world.review1, completedAt: null });
    const u = await bulk.undo(as(world.mate), r.undo!.id);
    expect(u.restored).toHaveLength(2);
    expect(await prisma.task.findUnique({ where: { id: a } })).toMatchObject({ columnId: world.todo1, completedAt: null });
    expect(await prisma.task.findUnique({ where: { id: b } })).toMatchObject({ columnId: world.todo1, approvalRequestedAt: null });
    await expect(bulk.undo(as(world.mate), r.undo!.id)).rejects.toMatchObject({ code: 'UNDO_DONE' });
  });

  it('assign: one combined notice per person; the history line on each task; one audit line; Undo by its maker only', async () => {
    const ids = [await task(world.P1, world.todo1), await task(world.P1, world.todo1), await task(world.P2, world.todo2)];
    const r = await bulk.run(as(world.boss), { taskIds: ids, action: { type: 'assign', userIds: [world.other] } });
    // OTHER isn't on BKB's team: that task is skipped and says why.
    expect(r.changed).toHaveLength(2);
    expect(r.skipped[0]).toMatchObject({ code: 'NOT_ON_TEAM' });
    const told = await prisma.notification.findMany({ where: { userId: world.other } });
    expect(told).toHaveLength(1);
    expect(told[0]!.title).toBe('bkboss BK assigned you 2 tasks in Project BKA');
    expect(await prisma.auditLog.count({ where: { userId: world.boss, action: 'task.bulk.assign' } })).toBe(1);
    await expect(bulk.undo(as(world.mate), r.undo!.id)).rejects.toMatchObject({ status: 404 });
    await bulk.undo(as(world.boss), r.undo!.id);
    expect(await prisma.taskAssignee.count({ where: { userId: world.other } })).toBe(0);
  });

  it('unassign leaving a task with guests and no team member is skipped (call 5)', async () => {
    const id = await task(world.P1, world.todo1);
    await guestService.addToTask(id, world.guest, null, world.boss);
    const plain = await task(world.P1, world.todo1);
    const r = await bulk.run(as(world.boss), { taskIds: [id, plain], action: { type: 'unassign' } });
    expect(r.skipped).toEqual([{ id, key: expect.any(String), title: expect.any(String), code: 'NEEDS_TEAM_MEMBER', reason: 'It has guests, so it needs at least one person from the team.' }]);
    expect(await prisma.taskAssignee.count({ where: { taskId: id } })).toBe(1);
    expect(await prisma.taskAssignee.count({ where: { taskId: plain } })).toBe(0);
  });

  it('archive (the people who run the project), an archived task read-only, Undo unarchives', async () => {
    const ids = [await task(world.P1, world.todo1), await task(world.P1, world.todo1)];
    const no = await bulk.run(as(world.mate), { taskIds: ids, action: { type: 'archive' } });
    expect(no.changed).toEqual([]);
    expect(no.skipped.map((s) => s.code)).toEqual(['FORBIDDEN', 'FORBIDDEN']);
    const r = await bulk.run(as(world.boss), { taskIds: ids, action: { type: 'archive' } });
    expect(r.changed).toHaveLength(2);
    const edit = await bulk.run(as(world.boss), { taskIds: ids, action: { type: 'priority', priority: 'HIGH' } });
    expect(edit.skipped.map((s) => s.code)).toEqual(['TASK_ARCHIVED', 'TASK_ARCHIVED']);
    await bulk.undo(as(world.boss), r.undo!.id);
    expect(await prisma.task.count({ where: { id: { in: ids }, archivedAt: null } })).toBe(2);
  });

  it('delete by the delete rule; Undo restores from the Recycle Bin', async () => {
    const mine = await task(world.P1, world.todo1, { createdById: world.boss });
    const theirs = await task(world.P1, world.todo1, { createdById: world.other, assignees: [world.mate, world.other] });
    const r = await bulk.run(as(world.boss), { taskIds: [mine, theirs], action: { type: 'delete' } });
    expect(r.changed.map((c) => c.id)).toEqual([mine]);
    expect(r.skipped[0]).toMatchObject({ id: theirs, code: 'DELETE_NOT_ALLOWED' });
    expect(await prisma.task.findUnique({ where: { id: mine } })).toMatchObject({ deletedById: world.boss });
    await bulk.undo(as(world.boss), r.undo!.id);
    expect(await prisma.task.findUnique({ where: { id: mine } })).toMatchObject({ deletedAt: null });
  });

  it('a move to another project, and Undo gives each task its old number back', async () => {
    const id = await task(world.P1, world.todo1);
    const key = (await prisma.task.findUniqueOrThrow({ where: { id } })).key;
    const r = await bulk.run(as(world.boss), { taskIds: [id], action: { type: 'project', projectId: world.P2 } });
    expect(r.changed[0]!.key).toMatch(/^BKB-/);
    await bulk.undo(as(world.boss), r.undo!.id);
    expect(await prisma.task.findUniqueOrThrow({ where: { id } })).toMatchObject({ projectId: world.P1, key, columnId: world.todo1 });
    expect(await prisma.taskKeyAlias.findUnique({ where: { key } })).toBeNull();
    expect(await prisma.taskKeyAlias.findUnique({ where: { key: r.changed[0]!.key } })).toMatchObject({ taskId: id });
  });

  it('due dates shift by days and come back; a field changed since is left alone', async () => {
    const a = await task(world.P1, world.todo1);
    const b = await task(world.P1, world.todo1);
    await prisma.task.updateMany({ where: { id: { in: [a, b] } }, data: { dueDate: new Date('2026-11-20T00:00:00Z') } });
    const r = await bulk.run(as(world.mate), { taskIds: [a, b], action: { type: 'dueDate', mode: 'shift', days: 3 } });
    expect(r.changed).toHaveLength(2);
    await taskService.updateTask(b, { dueDate: new Date('2026-12-01T00:00:00Z') }, undefined, 'one', world.other);
    const u = await bulk.undo(as(world.mate), r.undo!.id);
    expect(u.skipped.map((s) => [s.id, s.code])).toEqual([[b, 'CHANGED_SINCE']]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: a } })).dueDate!.toISOString()).toBe('2026-11-20T00:00:00.000Z');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b } })).dueDate!.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('nothing about a task the person can’t open; more than 500 refused', async () => {
    const hidden = await task(world.P2, world.todo2);
    const r = await bulk.run(as(world.other), { taskIds: [hidden], action: { type: 'priority', priority: 'LOW' } });
    expect(r.skipped).toEqual([{ id: hidden, code: 'NOT_FOUND', reason: 'Task not found.' }]);
    await expect(bulk.run(as(world.other), { taskIds: Array.from({ length: 501 }, (_, i) => `x${i}`), action: { type: 'delete' } })).rejects.toMatchObject({ code: 'TOO_MANY' });
  });
});
