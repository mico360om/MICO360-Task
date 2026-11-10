import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createPrismaTaskRepository, createPrismaProjectLookup } from '../../src/modules/tasks/prisma-task-repository';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createPrismaColumnRepository } from '../../src/modules/projects/prisma-column-repository';
import { createTaskMergeService } from '../../src/modules/task-merge/merge-service';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createAuditService } from '../../src/modules/audit/audit-service';
import { createPrismaAuditRepository } from '../../src/modules/audit/prisma-audit-repository';
import { createActivityService } from '../../src/modules/activity/activity-service';
import { createPrismaActivityRepository } from '../../src/modules/activity/prisma-activity-repository';
import { createPrismaArchiveLookup } from '../../src/modules/companies/archive-guard';
import { createPrismaBinStore } from '../../src/modules/recycle-bin/prisma-bin-store';
import { createBinService, type BinViewer } from '../../src/modules/recycle-bin/bin-service';
import { binExpiryOf } from '../../src/modules/recycle-bin/bin-rules';
import { portabilityProblems } from '../../src/lib/sql-portability';
import { createPrismaRecurrencePort } from '../../src/modules/tasks/prisma-recurrence-port';
import { createPrismaInspectionStore } from '../../src/modules/inspections/prisma-inspection-store';
import { runBackfill } from './company-helpers';

// The Recycle Bin on a real database (TEST_DATABASE_URL, migrations applied): delete → bin with who and
// when, restore of everything under a task, a series restored as a whole, a column gone, an archived
// project, merged tasks never in the bin, the nightly erase (files, search entry, notices, inspections,
// numbers never given again), the upgrade's backfill, and who may do what.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
let clock = new Date('2026-11-10T06:00:00Z');
const tasks = createTaskService({ tasks: createPrismaTaskRepository(prisma), projects: createPrismaProjectLookup(prisma), timeZone: TZ, now: () => clock });
const merges = createTaskMergeService({ prisma, timeZone: TZ, now: () => clock });
const audit = createAuditService({ audit: createPrismaAuditRepository(prisma) });
const activity = createActivityService({ activities: createPrismaActivityRepository(prisma) });
const archive = createPrismaArchiveLookup(prisma);
const removed: string[] = [];
const restoredHook: string[] = [];
const bin = createBinService({
  store: createPrismaBinStore(prisma),
  timeZone: TZ,
  now: () => clock,
  adminScope: async () => null,
  isArchived: (projectId) => archive.isArchived(projectId),
  canViewProject: async (viewer, projectId) =>
    viewer.roles.includes('ADMIN') || (await prisma.projectMember.count({ where: { projectId, userId: viewer.id } })) > 0,
  removeFile: async (key) => {
    removed.push(key);
  },
  audit: (e) => audit.record(e).then(() => undefined),
  record: (e) => activity.record(e).then(() => undefined),
  onRestored: async (rows) => {
    restoredHook.push(...rows.map((r) => r.id));
  },
});

const CODES = ['BIN', 'BIQ'];
const EMAILS = ['bin-admin@mico360.test', 'bin-manager@mico360.test', 'bin-mate@mico360.test', 'bin-other@mico360.test'];
const ids: Record<string, string> = {};
let admin: BinViewer;
let manager: BinViewer;
let mate: BinViewer;
let other: BinViewer;

async function cleanup() {
  const pids = (await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } })).map((p) => p.id);
  const tids = (await prisma.task.findMany({ where: { projectId: { in: pids } }, select: { id: true } })).map((t) => t.id);
  await prisma.taskMerge.deleteMany({ where: { mainTaskId: { in: tids } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: tids } } });
  await prisma.searchIndex.deleteMany({ where: { OR: [{ taskId: { in: tids } }, { projectId: { in: pids } }] } });
  await prisma.inspection.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.activity.deleteMany({ where: { OR: [{ projectId: { in: pids } }, { taskId: { in: tids } }] } });
  await prisma.taskKeyAlias.deleteMany({ where: { OR: [{ projectId: { in: pids } }, { taskId: { in: tids } }] } });
  await prisma.task.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.project.deleteMany({ where: { id: { in: pids } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: tids } }, { userId: { in: Object.values(ids) } }] } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

