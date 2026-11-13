import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { createPrismaTaskRepository, createPrismaProjectLookup } from '../../src/modules/tasks/prisma-task-repository';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createTaskMergeService, type MergeActor } from '../../src/modules/task-merge/merge-service';
import { runBackfill } from './company-helpers';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createSearchIndex } from '../../src/modules/search/search-index';
import { createTaskSearchEngine } from '../../src/modules/search/task-search-engine';
import { databaseProbes } from '../../src/modules/error-log/database-probes';
import { portabilityProblems } from '../../src/lib/sql-portability';

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
    // 1.23.3: its checklists, with their own titles and places (Undo gives them back as they were).
    lists: (await prisma.checklistList.findMany({ where: { taskId }, select: { id: true, title: true, position: true }, orderBy: { id: 'asc' } })),
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
  // 1.23.3: items live in a checklist (a site's own items were put in one titled "Checklist").
  const list = await prisma.checklistList.create({ data: { taskId: t.id, title: 'Checklist', position: 0 } });
  await prisma.checklistItem.create({ data: { taskId: t.id, listId: list.id, text: `${title}: step`, position: 0 } });
  await prisma.checklistItem.create({ data: { taskId: t.id, listId: list.id, text: 'Fire exits', done: true, position: 1 } });
  await prisma.activity.create({ data: { taskId: t.id, projectId: t.projectId, userId: manager.id, action: 'CREATED', meta: { title } } });
  const storageKey = `${t.id}.pdf`;
  files.set(storageKey, Buffer.from('the same report'));
  await prisma.attachment.create({ data: { taskId: t.id, uploadedById: manager.id, filename: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 15, storageKey, url: `/uploads/${storageKey}` } });
  await prisma.attachment.create({ data: { taskId: t.id, uploadedById: manager.id, filename: `${title}.png`, mimeType: 'image/png', sizeBytes: 9, storageKey: `${t.id}-own.png`, url: `/uploads/${t.id}-own.png` } });
  await prisma.taskExternalContact.create({ data: { taskId: t.id, name: 'Ahmed', email: 'ahmed@acme.test', ...(n === 1 ? {} : { company: 'Acme', phone: '+968 9123 4567' }), position: 0 } });
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
    // 1.23.3: a checklist moves whole, so none of its items is a duplicate kept once.
    expect(preview.duplicates).toMatchObject({ checklist: 0, files: 1, contacts: 1, assignees: 1, watchers: 1, tags: 1 });
    expect(preview.duplicatesText).toBe('1 file, 1 contact, 1 person, 1 watcher and 1 tag appear in more than one task — kept once.');
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
    expect(m.checklist).toHaveLength(4);
    expect(o.checklist).toEqual([]);
    // 1.23.3 (design): the other task's checklist moved whole, after the main task's, titled by where it came from.
    expect((await prisma.checklistList.findMany({ where: { taskId: main.id }, orderBy: { position: 'asc' } })).map((l) => l.title)).toEqual(['Checklist', `From ${other.key} · Checklist`]);
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
    const ahmed = m.contacts.find((c) => c.email === 'ahmed@acme.test')!;
    expect(ahmed).toMatchObject({ company: 'Acme', phone: '+968 9123 4567' });
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
    expect(Object.values(panel.labels.checklist)).toEqual([other.key, other.key]);
    expect(Object.keys(panel.labels.activity)).toHaveLength(1);
    // An old link: the merged task's id stands for the main task.
    expect(await merges.resolveMerged(other.id)).toMatchObject({ mainTaskId: main.id, key: other.key, mergedByName: 'Aisha Khan' });
    expect(await merges.resolveMerged(main.id)).toBeNull();
    const record = await merges.mergedRecord(result.mergeId, other.id);
    expect(record).toMatchObject({ key: other.key, title: 'Pump check', main: { id: main.id, key: main.key }, keptOnce: { checklist: 0, files: 1, contacts: 1 } });
  });

  // Release B (owner, 12 Nov): the merged tasks' planned time (Calendar work blocks) and personal reminders MOVE to the
  // main task; the same person's block or reminder at the same time is kept once (the other stays on its merged task);
  // Undo puts every one back where it was.
  it('planned time and personal reminders move to the main task — the same person at the same time kept once — and Undo puts them back', async () => {
    const a = await newTask('Main with plans');
    const b = await newTask('Other with plans');
    const c = await newTask('Third with plans');
    const hour = (h: number) => ({ startAt: new Date(`2026-11-10T${String(h).padStart(2, '0')}:00:00.000Z`), endAt: new Date(`2026-11-10T${String(h + 1).padStart(2, '0')}:00:00.000Z`) });
    const block = async (taskId: string, userId: string, h: number) => (await prisma.taskWorkBlock.create({ data: { taskId, userId, plannedById: manager.id, ...hour(h) } })).id;
    const remind = async (taskId: string, userId: string, timing: { at?: Date; anchor?: string; offsetMinutes?: number }) => (await prisma.taskReminder.create({ data: { taskId, userId, setById: userId, ...timing } })).id;
    const B = {
      onMain: await block(a.id, employee.id, 5),
      sameAsMain: await block(b.id, employee.id, 5), // the same person and time as the main task's: kept once
      moves: await block(b.id, employee.id, 7),
      otherPerson: await block(c.id, mateId, 5), // the same time, someone else: moves
      sameAmongMerged: await block(c.id, employee.id, 7), // the same as the one moving from b: kept once
    };
    const R = {
      onMain: await remind(a.id, employee.id, { anchor: 'due', offsetMinutes: 60 }),
      sameAsMain: await remind(b.id, employee.id, { anchor: 'due', offsetMinutes: 60 }),
      atTime: await remind(b.id, employee.id, { at: new Date('2026-11-09T05:00:00.000Z') }),
      otherPerson: await remind(c.id, mateId, { anchor: 'due', offsetMinutes: 60 }),
      otherOffset: await remind(c.id, employee.id, { anchor: 'due', offsetMinutes: 120 }),
    };
    const where = async () => ({
      blocks: Object.fromEntries((await prisma.taskWorkBlock.findMany({ where: { id: { in: Object.values(B) } }, select: { id: true, taskId: true } })).map((x) => [x.id, x.taskId])),
      reminders: Object.fromEntries((await prisma.taskReminder.findMany({ where: { id: { in: Object.values(R) } }, select: { id: true, taskId: true } })).map((x) => [x.id, x.taskId])),
    });
    const before = await where();

    const r = await merges.merge(manager, { taskIds: [a.id, b.id, c.id], mainTaskId: a.id });
    const after = await where();
    expect(after.blocks).toEqual({ [B.onMain]: a.id, [B.sameAsMain]: b.id, [B.moves]: a.id, [B.otherPerson]: a.id, [B.sameAmongMerged]: c.id });
    expect(after.reminders).toEqual({ [R.onMain]: a.id, [R.sameAsMain]: b.id, [R.atTime]: a.id, [R.otherPerson]: a.id, [R.otherOffset]: a.id });
    // Nothing is copied or deleted.
    expect(await prisma.taskWorkBlock.count({ where: { id: { in: Object.values(B) } } })).toBe(5);
    expect(await prisma.taskReminder.count({ where: { id: { in: Object.values(R) } } })).toBe(5);

    await merges.undo(manager, r.mergeId);
    expect(await where()).toEqual(before);
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

  // 1.23.7 (security review): "Show to client" on a file belongs to its project's Client portal. A file that
  // leaves its project — at the merge, or back again at Undo — never stays shown to the other project's clients.
  it('a file shown to clients loses the tick when a merge or its Undo takes it to another project', async () => {
    const main = await newTask('Rig valve');
    const other = await newTask('Ops valve', { projectId: ops.id, columnId: ops.doing });
    const file = (taskId: string, name: string) => prisma.attachment.create({ data: { taskId, uploadedById: manager.id, filename: name, mimeType: 'application/pdf', sizeBytes: 5, storageKey: `${name}-${taskId}`, url: `/uploads/${name}-${taskId}`, clientVisible: true } });
    const own = await file(main.id, 'rig-own.pdf');
    const moving = await file(other.id, 'ops-file.pdf');
    const r = await merges.merge(manager, { taskIds: [main.id, other.id], mainTaskId: main.id });
    const shown = async (id: string) => (await prisma.attachment.findUniqueOrThrow({ where: { id } })).clientVisible;
    expect(await shown(own.id)).toBe(true); // stayed in its project
    expect(await shown(moving.id)).toBe(false); // left Operations for Rig
    // Rig's manager shows it to Rig's clients; Undo takes it back to Operations: not shown there.
    await prisma.attachment.update({ where: { id: moving.id }, data: { clientVisible: true } });
    await merges.undo(manager, r.mergeId);
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: moving.id } })).toMatchObject({ taskId: other.id, clientVisible: false });
    expect(await shown(own.id)).toBe(true);
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

  it('1.23.3: Undo gives an item back to its task even when it was moved into the main task’s own checklist since', async () => {
    const main = await fullTask('Keeper', {}, 1);
    const other = await fullTask('Mover', {}, 2);
    const r = await merges.merge(manager, { taskIds: [main.id, other.id], mainTaskId: main.id });
    const own = await prisma.checklistList.findFirstOrThrow({ where: { taskId: main.id, title: 'Checklist' } });
    const moved = await prisma.checklistItem.findFirstOrThrow({ where: { taskId: main.id, text: 'Mover: step' } });
    await prisma.checklistItem.update({ where: { id: moved.id }, data: { listId: own.id } });
    await merges.undo(manager, r.mergeId);
    const back = await prisma.checklistItem.findUniqueOrThrow({ where: { id: moved.id } });
    expect(back.taskId).toBe(other.id);
    // Not left pointing at the main task's checklist: back in its own task's first one.
    const mine = await prisma.checklistList.findFirstOrThrow({ where: { taskId: other.id, deletedAt: null } });
    expect(back.listId).toBe(mine.id);
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

// ---- Review round (1.23.1): the reviewer's Important findings, each first as a failing test. ----
describe('Merging tasks — review round (integration)', () => {
  it('two Undos at once: one undoes, the other is refused; the history says it once', async () => {
    const a = await fullTask('Alpha', {}, 1);
    const b = await fullTask('Bravo', {}, 2);
    const r = await merges.merge(manager, { taskIds: [a.id, b.id], mainTaskId: a.id });
    const [one, two] = await Promise.allSettled([merges.undo(manager, r.mergeId), merges.undo(manager, r.mergeId)]);
    const statuses = [one, two].map((x) => x.status).sort();
    expect(statuses).toEqual(['fulfilled', 'rejected']);
    const refused = [one, two].find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: 'MERGE_UNDONE' });
    expect(await prisma.activity.count({ where: { taskId: { in: [a.id, b.id] }, action: 'MERGE_UNDONE' } })).toBe(2);
  });

  it('Undo keeps the main task’s status whole: a merge that moved it into another project’s Done column leaves it done', async () => {
    const main = await newTask('Rig pump', { columnId: rig.doing });
    const other = await newTask('Ops pump', { projectId: ops.id, columnId: ops.done });
    await prisma.task.update({ where: { id: other.id }, data: { completedAt: new Date('2026-11-04T08:00:00Z') } });
    const r = await merges.merge(manager, { taskIds: [main.id, other.id], mainTaskId: main.id, choices: { project: other.id, status: other.id } });
    expect((await holdings(main.id)).fields).toMatchObject({ columnId: ops.done });
    await merges.undo(manager, r.mergeId);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: main.id }, select: { columnId: true, completedAt: true, progress: true } });
    // It stays in Operations (Undo never moves it back), and stays done there — never in Done but open.
    expect(after.columnId).toBe(ops.done);
    expect(after.completedAt).not.toBeNull();
    expect(after.progress).toBe(100);
  });

  it('a write that arrives just after the merge (a slow upload, a comment) is moved to the main task, and back on Undo', async () => {
    const a = await newTask('Alpha');
    const b = await newTask('Bravo');
    const r = await merges.merge(manager, { taskIds: [a.id, b.id], mainTaskId: a.id });
    const late = new Date(NOW.getTime() + 5_000);
    const comment = await prisma.comment.create({ data: { taskId: b.id, userId: manager.id, body: 'Posted as the merge finished', createdAt: late } });
    const file = await prisma.attachment.create({ data: { taskId: b.id, uploadedById: manager.id, filename: 'slow.pdf', mimeType: 'application/pdf', sizeBytes: 5, storageKey: 'slow.pdf', url: '/uploads/slow.pdf', createdAt: late } });
    const item = await prisma.checklistItem.create({ data: { taskId: b.id, text: 'Late step', createdAt: late } });
    const line = await prisma.activity.create({ data: { taskId: b.id, projectId: rig.id, userId: manager.id, action: 'COMMENTED', createdAt: late } });
    // Opening the main task's "Merged from" panel gathers them (the merge itself tries again after it is saved).
    await merges.mergedFrom(manager, a.id);
    expect(await prisma.comment.findUniqueOrThrow({ where: { id: comment.id } })).toMatchObject({ taskId: a.id });
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ taskId: a.id });
    expect(await prisma.checklistItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ taskId: a.id });
    expect(await prisma.activity.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ taskId: a.id });
    await merges.undo(manager, r.mergeId);
    expect(await prisma.comment.findUniqueOrThrow({ where: { id: comment.id } })).toMatchObject({ taskId: b.id });
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ taskId: b.id });
  });

  it('the preview never names a blocker the person can’t open, nor counts it', async () => {
    const main = await newTask('Main');
    const other = await newTask('Other');
    const hidden = await newTask('Pay rises', { projectId: arc.id, columnId: arc.todo });
    // Main blocked by the hidden task; the hidden task blocked by Other → a loop through a task they can't open.
    await prisma.taskDependency.createMany({ data: [{ taskId: main.id, dependsOnTaskId: hidden.id }, { taskId: hidden.id, dependsOnTaskId: other.id }] });
    const seeing = createTaskMergeService({ prisma, timeZone: TZ, now: () => NOW, canViewTask: async (_u, _r, id) => id !== hidden.id });
    const p = await seeing.preview(manager, { taskIds: [main.id, other.id] });
    expect(p.droppedLinks).toEqual([{ key: other.key, otherKey: '', otherTitle: '', reason: 'loop' }]);
    expect(p.tasks.map((t) => t.counts.blockers)).toEqual([0, 0]);
  });

  it('Show to client: another project’s switch doesn’t follow a project change; joined descriptions stop showing to the client', async () => {
    const main = await newTask('Rig pump', { description: 'Main' });
    await prisma.task.update({ where: { id: main.id }, data: { clientVisible: true, clientShowDescription: true } });
    const other = await newTask('Ops pump', { projectId: ops.id, columnId: ops.todo, description: 'Private notes' });
    const p = await merges.preview(manager, { taskIds: [main.id, other.id] });
    expect(p.clientDescriptionOff).toBe(true);
    await merges.merge(manager, { taskIds: [main.id, other.id], mainTaskId: main.id });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: main.id }, select: { clientVisible: true, clientShowDescription: true } })).toEqual({ clientVisible: true, clientShowDescription: false });

    const a = await newTask('Rig valve');
    await prisma.task.update({ where: { id: a.id }, data: { clientVisible: true } });
    const b = await newTask('Ops valve', { projectId: ops.id, columnId: ops.todo });
    await merges.merge(manager, { taskIds: [a.id, b.id], mainTaskId: a.id, choices: { project: b.id } });
    // Rig's client page asked for it, not Operations': it leaves the client page, as with Move.
    expect(await prisma.task.findUniqueOrThrow({ where: { id: a.id }, select: { clientVisible: true, projectId: true } })).toEqual({ clientVisible: false, projectId: ops.id });
  });

  it('repeats: the rule taken from another task leaves it; if the main task’s series went on, Undo doesn’t start a second series on it', async () => {
    const monthly = { freq: 'MONTHLY' as const, interval: 1, dayOfMonth: 5 };
    const main = await newTask('Pump check');
    const other = await newTask('Monthly check', { recurrenceRule: monthly });
    const r = await merges.merge(manager, { taskIds: [main.id, other.id], mainTaskId: main.id, choices: { repeat: other.id } });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: other.id } })).recurrenceRule).toBeNull();
    // The main task's series goes on: its next copy carries the rule now (as completing it does).
    await prisma.task.update({ where: { id: main.id }, data: { recurrenceRule: Prisma.DbNull } });
    await prisma.task.create({ data: { key: 'MGRIG-90', title: 'Pump check', projectId: rig.id, columnId: rig.todo, createdById: manager.id, recurrenceParentId: main.id, recurrenceSourceId: main.id, recurrenceRule: monthly } });
    const ask = await merges.undoPreview(manager, r.mergeId);
    expect(ask.deletedSince).toContain(`${other.key} doesn’t repeat any more: its repeat went on with ${main.key}’s series.`);
    await merges.undo(manager, r.mergeId);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: other.id } })).recurrenceRule).toBeNull();
  });

  it('approvals: a waiting main task keeps waiting when the merge moves it; "doesn’t need approval" for a waiting task completes it', async () => {
    const review = await prisma.kanbanColumn.create({ data: { projectId: ops.id, name: 'Review', category: 'REVIEW', position: 3 } });
    const rigReview = await prisma.kanbanColumn.create({ data: { projectId: rig.id, name: 'Check', category: 'REVIEW', position: 3 } });
    const main = await newTask('Waiting one', { columnId: rigReview.id, needsApproval: true });
    await prisma.task.update({ where: { id: main.id }, data: { approvalRequestedAt: NOW, approvalRequestedById: mateId } });
    const other = await newTask('Ops one', { projectId: ops.id, columnId: ops.todo, needsApproval: true });
    const changed: string[] = [];
    const tracked = createTaskMergeService({ prisma, timeZone: TZ, now: () => NOW, onStatusChanged: async (taskId, prev) => void changed.push(`${taskId}:${prev}`) });
    await tracked.merge(manager, { taskIds: [main.id, other.id], mainTaskId: main.id, choices: { project: other.id } });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: main.id }, select: { columnId: true, approvalRequestedAt: true, completedAt: true } })).toEqual({ columnId: review.id, approvalRequestedAt: NOW, completedAt: null });
    // The column changed: what a status change does (its history line, a repeat's next copy) follows.
    expect(changed).toEqual([`${main.id}:${rigReview.id}`]);

    const w = await newTask('Waiting two', { columnId: rigReview.id, needsApproval: true });
    await prisma.task.update({ where: { id: w.id }, data: { approvalRequestedAt: NOW, approvalRequestedById: mateId } });
    const plain = await newTask('Plain one');
    await merges.merge(manager, { taskIds: [w.id, plain.id], mainTaskId: w.id, choices: { needsApproval: plain.id } });
    const done = await prisma.task.findUniqueOrThrow({ where: { id: w.id }, select: { columnId: true, approvalRequestedAt: true, completedAt: true, needsApproval: true } });
    expect(done).toMatchObject({ columnId: rig.done, approvalRequestedAt: null, needsApproval: false });
    expect(done.completedAt).not.toBeNull();
  });
});

