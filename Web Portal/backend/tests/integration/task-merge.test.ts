import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { createPrismaTaskRepository, createPrismaProjectLookup } from '../../src/modules/tasks/prisma-task-repository';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createTaskMergeService, type MergeActor } from '../../src/modules/task-merge/merge-service';
import { runBackfill } from './company-helpers';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createSearchIndex } from '../../src/modules/search/search-index';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const NOW = new Date('2026-11-05T06:00:00Z');
const taskService = createTaskService({ tasks: createPrismaTaskRepository(prisma), projects: createPrismaProjectLookup(prisma), timeZone: TZ, now: () => NOW });
const files = new Map<string, Buffer>();
const service = (client: PrismaClient = prisma) => createTaskMergeService({ prisma: client, timeZone: TZ, now: () => NOW, readFile: async (k) => files.get(k) ?? null });
const merges = service();
const taskIndex = createTaskSearchIndex({ prisma });
const generalIndex = createSearchIndex({ prisma });

const CODES = ['MGRIG', 'MGOPS', 'MGARC'];
const EMAILS = ['mg-admin@mico360.test', 'mg-manager@mico360.test', 'mg-half@mico360.test', 'mg-employee@mico360.test', 'mg-mate@mico360.test', 'mg-outsider@mico360.test'];