async function make(title: string, extra: Record<string, unknown> = {}) {
  return tasks.createTask({ title, projectId: ids.project!, columnId: ids.todo!, createdById: ids.manager!, assigneeIds: [ids.mate!], ...extra });
}

/** A delete as the route makes it: the task to the bin, then its history and audit lines. */
async function del(id: string, scope: 'one' | 'series', by: string) {
  const r = await tasks.deleteTask(id, scope, by);
  await bin.deleted({ actorId: by, taskIds: r.ids, batchId: r.batchId });
  return r;
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  clock = new Date('2026-11-10T06:00:00Z');
  removed.length = 0;
  restoredHook.length = 0;
  await cleanup();
  for (const [i, email] of EMAILS.entries()) {
    const first = ['Aisha', 'Sara', 'Omar', 'Bilal'][i]!;
    ids[['admin', 'manager', 'mate', 'other'][i]!] = (await prisma.user.create({ data: { email, username: email.split('@')[0]!, passwordHash: 'x', firstName: first, lastName: 'Bin' } })).id;
  }
  admin = { id: ids.admin!, roles: ['ADMIN'] };
  manager = { id: ids.manager!, roles: ['EMPLOYEE'] };
  mate = { id: ids.mate!, roles: ['EMPLOYEE'] };
  other = { id: ids.other!, roles: ['EMPLOYEE'] };
  const p = await prisma.project.create({ data: { code: 'BIN', name: 'Bin works', createdById: ids.manager!, ownerId: ids.manager!, members: { create: [{ userId: ids.manager!, role: 'MANAGER' }, { userId: ids.mate! }] } } });
  ids.project = p.id;
  const q = await prisma.project.create({ data: { code: 'BIQ', name: 'Other works', createdById: ids.other!, ownerId: ids.other!, members: { create: [{ userId: ids.other!, role: 'MANAGER' }, { userId: ids.mate! }] } } });
  ids.otherProject = q.id;
  ids.todo = (await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'To do', category: 'TODO', position: 0 } })).id;
  ids.doing = (await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Doing', category: 'IN_PROGRESS', position: 1 } })).id;
  ids.doing2 = (await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Doing too', category: 'IN_PROGRESS', position: 2 } })).id;
  ids.done = (await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Done', category: 'DONE', position: 3 } })).id;
  ids.qTodo = (await prisma.kanbanColumn.create({ data: { projectId: q.id, name: 'To do', category: 'TODO', position: 0 } })).id;
  await runBackfill(prisma);
});

describe('deleting puts a task in the Recycle Bin', () => {
  it('records who deleted it, when, and when it will be erased (60 days); the bin lists it for an admin', async () => {
    const t = await make('Order cement');
    await del(t.id, 'one', ids.manager!);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.deletedAt).toEqual(clock);
    expect(row.deletedById).toBe(ids.manager);
    expect(row.binExpiresAt).toEqual(binExpiryOf(clock, TZ));
    expect(row.deleteBatchId).toBeNull();
    const page = await bin.list(admin, null, {});
    expect(page.rows.map((r) => r.id)).toEqual([t.id]);
    expect(page.rows[0]).toMatchObject({ key: t.key, title: 'Order cement', deletedBy: { id: ids.manager, name: 'Sara Bin' }, daysLeft: 60, status: { name: 'To do', category: 'TODO' }, batch: null });
    expect(page.rows[0]!.assignees).toEqual([{ id: ids.mate, name: 'Omar Bin' }]);
    // Out of the live lists at once.
    expect((await tasks.listTasks({ projectId: ids.project! })).map((x) => x.id)).toEqual([]);
  });

  it('the entire series goes as one batch, and restoring one copy with "all" brings back every copy', async () => {
    const head = await make('Weekly check', { recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    const copy = await tasks.createTask({ title: 'Weekly check', projectId: ids.project!, columnId: ids.todo!, createdById: ids.manager!, recurrenceParentId: head.id });
    await del(copy.id, 'series', ids.manager!);
    const rows = await prisma.task.findMany({ where: { id: { in: [head.id, copy.id] } } });
    expect(new Set(rows.map((r) => r.deleteBatchId)).size).toBe(1);
    expect(rows[0]!.deleteBatchId).not.toBeNull();
    const page = await bin.list(manager, null, {});
    expect(page.rows.map((r) => r.batch?.size)).toEqual([2, 2]);
    const result = await bin.restore(manager, [copy.id], { wholeBatch: true });
    expect(result.restored.map((r) => r.id).sort()).toEqual([head.id, copy.id].sort());
    expect((await tasks.listTasks({ projectId: ids.project! })).length).toBe(2);
    expect(restoredHook.sort()).toEqual([head.id, copy.id].sort());
  });

  it('restoring one copy of a series deleted as a whole brings back only that copy when asked', async () => {
    const head = await make('Daily log', { recurrenceRule: { freq: 'DAILY', interval: 1 } });
    const copy = await tasks.createTask({ title: 'Daily log', projectId: ids.project!, columnId: ids.todo!, createdById: ids.manager!, recurrenceParentId: head.id });
    await del(head.id, 'series', ids.manager!);
    const result = await bin.restore(admin, [copy.id], { wholeBatch: false });
    expect(result.restored.map((r) => r.id)).toEqual([copy.id]);
    expect((await bin.list(admin, null, {})).rows.map((r) => r.id)).toEqual([head.id]);
  });
});

describe('restoring brings back everything as it was', () => {
  it('assignees, watchers, tags, contacts, comments and replies, files, checklists, blockers and history', async () => {
    const blocker = await make('Get the permit');
    const t = await make('Pour the slab', { tagNames: ['concrete'], checklists: [{ title: 'Steps', items: [{ text: 'Rebar', children: [{ text: 'Tie the bars' }] }] }] });
    await prisma.taskWatcher.create({ data: { taskId: t.id, userId: ids.manager! } });
    await prisma.taskExternalContact.create({ data: { taskId: t.id, name: 'Site engineer', company: 'Client Co' } });
    const c = await prisma.comment.create({ data: { taskId: t.id, userId: ids.mate!, body: 'Booked the pump' } });
    await prisma.comment.create({ data: { taskId: t.id, userId: ids.manager!, body: 'Thanks', parentId: c.id } });
    await prisma.attachment.create({ data: { taskId: t.id, uploadedById: ids.mate!, filename: 'plan.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'bin-plan.pdf', url: '/uploads/bin-plan.pdf' } });
    await prisma.taskDependency.create({ data: { taskId: t.id, dependsOnTaskId: blocker.id } });
    await activity.record({ taskId: t.id, projectId: ids.project!, userId: ids.manager!, action: 'CREATED', meta: { title: t.title } });
    const before = {
      assignees: await prisma.taskAssignee.count({ where: { taskId: t.id } }),
      watchers: await prisma.taskWatcher.count({ where: { taskId: t.id } }),
      tags: await prisma.taskTag.count({ where: { taskId: t.id } }),
      contacts: await prisma.taskExternalContact.count({ where: { taskId: t.id } }),
      comments: await prisma.comment.count({ where: { taskId: t.id } }),
      files: await prisma.attachment.count({ where: { taskId: t.id } }),
      lists: await prisma.checklistList.count({ where: { taskId: t.id } }),
      items: await prisma.checklistItem.count({ where: { taskId: t.id } }),
      blockers: await prisma.taskDependency.count({ where: { taskId: t.id } }),
    };
    expect(Object.values(before).every((n) => n > 0)).toBe(true);
    await del(t.id, 'one', ids.manager!);
    const detail = await bin.detail(manager, t.id);
    expect(detail.task.title).toBe('Pour the slab');
    expect(detail.comments.map((x) => [x.body, x.replies.map((r) => r.body)])).toEqual([['Booked the pump', ['Thanks']]]);
    expect(detail.files.map((f) => f.filename)).toEqual(['plan.pdf']);
    expect(detail.checklists[0]!.items.map((i) => [i.text, i.depth])).toEqual([['Rebar', 0], ['Tie the bars', 1]]);
    expect(detail.bin).toMatchObject({ deletedBy: { id: ids.manager, name: 'Sara Bin' }, daysLeft: 60, canRestore: true, canErase: false });
    expect(detail.history.some((h) => h.action === 'DELETED')).toBe(true);
    await bin.restore(manager, [t.id], {});
    const after = {
      assignees: await prisma.taskAssignee.count({ where: { taskId: t.id } }),
      watchers: await prisma.taskWatcher.count({ where: { taskId: t.id } }),
      tags: await prisma.taskTag.count({ where: { taskId: t.id } }),
      contacts: await prisma.taskExternalContact.count({ where: { taskId: t.id } }),
      comments: await prisma.comment.count({ where: { taskId: t.id } }),
      files: await prisma.attachment.count({ where: { taskId: t.id } }),
      lists: await prisma.checklistList.count({ where: { taskId: t.id } }),
      items: await prisma.checklistItem.count({ where: { taskId: t.id } }),
      blockers: await prisma.taskDependency.count({ where: { taskId: t.id } }),
    };
    expect(after).toEqual(before);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ deletedAt: null, deletedById: null, binExpiresAt: null, deleteBatchId: null, key: t.key });
    // The history says who deleted and who restored it; the audit log too.
    const lines = await prisma.activity.findMany({ where: { taskId: t.id }, orderBy: { createdAt: 'asc' } });
    expect(lines.map((l) => l.action)).toEqual(expect.arrayContaining(['DELETED', 'RESTORED']));
    const logged = await prisma.auditLog.findMany({ where: { entityId: t.id }, select: { action: true } });
    expect(logged.map((l) => l.action).sort()).toEqual(['task.deleted', 'task.restored']);
  });

  it('a task whose column was deleted meanwhile goes to the first column of the same kind', async () => {
    const t = await make('Paint the fence', { columnId: ids.doing! });
    await del(t.id, 'one', ids.manager!);
    await createPrismaColumnRepository(prisma).remove(ids.doing!);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).columnId).toBe(ids.doing2);
    await bin.restore(manager, [t.id], {});
    expect((await tasks.getTask(t.id)).columnId).toBe(ids.doing2);
  });

  it('a task of an archived project is not restored: unarchive the project first', async () => {
    const t = await make('Close out');
    await del(t.id, 'one', ids.manager!);
    await prisma.project.update({ where: { id: ids.project! }, data: { status: 'ARCHIVED' } });
    const result = await bin.restore(manager, [t.id], {});
    expect(result.restored).toEqual([]);
    expect(result.notRestored).toEqual([{ id: t.id, key: t.key, title: 'Close out', reason: 'archived', message: expect.stringMatching(/unarchive the project first/i) }]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).deletedAt).not.toBeNull();
  });
});