// ---- 1.23.2: MariaDB (the live server is almost certainly MariaDB, not MySQL 8) ----
describe('Merging tasks on MariaDB as well as MySQL 8 (integration)', () => {
  it('every statement a merge, its preview, the panel, late writes and Undo send is portable', async () => {
    const sent: string[] = [];
    const client = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } }, log: [{ emit: 'event', level: 'query' }] });
    client.$on('query', (e) => void sent.push(e.query));
    try {
      const logged = createTaskMergeService({ prisma: client, timeZone: TZ, now: () => NOW, readFile: async (k) => files.get(k) ?? null, canViewTask: async () => true });
      const a = await fullTask('Alpha', {}, 1);
      const b = await fullTask('Bravo', { assigneeIds: [mateId], recurrenceRule: { freq: 'WEEKLY', interval: 1 } }, 2);
      const c = await newTask('Charlie', { projectId: ops.id, columnId: ops.done });
      await prisma.taskDependency.create({ data: { taskId: b.id, dependsOnTaskId: c.id } });
      await logged.preview(manager, { taskIds: [a.id, b.id, c.id], choices: { project: c.id } });
      const r = await logged.merge(manager, { taskIds: [a.id, b.id, c.id], mainTaskId: a.id, choices: { project: c.id, status: c.id, repeat: b.id }, people: { [outsiderId]: 'LEAVE_OFF' } });
      await prisma.comment.create({ data: { taskId: b.id, userId: manager.id, body: 'late' } });
      await logged.mergedFrom(manager, a.id);
      await logged.mergedRecord(r.mergeId, b.id);
      await logged.resolveMerged(b.id);
      await logged.undoPreview(manager, r.mergeId);
      await logged.undo(manager, r.mergeId);
      await logged.selfCheck();
      expect(sent.length).toBeGreaterThan(100);
      // Constant sort terms, LIMIT in IN (…), RETURNING / ->> / JSON_ / window functions / CTEs / SKIP
      // LOCKED / NOWAIT, isolation statements, multi-table UPDATE/DELETE with ORDER BY/LIMIT (lib/sql-portability).
      const problems = sent.flatMap((sql) => portabilityProblems(sql).map((p) => `${p}: ${sql}`));
      expect(problems).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  });

  it('the start-up database check runs the merge’s own SQL once, harmlessly', async () => {
    const before = { merges: await prisma.taskMerge.count(), items: await prisma.taskMergeItem.count(), tasks: await prisma.task.count() };
    const probes = databaseProbes({ prisma, taskSearch: createTaskSearchEngine({ prisma, timeZone: TZ }), timeZone: TZ, taskMerge: merges });
    const probe = probes.find((p) => p.name === 'merging tasks (locks, late writes, undo)');
    expect(probe).toBeDefined();
    await expect(probe!.run()).resolves.not.toThrow();
    expect({ merges: await prisma.taskMerge.count(), items: await prisma.taskMergeItem.count(), tasks: await prisma.task.count() }).toEqual(before);
  });
});