let admin: MergeActor = { id: '', roles: ['ADMIN'] };
let manager: MergeActor = { id: '', roles: ['EMPLOYEE'] };
let half: MergeActor = { id: '', roles: ['EMPLOYEE'] };
let employee: MergeActor = { id: '', roles: ['EMPLOYEE'] };
let mateId = '';
let outsiderId = '';
let rig = { id: '', todo: '', doing: '', done: '' };
let ops = { id: '', todo: '', doing: '', done: '' };
let arc = { id: '', todo: '', doing: '', done: '' };

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } })).map((p) => p.id);
  const taskIds = (await prisma.task.findMany({ where: { projectId: { in: ids } }, select: { id: true } })).map((t) => t.id);
  await prisma.taskMerge.deleteMany({ where: { mainTaskId: { in: taskIds } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: taskIds } } });
  await prisma.actionItem.deleteMany({ where: { OR: [{ taskId: { in: taskIds } }, { projectId: { in: ids } }] } });
  await prisma.inspection.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.meeting.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.searchIndex.deleteMany({ where: { OR: [{ taskId: { in: taskIds } }, { projectId: { in: ids } }] } });
  await prisma.activity.deleteMany({ where: { OR: [{ projectId: { in: ids } }, { taskId: { in: taskIds } }] } });
  await prisma.taskKeyAlias.deleteMany({ where: { OR: [{ projectId: { in: ids } }, { taskId: { in: taskIds } }] } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.tag.deleteMany({ where: { name: { startsWith: 'mg-' } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

async function project(code: string, name: string, extra: Partial<Prisma.ProjectUncheckedCreateInput> = {}) {
  const p = await prisma.project.create({ data: { code, name, createdById: manager.id, ...extra } });
  const col = (n: string, category: 'TODO' | 'IN_PROGRESS' | 'DONE', position: number) => prisma.kanbanColumn.create({ data: { projectId: p.id, name: n, category, position } }).then((c) => c.id);
  return { id: p.id, todo: await col('To do', 'TODO', 0), doing: await col(code === 'MGOPS' ? 'Doing' : 'In progress', 'IN_PROGRESS', 1), done: await col('Done', 'DONE', 2) };
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
  files.clear();
  const user = (email: string, first: string, last: string) => prisma.user.create({ data: { email, username: email.split('@')[0]!, passwordHash: 'x', firstName: first, lastName: last } });
  admin = { id: (await user(EMAILS[0]!, 'Khurram', 'Admin')).id, roles: ['ADMIN'] };
  manager = { id: (await user(EMAILS[1]!, 'Aisha', 'Khan')).id, roles: ['EMPLOYEE'] };
  half = { id: (await user(EMAILS[2]!, 'Hamed', 'Rashid')).id, roles: ['EMPLOYEE'] };
  employee = { id: (await user(EMAILS[3]!, 'Emp', 'Loyee')).id, roles: ['EMPLOYEE'] };
  mateId = (await user(EMAILS[4]!, 'Omar', 'Ahmed')).id;
  outsiderId = (await user(EMAILS[5]!, 'Sara', 'Al Balushi')).id;
  const adminRole = await prisma.role.upsert({ where: { name: 'ADMIN' }, update: {}, create: { name: 'ADMIN' } });
  await prisma.userRole.create({ data: { userId: admin.id, roleId: adminRole.id } });
  rig = await project('MGRIG', 'Rig Inspection');
  ops = await project('MGOPS', 'Operations');
  arc = await project('MGARC', 'Old Works');
  // Aisha manages Rig and Operations; Hamed manages Rig only; Emp and Omar are on both teams; Sara only on Rig.
  await prisma.projectMember.createMany({
    data: [
      { projectId: rig.id, userId: manager.id, role: 'MANAGER' },
      { projectId: ops.id, userId: manager.id, role: 'MANAGER' },
      { projectId: arc.id, userId: manager.id, role: 'MANAGER' },
      { projectId: rig.id, userId: half.id, role: 'MANAGER' },
      { projectId: ops.id, userId: half.id },
      { projectId: rig.id, userId: employee.id },
      { projectId: ops.id, userId: employee.id },
      { projectId: rig.id, userId: mateId },
      { projectId: ops.id, userId: mateId },
      { projectId: rig.id, userId: outsiderId },
    ],
  });
  await runBackfill(prisma);
});

let clock = 0;
const newTask = async (title: string, extra: Partial<Parameters<typeof taskService.createTask>[0]> = {}) => {
  const t = await taskService.createTask({ title, projectId: rig.id, columnId: rig.todo, createdById: manager.id, ...extra });
  // Created one after another (the oldest is the default main task).
  await prisma.task.update({ where: { id: t.id }, data: { createdAt: new Date(Date.UTC(2026, 9, 1) + ++clock * 60_000) } });
  return t;
};

/** Rows of every table around these tasks, as [table, count]. */
async function counts(taskIds: string[]) {
  const t = { in: taskIds };
  return {
    comments: await prisma.comment.count({ where: { taskId: t } }),
    attachments: await prisma.attachment.count({ where: { taskId: t } }),
    checklist: await prisma.checklistItem.count({ where: { taskId: t } }),
    activity: await prisma.activity.count({ where: { taskId: t } }),
    assignees: await prisma.taskAssignee.count({ where: { taskId: t } }),
    watchers: await prisma.taskWatcher.count({ where: { taskId: t } }),
    tags: await prisma.taskTag.count({ where: { taskId: t } }),
    contacts: await prisma.taskExternalContact.count({ where: { taskId: t } }),
    dependencies: await prisma.taskDependency.count({ where: { OR: [{ taskId: t }, { dependsOnTaskId: t }] } }),
    actionItems: await prisma.actionItem.count({ where: { taskId: t } }),
    notifications: await prisma.notification.count({ where: { entityId: t } }),
    inspections: await prisma.inspection.count({ where: { taskId: t } }),
    answers: await prisma.inspectionAnswer.count({ where: { inspection: { taskId: t } } }),
    signatures: await prisma.inspectionSignature.count({ where: { inspection: { taskId: t } } }),
    followUps: await prisma.inspectionFollowUp.count({ where: { OR: [{ taskId: t }, { inspection: { taskId: t } }] } }),
    aliases: await prisma.taskKeyAlias.count({ where: { taskId: t } }),
    meetingNotes: await prisma.meetingNote.count({ where: { taskId: t } }),
    taskSearchRows: await prisma.taskSearchIndex.count({ where: { taskId: t } }),
    fileSearchRows: await prisma.searchIndex.count({ where: { kind: 'file', taskId: t } }),
    tasks: await prisma.task.count({ where: { id: t } }),
  };
}

/** Everything a task holds, by row: what Undo must give back. */
async function holdings(taskId: string) {
  const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id).sort();
  return {
    comments: ids(await prisma.comment.findMany({ where: { taskId }, select: { id: true } })),
    attachments: ids(await prisma.attachment.findMany({ where: { taskId }, select: { id: true } })),
    checklist: (await prisma.checklistItem.findMany({ where: { taskId }, select: { id: true, position: true, text: true, done: true }, orderBy: { id: 'asc' } })),
    activity: ids(await prisma.activity.findMany({ where: { taskId, action: { notIn: ['TASKS_MERGED', 'MERGED_INTO', 'MERGE_UNDONE'] } }, select: { id: true } })),
    assignees: (await prisma.taskAssignee.findMany({ where: { taskId }, select: { userId: true } })).map((a) => a.userId).sort(),
    watchers: (await prisma.taskWatcher.findMany({ where: { taskId }, select: { userId: true } })).map((a) => a.userId).sort(),
    tags: (await prisma.taskTag.findMany({ where: { taskId }, select: { tagId: true } })).map((a) => a.tagId).sort(),
    contacts: await prisma.taskExternalContact.findMany({ where: { taskId }, select: { id: true, name: true, company: true, email: true, phone: true, position: true }, orderBy: { id: 'asc' } }),
    blockedBy: (await prisma.taskDependency.findMany({ where: { taskId }, select: { dependsOnTaskId: true } })).map((d) => d.dependsOnTaskId).sort(),
    blocks: (await prisma.taskDependency.findMany({ where: { dependsOnTaskId: taskId }, select: { taskId: true } })).map((d) => d.taskId).sort(),
    actionItems: ids(await prisma.actionItem.findMany({ where: { taskId }, select: { id: true } })),
    notifications: ids(await prisma.notification.findMany({ where: { entityId: taskId }, select: { id: true } })),
    inspections: ids(await prisma.inspection.findMany({ where: { taskId }, select: { id: true } })),
    aliases: (await prisma.taskKeyAlias.findMany({ where: { taskId }, select: { key: true } })).map((a) => a.key).sort(),
    followUps: ids(await prisma.inspectionFollowUp.findMany({ where: { taskId }, select: { id: true } })),
    meetingNotes: ids(await prisma.meetingNote.findMany({ where: { taskId }, select: { id: true } })),
    fields: await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { key: true, title: true, description: true, projectId: true, columnId: true, priority: true, startDate: true, dueDate: true, isMilestone: true, recurrenceRule: true, deletedAt: true, mergedIntoId: true, completedAt: true },
    }),
  };
}

/** A task with a bit of everything. */
async function fullTask(title: string, extra: Partial<Parameters<typeof taskService.createTask>[0]> = {}, n = 1) {
  const t = await newTask(title, extra);
  await prisma.comment.create({ data: { taskId: t.id, userId: manager.id, body: `${title}: first comment`, createdAt: new Date(Date.UTC(2026, 9, 2, n)) } });
  const parent = await prisma.comment.create({ data: { taskId: t.id, userId: mateId, body: `${title}: a question` } });
  await prisma.comment.create({ data: { taskId: t.id, userId: manager.id, body: 'An answer', parentId: parent.id } });
  await prisma.checklistItem.create({ data: { taskId: t.id, text: `${title}: step`, position: 0 } });
  await prisma.checklistItem.create({ data: { taskId: t.id, text: 'Fire exits', done: true, position: 1 } });
  await prisma.activity.create({ data: { taskId: t.id, projectId: t.projectId, userId: manager.id, action: 'CREATED', meta: { title } } });
  const storageKey = `${t.id}.pdf`;
  files.set(storageKey, Buffer.from('the same report'));
  await prisma.attachment.create({ data: { taskId: t.id, uploadedById: manager.id, filename: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 15, storageKey, url: `/uploads/${storageKey}` } });
  await prisma.attachment.create({ data: { taskId: t.id, uploadedById: manager.id, filename: `${title}.png`, mimeType: 'image/png', sizeBytes: 9, storageKey: `${t.id}-own.png`, url: `/uploads/${t.id}-own.png` } });
  await prisma.taskExternalContact.create({ data: { taskId: t.id, name: 'Ahmed', email: 'ahmed@oxy.test', ...(n === 1 ? {} : { company: 'OXY', phone: '+968 9123 4567' }), position: 0 } });
  await prisma.taskExternalContact.create({ data: { taskId: t.id, name: `${title} contact`, email: `${n}@supplier.test`, position: 1 } });
  await prisma.taskWatcher.create({ data: { taskId: t.id, userId: mateId } });
  const tag = await prisma.tag.upsert({ where: { name: `mg-${n}` }, update: {}, create: { name: `mg-${n}` } });
  const shared = await prisma.tag.upsert({ where: { name: 'mg-shared' }, update: {}, create: { name: 'mg-shared' } });
  await prisma.taskTag.createMany({ data: [{ taskId: t.id, tagId: tag.id }, { taskId: t.id, tagId: shared.id }] });
  await prisma.actionItem.create({ data: { description: `${title} action`, taskId: t.id, projectId: t.projectId, createdById: manager.id } });
  await prisma.notification.create({ data: { userId: mateId, type: 'TASK_ASSIGNED', title: 'You were assigned', entityType: 'task', entityId: t.id, projectId: t.projectId } });
  const insp = await prisma.inspection.create({ data: { projectId: t.projectId, formVersion: 1, title: `${title} inspection`, structure: [], taskId: t.id, inspectorId: manager.id, startedById: manager.id } });
  await prisma.inspectionAnswer.create({ data: { inspectionId: insp.id, itemId: 'i1', result: 'PASS', editedAt: NOW, answeredById: manager.id } });
  await prisma.inspectionSignature.create({ data: { inspectionId: insp.id, role: 'INSPECTOR', name: 'Aisha', method: 'TYPED', signedAt: NOW, capturedById: manager.id } });
  // The task follows up a failed item of another inspection, and was made from a meeting's note.
  const failed = await prisma.inspection.create({ data: { projectId: t.projectId, formVersion: 1, title: `${title} failed check`, structure: [], inspectorId: manager.id, startedById: manager.id } });
  await prisma.inspectionFollowUp.create({ data: { inspectionId: failed.id, itemId: 'i9', taskId: t.id, createdById: manager.id } });
  const meeting = await prisma.meeting.create({ data: { title: `${title} meeting`, projectId: t.projectId, organizerId: manager.id, createdById: manager.id, startAt: NOW } });
  await prisma.meetingNote.create({ data: { meetingId: meeting.id, authorId: manager.id, body: `Make ${title} a task`, taskId: t.id } });
  return t;
}

describe('Merging tasks (integration)', () => {
  it('moves everything to the main task, keeps duplicates once, hides the others and gives their numbers to the main task', async () => {
    const main = await fullTask('Inspect pump', { assigneeIds: [mateId], description: 'Main notes' }, 1);
    const other = await fullTask('Pump check', { assigneeIds: [mateId, employee.id], priority: 'HIGH', description: 'Other notes' }, 2);
    const blocker = await newTask('Order parts');
    await prisma.taskDependency.create({ data: { taskId: other.id, dependsOnTaskId: blocker.id } });
    const before = await holdings(other.id);

    const preview = await merges.preview(manager, { taskIds: [other.id, main.id] });
    expect(preview.mainTaskId).toBe(main.id); // the oldest
    expect(preview.canMerge).toBe(true);
    expect(preview.differences.map((d) => d.field)).toEqual(['title', 'priority']);
    expect(preview.duplicates).toMatchObject({ checklist: 1, files: 1, contacts: 1, assignees: 1, watchers: 1, tags: 1 });
    expect(preview.duplicatesText).toBe('1 checklist item, 1 file, 1 contact, 1 person, 1 watcher and 1 tag appear in more than one task — kept once.');
    expect(preview.tasks.find((t) => t.id === other.id)!.counts).toMatchObject({ comments: 3, checklist: 2, files: 2, contacts: 2, tags: 2, blockers: 1, actionItems: 1, inspections: 1, assignees: 2, watchers: 1 });

    const result = await merges.merge(manager, { taskIds: [main.id, other.id], mainTaskId: main.id, choices: { priority: other.id } });
    expect(result.text).toBe(`Merged ${other.key} into ${main.key}`);

    const m = await holdings(main.id);
    const o = await holdings(other.id);
    // Comments, history, files (the duplicate kept once), checklist (the duplicate once), action items, notices, inspections.
    expect(m.comments).toEqual([...before.comments, ...(await prisma.comment.findMany({ where: { taskId: main.id, NOT: { id: { in: before.comments } } }, select: { id: true } })).map((c) => c.id)].sort());
    expect(m.comments).toHaveLength(6);
    expect(o.comments).toEqual([]);
    expect(m.attachments).toHaveLength(3); // its two + the other's own picture; the same report kept once
    expect(o.attachments).toHaveLength(1);
    expect(m.checklist.map((c) => c.text)).toEqual(expect.arrayContaining(['Inspect pump: step', 'Fire exits', 'Pump check: step']));
    expect(m.checklist).toHaveLength(3);
    expect(o.checklist.map((c) => c.text)).toEqual(['Fire exits']);
    expect(m.actionItems).toHaveLength(2);
    expect(m.notifications).toHaveLength(2);
    expect(m.inspections).toHaveLength(2);
    expect(m.activity).toHaveLength(2);
    // People and tags once each; the contact with the same email once, filled in from the other copy.
    expect(m.assignees).toEqual([employee.id, mateId].sort());
    expect(o.assignees).toEqual([mateId]);
    expect(m.watchers).toEqual([mateId]);
    expect(m.tags).toHaveLength(3);
    expect(m.contacts).toHaveLength(3);
    const ahmed = m.contacts.find((c) => c.email === 'ahmed@oxy.test')!;
    expect(ahmed).toMatchObject({ company: 'OXY', phone: '+968 9123 4567' });
    expect(m.blockedBy).toEqual([blocker.id]);
    // The main task's fields: the choices, the descriptions joined under a heading.
    expect(m.fields).toMatchObject({ priority: 'HIGH', title: 'Inspect pump', description: `Main notes\n\n— From ${other.key} · Pump check —\nOther notes`, mergedIntoId: null, deletedAt: null });
    // The other task: a hidden, read-only record, its own fields as they were; its number the main task's.
    expect(o.fields).toMatchObject({ key: other.key, title: 'Pump check', priority: 'HIGH', description: 'Other notes', mergedIntoId: main.id });
    expect(o.fields.deletedAt).not.toBeNull();
    expect(m.aliases).toEqual([other.key]);
    expect(await taskService.listTasks({ projectId: rig.id }).then((ts) => ts.map((t) => t.id))).not.toContain(other.id);
    // History: the merge's line on the main task, one on the other, their own lines labelled by where they came from.
    const line = await prisma.activity.findFirstOrThrow({ where: { taskId: main.id, action: 'TASKS_MERGED' } });
    expect(line.meta).toMatchObject({ keys: [other.key], mainKey: main.key, chosen: [{ field: 'priority', fromKey: other.key }] });
    expect(await prisma.activity.count({ where: { taskId: other.id, action: 'MERGED_INTO' } })).toBe(1);
    const panel = await merges.mergedFrom(manager, main.id);
    expect(panel.merges).toHaveLength(1);
    expect(panel.merges[0]!.tasks.map((t) => t.key)).toEqual([other.key]);
    expect(panel.merges[0]!.canUndo).toBe(true);
    expect(Object.keys(panel.labels.comments)).toHaveLength(3);
    expect(Object.values(panel.labels.checklist)).toEqual([other.key]);
    expect(Object.keys(panel.labels.activity)).toHaveLength(1);
    // An old link: the merged task's id stands for the main task.
    expect(await merges.resolveMerged(other.id)).toMatchObject({ mainTaskId: main.id, key: other.key, mergedByName: 'Aisha Khan' });
    expect(await merges.resolveMerged(main.id)).toBeNull();
    const record = await merges.mergedRecord(result.mergeId, other.id);
    expect(record).toMatchObject({ key: other.key, title: 'Pump check', main: { id: main.id, key: main.key }, keptOnce: { checklist: 1, files: 1, contacts: 1 } });
  });

  it('data integrity: every table’s rows are the same before, after the merge and after Undo (apart from the merge’s own rows)', async () => {
    const a = await fullTask('Alpha', {}, 1);
    const b = await fullTask('Bravo', { assigneeIds: [mateId] }, 2);
    const c = await fullTask('Charlie', { assigneeIds: [employee.id] }, 3);
    const x = await newTask('Outside');
    await prisma.taskDependency.createMany({ data: [{ taskId: b.id, dependsOnTaskId: x.id }, { taskId: c.id, dependsOnTaskId: b.id }, { taskId: x.id, dependsOnTaskId: a.id }] });
    const ids = [a.id, b.id, c.id, x.id];
    // The search indexes are derived rows: built for these tasks first, read again after each step.
    const reindex = async () => {
      await taskIndex.refresh(ids);
      for (const id of ids) await generalIndex.taskFilesChanged(id);
    };
    await reindex();
    const start = await counts(ids);
    expect(start).toMatchObject({ followUps: 3, meetingNotes: 3, taskSearchRows: 4, fileSearchRows: 6 });
    const holdingsBefore = await Promise.all([a, b, c].map((t) => holdings(t.id)));

    const r = await merges.merge(manager, { taskIds: [a.id, b.id, c.id], mainTaskId: a.id });
    await reindex();
    const merged = await counts(ids);
    // Rows move, never copied or deleted: the only new ones are the merge's own — an alias per merged
    // task and its history lines (one on the main task, one on each merged one). The merged tasks leave
    // the task search index (derived: they are found as the main task now, by their old numbers too).
    expect(merged).toEqual({ ...start, activity: start.activity + 3, aliases: start.aliases + 2, taskSearchRows: start.taskSearchRows - 2 });
    // The main task now holds everything: one follow-up link (a task follows up at most one item), the notes, the files' search rows.
    expect(await prisma.meetingNote.count({ where: { taskId: a.id } })).toBe(3);
    expect(await prisma.searchIndex.count({ where: { kind: 'file', taskId: a.id } })).toBe(4);
    expect(await prisma.taskMergeItem.count({ where: { mergeId: r.mergeId } })).toBeGreaterThan(20);
    console.log('integrity: before', JSON.stringify(start), '\nafter merge', JSON.stringify(merged));

    await merges.undo(manager, r.mergeId);
    await reindex();
    const undone = await counts(ids);
    // Undo adds only its own history lines (one on the main task, one on each task given back).
    expect(undone).toEqual({ ...start, activity: start.activity + 3 + 3 });
    console.log('after undo', JSON.stringify(undone));
    const holdingsAfter = await Promise.all([a, b, c].map((t) => holdings(t.id)));
    expect(holdingsAfter).toEqual(holdingsBefore);
  });

  it('a failure part-way through changes nothing (one transaction)', async () => {
    const a = await fullTask('Alpha', {}, 1);
    const b = await fullTask('Bravo', { assigneeIds: [mateId] }, 2);
    const before = await Promise.all([holdings(a.id), holdings(b.id)]);
    const failing = prisma.$extends({
      query: {
        taskMergeItem: {
          // The very last write: everything before it must be rolled back.
          createMany() {
            throw new Error('disk full');
          },
        },
      },
    }) as unknown as PrismaClient;
    await expect(service(failing).merge(manager, { taskIds: [a.id, b.id], mainTaskId: a.id })).rejects.toThrow('disk full');
    expect(await Promise.all([holdings(a.id), holdings(b.id)])).toEqual(before);
    expect(await prisma.taskMerge.count({ where: { mainTaskId: a.id } })).toBe(0);
    expect(await prisma.activity.count({ where: { taskId: { in: [a.id, b.id] }, action: { in: ['TASKS_MERGED', 'MERGED_INTO'] } } })).toBe(0);

    // And Undo the same way: merged, then an undo that fails at its last step leaves it merged.
    const r = await merges.merge(manager, { taskIds: [a.id, b.id], mainTaskId: a.id });
    const merged = await Promise.all([holdings(a.id), holdings(b.id)]);
    const failingUndo = prisma.$extends({
      query: {
        taskMerge: {
          update() {
            throw new Error('lost the connection');
          },
        },
      },
    }) as unknown as PrismaClient;
    await expect(service(failingUndo).undo(manager, r.mergeId)).rejects.toThrow('lost the connection');
    expect(await Promise.all([holdings(a.id), holdings(b.id)])).toEqual(merged);
  });

  it('chooses where the tasks differ: another task’s project gives the main task a new number, its old one an alias', async () => {
    const main = await newTask('Rig pump', { dueDate: new Date('2026-11-03T00:00:00Z'), assigneeIds: [outsiderId, mateId] });
    const other = await newTask('Ops pump', { projectId: ops.id, columnId: ops.doing, dueDate: new Date('2026-11-09T00:00:00Z'), isMilestone: true });
    const preview = await merges.preview(manager, { taskIds: [main.id, other.id], choices: { project: other.id } });
    expect(preview.project).toMatchObject({ id: ops.id, changes: true, newKey: 'MGOPS-2' });
    expect(preview.outsiders).toEqual([{ id: outsiderId, name: 'Sara Al Balushi', canJoin: true, keys: [main.key] }]);
    // Sara isn't on the Operations team: the merge needs an answer for her.
    await expect(merges.merge(manager, { taskIds: [main.id, other.id], mainTaskId: main.id, choices: { project: other.id } })).rejects.toMatchObject({ code: 'ASSIGNEES_NOT_ON_TEAM' });
    const r = await merges.merge(manager, { taskIds: [main.id, other.id], mainTaskId: main.id, choices: { project: other.id, status: other.id, dueDate: other.id, milestone: other.id }, people: { [outsiderId]: 'LEAVE_OFF' } });
    expect(r.mainKey).toBe('MGOPS-2');
    const m = await holdings(main.id);
    expect(m.fields).toMatchObject({ key: 'MGOPS-2', projectId: ops.id, columnId: ops.doing, dueDate: new Date('2026-11-09T00:00:00Z'), isMilestone: true });
    expect(m.aliases).toEqual([main.key, other.key].sort());
    expect(m.assignees).toEqual([mateId]);
    const line = await prisma.activity.findFirstOrThrow({ where: { taskId: main.id, action: 'TASKS_MERGED' } });
    expect(line.meta).toMatchObject({ leftOff: ['Sara Al Balushi'], fromKey: main.key, toProject: 'Operations' });
    // Undo never moves the main task back; the confirmation says so.
    const undo = await merges.undoPreview(manager, r.mergeId);
    expect(undo.mainMoved).toEqual({ fromProject: 'Rig Inspection', toProject: 'Operations' });
    await merges.undo(manager, r.mergeId);
    const after = await holdings(main.id);
    expect(after.fields).toMatchObject({ key: 'MGOPS-2', projectId: ops.id });
    // The fields the merge changed and nobody changed since go back (the due date, the milestone).
    expect(after.fields.dueDate).toEqual(new Date('2026-11-03T00:00:00Z'));
    expect(after.fields.isMilestone).toBe(false);
    expect((await holdings(other.id)).fields).toMatchObject({ key: other.key, projectId: ops.id, mergedIntoId: null, deletedAt: null });
  });

  it('someone from outside can be added to the team instead', async () => {
    const main = await newTask('Ops pump', { projectId: ops.id, columnId: ops.todo });
    const other = await newTask('Rig pump', { assigneeIds: [outsiderId] });
    const r = await merges.merge(manager, { taskIds: [main.id, other.id], mainTaskId: main.id, people: { [outsiderId]: 'ADD_TO_TEAM' } });
    expect(r.addedToTeam).toEqual([{ id: outsiderId, name: 'Sara Al Balushi' }]);
    expect(await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: ops.id, userId: outsiderId } } })).not.toBeNull();
    expect((await holdings(main.id)).assignees).toEqual([outsiderId]);
  });

  it('repeats: only the chosen rule continues; Undo gives the main task its own rule back', async () => {
    const weekly = { freq: 'WEEKLY' as const, interval: 1, weekdays: [1] };
    const monthly = { freq: 'MONTHLY' as const, interval: 1, dayOfMonth: 5 };
    const main = await newTask('Weekly check', { recurrenceRule: weekly, dueDate: new Date('2026-11-02T00:00:00Z') });
    const other = await newTask('Monthly check', { recurrenceRule: monthly, dueDate: new Date('2026-11-05T00:00:00Z') });
    const preview = await merges.preview(manager, { taskIds: [main.id, other.id] });
    expect(preview.differences.find((d) => d.field === 'repeat')!.options.map((o) => o.value)).toEqual([main.id, other.id, 'none']);
    const r = await merges.merge(manager, { taskIds: [main.id, other.id], mainTaskId: main.id, choices: { repeat: other.id } });
    expect((await holdings(main.id)).fields.recurrenceRule).toEqual(monthly);
    // The other's series is stopped while merged: it is no longer a live repeating task.
    expect(await taskService.listTasks({ recurring: true, projectId: rig.id }).then((ts) => ts.map((t) => t.id))).toEqual([main.id]);
    await merges.undo(manager, r.mergeId);
    expect((await holdings(main.id)).fields.recurrenceRule).toEqual(weekly);
    expect((await holdings(other.id)).fields.recurrenceRule).toEqual(monthly);
    expect((await taskService.listTasks({ recurring: true, projectId: rig.id })).map((t) => t.id).sort()).toEqual([main.id, other.id].sort());
  });

  it('who may merge: administrators and the manager of every project involved; employees and half-managers refused', async () => {
    const a = await newTask('Rig one');
    const b = await newTask('Ops one', { projectId: ops.id, columnId: ops.todo });
    await expect(merges.merge(employee, { taskIds: [a.id, b.id], mainTaskId: a.id })).rejects.toMatchObject({ status: 403 });
    await expect(merges.merge(half, { taskIds: [a.id, b.id], mainTaskId: a.id })).rejects.toMatchObject({ status: 403, message: 'You need to manage Operations to merge its tasks.' });
    const p = await merges.preview(half, { taskIds: [a.id, b.id] });
    expect(p.canMerge).toBe(false);
    expect(p.tasks.find((t) => t.id === b.id)).toMatchObject({ canMerge: false, reason: 'You need to manage Operations to merge its tasks.' });
    // Hamed may merge two Rig tasks (he manages Rig); an administrator anything.
    const c = await newTask('Rig two');
    await expect(merges.merge(half, { taskIds: [a.id, c.id], mainTaskId: a.id })).resolves.toMatchObject({ mainTaskId: a.id });
    const d = await newTask('Rig three');
    await expect(merges.merge(admin, { taskIds: [d.id, b.id], mainTaskId: d.id })).resolves.toMatchObject({ mainTaskId: d.id });
    // Undo follows the same rule.
    const r = await prisma.taskMerge.findFirstOrThrow({ where: { mainTaskId: d.id } });
    await expect(merges.undo(half, r.id)).rejects.toMatchObject({ status: 403 });
    await expect(merges.undo(employee, r.id)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses tasks in the trash, already merged, in archived or completed projects; no chains', async () => {
    const a = await newTask('A');
    const b = await newTask('B');
    const trashed = await newTask('In the trash');
    await prisma.task.update({ where: { id: trashed.id }, data: { deletedAt: NOW } });
    const archivedTask = await newTask('Archived one', { projectId: arc.id, columnId: arc.todo });
    await prisma.project.update({ where: { id: arc.id }, data: { status: 'ARCHIVED' } });
    const completed = await newTask('Done project', { projectId: ops.id, columnId: ops.todo });
    await prisma.project.update({ where: { id: ops.id }, data: { status: 'COMPLETED' } });

    const p = await merges.preview(manager, { taskIds: [a.id, trashed.id, archivedTask.id, completed.id] });
    expect(p.tasks.map((t) => t.reason)).toEqual([null, 'It was deleted.', 'Old Works is archived.', 'Operations is completed.']);
    expect(p).toMatchObject({ canMerge: false, reason: 'Choose at least 2 tasks you can merge.' });
    await expect(merges.merge(manager, { taskIds: [a.id, trashed.id], mainTaskId: a.id })).rejects.toMatchObject({ code: 'CANT_MERGE' });
    await expect(merges.merge(manager, { taskIds: [a.id, archivedTask.id], mainTaskId: a.id })).rejects.toMatchObject({ code: 'CANT_MERGE' });

    await merges.merge(manager, { taskIds: [a.id, b.id], mainTaskId: a.id });
    const c = await newTask('C');
    // B is merged: it can't be chosen again.
    expect((await merges.preview(manager, { taskIds: [c.id, b.id] })).tasks[1]!.reason).toBe(`Already merged into ${a.key}.`);
    // A holds a merged task: it may be the main task of another merge, never merged away.
    await expect(merges.merge(manager, { taskIds: [c.id, a.id], mainTaskId: c.id })).rejects.toMatchObject({ code: 'CANT_MERGE' });
    const again = await merges.preview(manager, { taskIds: [c.id, a.id] });
    expect(again.mainTaskId).toBe(a.id);
    await expect(merges.merge(manager, { taskIds: [c.id, a.id], mainTaskId: a.id })).resolves.toMatchObject({ mainTaskId: a.id });
    expect((await merges.mergedFrom(manager, a.id)).merges).toHaveLength(2);
  });

  it('blocker links between the merged tasks are dropped; a loop is dropped and named', async () => {
    const main = await newTask('Main');
    const other = await newTask('Other');
    const x = await newTask('X');
    // Main is blocked by X; X is blocked by Other → after the merge X would block Main and Main X: a loop.
    await prisma.taskDependency.createMany({ data: [{ taskId: main.id, dependsOnTaskId: x.id }, { taskId: x.id, dependsOnTaskId: other.id }, { taskId: other.id, dependsOnTaskId: main.id }] });
    const p = await merges.preview(manager, { taskIds: [main.id, other.id] });
    expect(p.droppedLinks).toEqual(
      expect.arrayContaining([
        { key: other.key, otherKey: 'MGRIG-3', otherTitle: 'X', reason: 'loop' },
        { key: other.key, otherKey: main.key, otherTitle: 'Main', reason: 'between' },
      ]),
    );
    await merges.merge(manager, { taskIds: [main.id, other.id], mainTaskId: main.id });
    expect((await holdings(main.id)).blockedBy).toEqual([x.id]);
    // The dropped loop stays on the merged record (back on Undo), never shown as live.
    expect(await prisma.taskDependency.count({ where: { taskId: x.id, dependsOnTaskId: other.id } })).toBe(1);
  });

  it('Undo gives back what is still there, lists what was deleted since, and keeps later additions on the main task', async () => {
    const main = await fullTask('Main', {}, 1);
    const other = await fullTask('Other', { assigneeIds: [mateId] }, 2);
    const r = await merges.merge(manager, { taskIds: [main.id, other.id], mainTaskId: main.id, choices: { title: other.id } });
    // After the merge: a file and a checklist item that came from Other are deleted; a comment is added to the main task; the title is edited.
    const moved = await prisma.taskMergeItem.findMany({ where: { mergeId: r.mergeId, kind: { in: ['attachment', 'checklist'] } } });
    await prisma.attachment.delete({ where: { id: moved.find((i) => i.kind === 'attachment')!.rowId } });
    await prisma.checklistItem.delete({ where: { id: moved.find((i) => i.kind === 'checklist')!.rowId } });
    const later = await prisma.comment.create({ data: { taskId: main.id, userId: manager.id, body: 'Added after the merge' } });
    await prisma.task.update({ where: { id: main.id }, data: { title: 'Renamed since' } });
    // An assignee who came with Other is taken off the main task since: Other still gets them back.
    await prisma.taskAssignee.deleteMany({ where: { taskId: main.id, userId: mateId } });

    const preview = await merges.undoPreview(manager, r.mergeId);
    expect(preview.canUndo).toBe(true);
    expect(preview.deletedSince).toEqual([`1 file and 1 checklist item from ${other.key} were deleted after the merge.`]);
    const done = await merges.undo(manager, r.mergeId);
    expect(done.text).toBe(`Undid the merge: ${other.key} is a separate task again`);
    const m = await holdings(main.id);
    const o = await holdings(other.id);
    expect(m.comments).toContain(later.id);
    expect(m.fields.title).toBe('Renamed since'); // changed since: it stays
    expect(m.fields.description).toBeNull();
    expect(o.comments).toHaveLength(3);
    expect(o.attachments).toHaveLength(1); // the report kept once stayed with it; its picture was deleted since
    expect(o.assignees).toEqual([mateId]);
    expect(o.fields).toMatchObject({ mergedIntoId: null, deletedAt: null, title: 'Other' });
    expect(o.aliases).toEqual([]);
    expect(m.aliases).toEqual([]);
    expect(await merges.resolveMerged(other.id)).toBeNull();
    // Not twice.
    await expect(merges.undo(manager, r.mergeId)).rejects.toMatchObject({ code: 'MERGE_UNDONE' });
    expect((await merges.mergedFrom(manager, main.id)).merges).toEqual([]);
  });

  it('Undo is refused when a task involved is in an archived project now, or the main task was deleted', async () => {
    const a = await newTask('A');
    const b = await newTask('B', { projectId: arc.id, columnId: arc.todo });
    const r = await merges.merge(manager, { taskIds: [a.id, b.id], mainTaskId: a.id });
    await prisma.project.update({ where: { id: arc.id }, data: { status: 'ARCHIVED' } });
    expect(await merges.undoPreview(manager, r.mergeId)).toMatchObject({ canUndo: false, reason: 'Old Works is archived now — reopen it first.' });
    await expect(merges.undo(manager, r.mergeId)).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    await prisma.project.update({ where: { id: arc.id }, data: { status: 'ACTIVE' } });
    await prisma.task.update({ where: { id: a.id }, data: { deletedAt: NOW } });
    await expect(merges.undo(manager, r.mergeId)).rejects.toMatchObject({ code: 'CANT_UNDO', message: `${a.key} was deleted, so the merge can’t be undone.` });
  });

  it('a task that changed since the dialog showed it is refused', async () => {
    const a = await newTask('A');
    const b = await newTask('B');
    await expect(merges.merge(manager, { taskIds: [a.id, b.id], mainTaskId: a.id, versions: { [a.id]: a.version, [b.id]: b.version + 1 } })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});