describe('merged tasks are never in the Recycle Bin', () => {
  it('not listed, not restored, not erased, and the sweep leaves them', async () => {
    const main = await make('Main');
    const merged = await make('Merged');
    await merges.merge({ id: ids.manager!, roles: [] }, { taskIds: [main.id, merged.id], mainTaskId: main.id });
    expect((await bin.list(admin, null, {})).rows).toEqual([]);
    expect((await bin.restore(admin, [merged.id], {})).restored).toEqual([]);
    expect((await bin.erase(admin, [merged.id])).erased).toEqual([]);
    clock = new Date('2027-06-01T00:00:00Z');
    await bin.sweep();
    expect(await prisma.task.count({ where: { id: merged.id } })).toBe(1);
  });
});

describe('the nightly erase', () => {
  it('erases a task after its 60 days: everything under it, its files, search entry and notices; the audit log keeps it', async () => {
    const t = await make('Old survey');
    await prisma.attachment.create({ data: { taskId: t.id, uploadedById: ids.mate!, filename: 'survey.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'bin-survey.pdf', url: '/uploads/bin-survey.pdf' } });
    await prisma.comment.create({ data: { taskId: t.id, userId: ids.mate!, body: 'Done' } });
    await prisma.notification.create({ data: { userId: ids.mate!, type: 'TASK_ASSIGNED', title: 'x', entityType: 'task', entityId: t.id, projectId: ids.project! } });
    await createTaskSearchIndex({ prisma }).refresh([t.id]);
    const insp = await prisma.inspection.create({ data: { projectId: ids.project!, formVersion: 1, title: 'Survey check', structure: {}, taskId: t.id, inspectorId: ids.mate!, startedById: ids.mate! } });
    await del(t.id, 'one', ids.manager!);
    clock = new Date('2027-01-08T00:00:00Z'); // 59 days on: not yet
    expect(await bin.sweep()).toBe(0);
    clock = new Date('2027-01-09T21:00:00Z'); // the midnight after day 60 has passed (Muscat)
    expect(await bin.sweep()).toBe(1);
    expect(await prisma.task.count({ where: { id: t.id } })).toBe(0);
    expect(await prisma.comment.count({ where: { taskId: t.id } })).toBe(0);
    expect(await prisma.attachment.count({ where: { taskId: t.id } })).toBe(0);
    expect(await prisma.taskSearchIndex.count({ where: { taskId: t.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { entityId: t.id } })).toBe(0);
    expect(removed).toEqual(['bin-survey.pdf']);
    // The inspection is a compliance record: it stays, saying which task it was for.
    expect(await prisma.inspection.findUniqueOrThrow({ where: { id: insp.id } })).toMatchObject({ taskId: null, erasedTask: `${t.key} 'Old survey'` });
    const line = await prisma.auditLog.findFirstOrThrow({ where: { entityId: t.id, action: 'task.erased' } });
    expect(line.newValue).toMatchObject({ taskKey: t.key, title: 'Old survey', reason: 'Recycle Bin, 60 days' });
  });

  it('a file another row still uses stays on disk', async () => {
    const a = await make('A');
    const b = await make('B');
    for (const taskId of [a.id, b.id]) {
      await prisma.attachment.create({ data: { taskId, uploadedById: ids.mate!, filename: 'shared.pdf', mimeType: 'application/pdf', sizeBytes: 9, storageKey: 'bin-shared.pdf', url: '/uploads/bin-shared.pdf' } });
    }
    await del(a.id, 'one', ids.manager!);
    await bin.erase(admin, [a.id]);
    expect(removed).toEqual([]);
  });

  it('erasing the newest task never frees its number', async () => {
    const t1 = await make('One');
    const t2 = await make('Two');
    await del(t2.id, 'one', ids.manager!);
    await bin.erase(admin, [t2.id]);
    const t3 = await make('Three');
    expect(Number(t3.key.split('-')[1])).toBe(Number(t2.key.split('-')[1]) + 1);
    expect(t1.key).not.toBe(t3.key);
  });

  it('erasing a merge’s main task never frees the merged task’s number either', async () => {
    const main = await make('Main');
    const merged = await make('Merged');
    await merges.merge({ id: ids.manager!, roles: [] }, { taskIds: [main.id, merged.id], mainTaskId: main.id });
    await del(main.id, 'one', ids.manager!);
    await bin.erase(admin, [main.id]);
    expect(await prisma.task.count({ where: { id: { in: [main.id, merged.id] } } })).toBe(0);
    const next = await make('Next');
    expect(Number(next.key.split('-')[1])).toBe(Number(merged.key.split('-')[1]) + 1);
  });
});

describe('who may do what', () => {
  it('admins see every deleted task; managers their projects’ only; members and others are refused', async () => {
    const mine = await make('Mine');
    const theirs = await tasks.createTask({ title: 'Theirs', projectId: ids.otherProject!, columnId: ids.qTodo!, createdById: ids.other! });
    await del(mine.id, 'one', ids.manager!);
    await del(theirs.id, 'one', ids.other!);
    expect((await bin.list(admin, null, {})).rows.map((r) => r.id).sort()).toEqual([mine.id, theirs.id].sort());
    expect((await bin.list(manager, null, {})).rows.map((r) => r.id)).toEqual([mine.id]);
    await expect(bin.list(mate, null, {})).rejects.toMatchObject({ status: 403 });
    // Restoring or opening someone else's: as if it weren't there.
    expect((await bin.restore(manager, [theirs.id], {})).notRestored).toEqual([{ id: theirs.id, reason: 'not_found', message: expect.any(String) }]);
    await expect(bin.detail(manager, theirs.id)).rejects.toMatchObject({ status: 404 });
    await expect(bin.detail(mate, mine.id)).rejects.toMatchObject({ status: 404 });
    // Delete forever: admins only.
    await expect(bin.erase(manager, [mine.id])).rejects.toMatchObject({ status: 403 });
    expect((await bin.erase(admin, [mine.id])).erased.map((e) => e.id)).toEqual([mine.id]);
  });

  it('opening a deleted task: its project’s people hear "This task was deleted"; nobody else learns anything', async () => {
    const t = await make('Gone');
    await del(t.id, 'one', ids.manager!);
    expect(await bin.noticeFor(mate, t.id)).toBe('TASK_DELETED');
    expect(await bin.noticeFor(other, t.id)).toBeNull();
    expect(await bin.noticeFor(manager, 'no-such-task')).toBeNull();
  });
});

describe('the upgrade (older deletes)', () => {
  const FILE = resolve(__dirname, '../../prisma/migrations/20261111010100_recycle_bin_backfill/migration.sql');
  const statements = () =>
    readFileSync(FILE, 'utf8')
      .split(/\r?\n/)
      .filter((l) => !/^\s*--/.test(l))
      .join('\n')
      .split(/;\s*(?:\n|$)/)
      .map((s) => s.trim())
      .filter(Boolean);

  it('is MariaDB-safe', () => {
    for (const s of statements()) expect(portabilityProblems(s)).toEqual([]);
  });

  it('gives tasks deleted before the bin a full 60 days from the upgrade, "Deleted by" unknown; merged ones untouched; marks set; runs twice the same', async () => {
    const old = await make('Deleted long ago');
    const main = await make('Main');
    const merged = await make('Merged');
    await merges.merge({ id: ids.manager!, roles: [] }, { taskIds: [main.id, merged.id], mainTaskId: main.id });
    await prisma.task.update({ where: { id: old.id }, data: { deletedAt: new Date('2026-09-01T08:00:00Z') } });
    await prisma.project.update({ where: { id: ids.project! }, data: { taskNumberMark: 0 } });
    for (let i = 0; i < 2; i++) for (const s of statements()) await prisma.$executeRawUnsafe(s);
    const today = (await prisma.$queryRaw<{ today: string }[]>`SELECT DATE_FORMAT(UTC_TIMESTAMP() + INTERVAL 4 HOUR, '%Y-%m-%d') AS today`)[0]!.today;
    // Muscat's day of the upgrade (UTC + 4), +61 days, at Muscat midnight: a full 60 days whatever the hour.
    const want = new Date(`${today}T00:00:00.000Z`);
    want.setUTCDate(want.getUTCDate() + 61);
    want.setUTCHours(want.getUTCHours() - 4);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ binExpiresAt: want, deletedById: null });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: merged.id } })).binExpiresAt).toBeNull();
    const highest = Math.max(...[old, main, merged].map((t) => Number(t.key.split('-')[1])));
    expect((await prisma.project.findUniqueOrThrow({ where: { id: ids.project! } })).taskNumberMark).toBe(highest);
    const page = await bin.list(admin, null, {});
    expect(page.rows.map((r) => [r.id, r.deletedBy])).toEqual([[old.id, null]]);
  });
});

describe('review fixes', () => {
  it('C1: the read-only view never names a blocker the person can’t open, nor a deleted one', async () => {
    const t = await make('Blocked task');
    const seen = await make('Visible blocker');
    const gone = await make('Deleted blocker');
    const hidden = await tasks.createTask({ title: 'Secret blocker', projectId: ids.otherProject!, columnId: ids.qTodo!, createdById: ids.other! });
    for (const b of [seen, gone, hidden]) await prisma.taskDependency.create({ data: { taskId: t.id, dependsOnTaskId: b.id } });
    await del(gone.id, 'one', ids.manager!);
    await del(t.id, 'one', ids.manager!);
    // The manager doesn't see the other project: its task isn't named.
    expect((await bin.detail(manager, t.id)).blockers.map((b) => b.title)).toEqual(['Visible blocker']);
    expect((await bin.detail(admin, t.id)).blockers.map((b) => b.title).sort()).toEqual(['Secret blocker', 'Visible blocker']);
  });

  it('I1: a restore racing an erase never reports a task restored that is then erased', async () => {
    for (let i = 0; i < 6; i++) {
      const t = await make(`Race ${i}`);
      await prisma.comment.create({ data: { taskId: t.id, userId: ids.mate!, body: 'x' } });
      await del(t.id, 'one', ids.manager!);
      const [restored, erased] = await Promise.all([bin.restore(admin, [t.id], {}), bin.erase(admin, [t.id])]);
      const there = (await prisma.task.count({ where: { id: t.id } })) === 1;
      expect(restored.restored.length + erased.erased.length).toBe(1);
      expect(there).toBe(restored.restored.length === 1);
    }
  });

  it('I2: erasing deleted copies keeps a counted series counted, and an earlier copy keeps its next copy', async () => {
    const port = createPrismaRecurrencePort(prisma, { timeZone: TZ });
    const head = await make('Counted', { recurrenceRule: { freq: 'DAILY', interval: 1, count: 3 } });
    await prisma.task.update({ where: { id: head.id }, data: { recurrenceParentId: head.id } });
    const second = await tasks.createTask({ title: 'Counted', projectId: ids.project!, columnId: ids.todo!, createdById: ids.manager!, recurrenceParentId: head.id });
    const third = await tasks.createTask({ title: 'Counted', projectId: ids.project!, columnId: ids.todo!, createdById: ids.manager!, recurrenceParentId: head.id });
    await prisma.task.update({ where: { id: second.id }, data: { recurrenceSourceId: head.id } });
    await prisma.task.update({ where: { id: third.id }, data: { recurrenceSourceId: second.id } });
    expect(await port.countInstances(head.id)).toBe(3);
    await del(second.id, 'one', ids.manager!);
    await bin.erase(admin, [second.id]);
    // Still three made: the series stays full (no fourth copy), and the head's next copy is the third.
    expect(await port.countInstances(head.id)).toBe(3);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: third.id } })).recurrenceSourceId).toBe(head.id);
    expect((await tasks.getTask(head.id)).recurrenceNextId).toBe(third.id);
  });

  it('I3: an inspection whose task was erased still says which task it was for', async () => {
    const t = await make('Inspect rig 3');
    const insp = await prisma.inspection.create({ data: { projectId: ids.project!, formVersion: 1, title: 'Rig check', structure: { sections: [] }, taskId: t.id, inspectorId: ids.mate!, startedById: ids.mate! } });
    await del(t.id, 'one', ids.manager!);
    await bin.erase(admin, [t.id]);
    const record = await createPrismaInspectionStore(prisma).findInspection(insp.id);
    expect(record).toMatchObject({ taskId: null, erasedTask: `${t.key} 'Inspect rig 3'` });
  });
});
