import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { createAssigneeService } from '../../src/modules/tasks/assignee-service';
import { createPrismaAssigneeRepository, createPrismaTaskLookup } from '../../src/modules/tasks/prisma-assignee-repository';
import { createAttachmentService } from '../../src/modules/tasks/attachment-service';
import { createPrismaAttachmentRepository } from '../../src/modules/tasks/prisma-attachment-repository';
import type { AttachmentStorage } from '../../src/modules/tasks/attachment-repository';
import { createTaskDuplicateService } from '../../src/modules/tasks/task-duplicate';
import { createPrismaTaskDuplicateSource } from '../../src/modules/tasks/prisma-task-duplicate-source';
import type { ProjectAccess } from '../../src/modules/projects/project-access';
import type { ActivityService } from '../../src/modules/activity/activity-service';
import type { TaskService } from '../../src/modules/tasks/task-service';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Duplicate Task over the real database, through the real routes (buildApp) as server.ts wires them.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

/** Files kept in memory (the stored bytes the copy reads back). */
const stored = new Map<string, Buffer>();
let seq = 0;
const storage: AttachmentStorage = {
  async save(file) {
    const storageKey = `mem/${++seq}-${file.filename}`;
    stored.set(storageKey, file.content);
    return { storageKey, url: `/uploads/${storageKey}`, sizeBytes: file.content.length };
  },
  async remove(key) {
    stored.delete(key);
  },
  async read(key) {
    const b = stored.get(key);
    if (!b) throw new Error('missing');
    return b;
  },
};

let w: CompanyWorld;
let api: CompanyApp;
let todoPA = '';
let donePA = '';
let todoPB = '';

type Json = Record<string, unknown>;
const data = (res: { json(): unknown }) => (res.json() as { data: Json }).data;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  todoPA = (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: w.projects.PA } })).id;
  todoPB = (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: w.projects.PB } })).id;
  donePA = (await prisma.kanbanColumn.create({ data: { projectId: w.projects.PA, name: 'Done', category: 'DONE', position: 5 } })).id;
  // A form, and the original TA2 (PA; cat's) with everything a copy carries and everything it doesn't.
  const form = await prisma.inspectionForm.create({ data: { title: `Rig check ${w.tag}`, sections: [], createdById: w.people.admin } });
  await prisma.task.update({
    where: { id: w.tasks.TA2 },
    data: {
      priority: 'HIGH',
      startDate: new Date('2026-11-03T05:00:00Z'),
      dueDate: new Date('2026-11-20T00:00:00Z'),
      estimatedHours: 6,
      isMilestone: true,
      weight: 3,
      inspectionFormId: form.id,
      inspectionPlace: 'Rig 3',
      // Never copied:
      columnId: donePA,
      completedAt: new Date('2026-11-05T08:00:00Z'),
      progress: 100,
      needsApproval: true,
      approvedAt: new Date('2026-11-05T08:00:00Z'),
      approvedById: w.people.admin,
      recurrenceRule: { freq: 'WEEKLY', interval: 1 },
      meetingId: w.meetings.MA,
      clientVisible: true,
      tags: { create: [{ tag: { connectOrCreate: { where: { name: `dup-safety-${w.tag}` }, create: { name: `dup-safety-${w.tag}`, color: '#123456' } } } }] },
      assignees: { create: [{ userId: w.people.ana }] },
      watchers: { create: [{ userId: w.people.ana }, { userId: w.people.cat }] },
      externalContacts: { create: [{ name: 'Ahmed Al Said', company: 'OXY', position: 0, createdById: w.people.cat }] },
    },
  });
  // Nested checklists: ticked, assigned and dated items — the copy gets them unticked, with no people or dates.
  const list = await prisma.checklistList.create({ data: { taskId: w.tasks.TA2, title: 'Before', position: 0, createdById: w.people.cat } });
  const parent = await prisma.checklistItem.create({ data: { taskId: w.tasks.TA2, listId: list.id, text: 'Valves', position: 0, done: true, assigneeId: w.people.ana, dueDate: new Date('2026-11-10T00:00:00Z') } });
  await prisma.checklistItem.create({ data: { taskId: w.tasks.TA2, listId: list.id, parentId: parent.id, text: 'Main valve', position: 0, done: true } });
  await prisma.checklistItem.create({ data: { taskId: w.tasks.TA2, listId: list.id, text: 'Gauges', position: 1 } });
  // Files: a PDF and a picture, and a drawing of a type this server doesn't take any more.
  const file = async (filename: string, mimeType: string, content: string) => {
    const { storageKey, url, sizeBytes } = await storage.save({ filename, mimeType, content: Buffer.from(content) });
    await prisma.attachment.create({ data: { taskId: w.tasks.TA2, uploadedById: w.people.cat, filename, mimeType, sizeBytes, storageKey, url } });
  };
  await file('plan.txt', 'text/plain', 'the plan');
  await file('site.dwg', 'application/acad', 'AC1027 drawing');
  await file('notes.txt', 'text/plain', 'notes');

  api = await buildCompanyApp(prisma, (base) => {
    const projectAccess = base.projectAccess as ProjectAccess;
    const activity = base.activityService as ActivityService;
    const taskLookup = createPrismaTaskLookup(prisma);
    const assigneeService = createAssigneeService({ repo: createPrismaAssigneeRepository(prisma), taskLookup });
    const attachmentService = createAttachmentService({ repo: createPrismaAttachmentRepository(prisma), storage, taskLookup, maxSizeBytes: 1_000_000, allowedMimeTypes: ['text/plain', 'application/pdf', 'image/png'] });
    const source = createPrismaTaskDuplicateSource(prisma);
    return {
      assigneeService,
      attachmentService,
      duplicateLinks: (id) => source.links(id),
      taskDuplicateService: createTaskDuplicateService({
        ...source,
        canViewTask: (actor, id) => projectAccess.canViewTask(actor.id, actor.roles, id),
        readFile: async (key) => storage.read!(key).catch(() => null),
        uploadFile: (taskId, by, f) => attachmentService.upload(taskId, by, f),
        recordActivity: async ({ taskId, userId, action, meta }) => {
          const t = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
          await activity.record({ taskId, projectId: t?.projectId ?? null, userId, action, meta });
        },
        pipeline: { taskService: base.taskService as TaskService, scopeOf: (a) => projectAccess.accessibleProjectIds(a.id, a.roles), assigneeService },
        timeZone: 'Asia/Muscat',
      }),
    };
  });
});

afterAll(async () => {
  await api?.close();
  if (w) {
    await prisma.inspectionForm.deleteMany({ where: { title: `Rig check ${w.tag}` } });
    await dropCompanyWorld(prisma, w);
    await prisma.tag.deleteMany({ where: { name: { contains: w.tag } } });
  }
  await prisma.$disconnect();
});

describe('Duplicate Task on MySQL', () => {
  let copyId = '';
  let copyKey = '';
  let secondKey = '';

  it('the review form is filled in from the original — for someone who can open it', async () => {
    const res = await api.getRaw(w.as.cat, `/tasks/${w.tasks.TA2}/duplicate`);
    expect(res.statusCode).toBe(200);
    const p = (res.json() as { data: Json }).data as { original: Json; task: Json; watchers: Json[]; files: Json[] };
    expect(p.original).toMatchObject({ id: w.tasks.TA2, key: `TA2${w.tag.toUpperCase()}-1` });
    expect(p.task).toMatchObject({ projectId: w.projects.PA, columnId: todoPA, priority: 'HIGH', startDate: '2026-11-03', dueDate: '2026-11-20', isMilestone: true, weight: 3, estimatedHours: 6, inspectionPlace: 'Rig 3' });
    expect([...(p.task.assigneeIds as string[])].sort()).toEqual([w.people.ana, w.people.cat].sort());
    expect(p.task.checklists).toEqual([{ title: 'Before', items: [{ text: 'Valves', children: [{ text: 'Main valve' }] }, { text: 'Gauges' }] }]);
    expect(p.files.map((f) => f.filename)).toEqual(['plan.txt', 'site.dwg', 'notes.txt']);
    expect((await api.getRaw(w.as.ben, `/tasks/${w.tasks.TA2}/duplicate`)).statusCode).toBe(404);
  });

  it('makes the copy in another project: a new unique number, the reference, unticked nested checklists, the files with one refused', async () => {
    const res = await api.post(w.as.cat, `/tasks/${w.tasks.TA2}/duplicate`, {
      title: `TA2 ZZALPHA task`,
      projectId: w.projects.PB,
      priority: 'HIGH',
      dueDate: '2026-11-20',
      startDate: '2026-11-03',
      isMilestone: true,
      weight: 3,
      assigneeIds: [w.people.cat],
      checklists: [{ title: 'Before', items: [{ text: 'Valves', children: [{ text: 'Main valve' }] }, { text: 'Gauges' }] }],
      externalContacts: [{ name: 'Ahmed Al Said', company: 'OXY' }],
      copyFiles: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: Json; files: Json };
    copyId = body.data.id as string;
    copyKey = body.data.key as string;
    // A new number of its project, as any new task's.
    expect(copyKey).toMatch(new RegExp(`^PB${w.tag.toUpperCase()}-[0-9]+$`));
    expect(await prisma.task.count({ where: { key: copyKey } })).toBe(1);
    expect(body.files).toEqual({ total: 3, copied: 2, failed: [{ filename: 'site.dwg', reason: expect.stringContaining('can’t be attached') }] });

    const copy = await prisma.task.findUniqueOrThrow({
      where: { id: copyId },
      include: { checklist: { orderBy: { position: 'asc' } }, checklistLists: true, tags: { include: { tag: true } }, attachments: true, watchers: true, comments: true, externalContacts: true, assignees: true },
    });
    expect(copy).toMatchObject({ duplicatedFromId: w.tasks.TA2, projectId: w.projects.PB, columnId: todoPB, priority: 'HIGH', isMilestone: true, weight: 3, estimatedHours: 6, inspectionPlace: null });
    // Never copied: status and completion, approvals, the repeat, the meeting, client visibility, comments.
    expect(copy).toMatchObject({ completedAt: null, progress: 0, needsApproval: false, approvedAt: null, recurrenceRule: null, meetingId: null, clientVisible: false });
    expect(copy.comments).toHaveLength(0);
    expect(copy.tags.map((t) => t.tag.name)).toEqual([`dup-safety-${w.tag}`]);
    expect(copy.assignees.map((a) => a.userId)).toEqual([w.people.cat]);
    expect(copy.externalContacts.map((c) => c.name)).toEqual(['Ahmed Al Said']);
    // Every item unticked, no person or date, the nesting kept.
    expect(copy.checklistLists.map((l) => l.title)).toEqual(['Before']);
    const valves = copy.checklist.find((i) => i.text === 'Valves')!;
    expect(copy.checklist.find((i) => i.text === 'Main valve')!.parentId).toBe(valves.id);
    expect(copy.checklist.every((i) => !i.done && !i.assigneeId && !i.dueDate)).toBe(true);
    // Files: new files of the copy (new storage names, same bytes), the refused one left out.
    expect(copy.attachments.map((a) => a.filename).sort()).toEqual(['notes.txt', 'plan.txt']);
    const originals = await prisma.attachment.findMany({ where: { taskId: w.tasks.TA2 } });
    for (const a of copy.attachments) {
      const from = originals.find((o) => o.filename === a.filename)!;
      expect(a.storageKey).not.toBe(from.storageKey);
      expect(stored.get(a.storageKey)?.toString()).toBe(stored.get(from.storageKey)?.toString());
      expect(a.uploadedById).toBe(w.people.cat);
    }
    // Watchers: only those who can see the copy's project (ana isn't on PB's companies).
    expect(copy.watchers.map((x) => x.userId)).toEqual([w.people.cat]);
    // The original is untouched.
    expect(await prisma.task.findUniqueOrThrow({ where: { id: w.tasks.TA2 }, select: { completedAt: true, duplicatedFromId: true } })).toMatchObject({ duplicatedFromId: null });
  });

  it('a second copy gets the next number; without the tick no file is copied', async () => {
    const res = await api.post(w.as.cat, `/tasks/${w.tasks.TA2}/duplicate`, { title: 'Again', projectId: w.projects.PA, copyFiles: false });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: Json; files: Json };
    expect(body.data.key).toMatch(new RegExp(`^PA${w.tag.toUpperCase()}-[0-9]+$`));
    expect(body.data.key).not.toBe(`TA2${w.tag.toUpperCase()}-1`);
    secondKey = body.data.key as string;
    expect(body.files).toEqual({ total: 0, copied: 0, failed: [] });
    expect(await prisma.attachment.count({ where: { taskId: body.data.id as string } })).toBe(0);
    // In the first To-do column of the project — not the original's Done column.
    expect(await prisma.task.findUniqueOrThrow({ where: { id: body.data.id as string }, select: { columnId: true, completedAt: true } })).toEqual({ columnId: todoPA, completedAt: null });
  });

  it('the reference both ways, only for whoever may open the other task', async () => {
    // cat sees both projects: the original lists its copies, the copy names the original.
    const original = data(await api.getRaw(w.as.cat, `/tasks/${w.tasks.TA2}`));
    expect((original.copies as Json[]).map((c) => c.key)).toEqual([copyKey, secondKey]);
    expect(data(await api.getRaw(w.as.cat, `/tasks/${copyId}`)).duplicatedFrom).toEqual({ id: w.tasks.TA2, key: `TA2${w.tag.toUpperCase()}-1` });
    // ana (company A) can't see PB: the copy there isn't named or counted.
    const forAna = await api.getRaw(w.as.ana, `/tasks/${w.tasks.TA2}`);
    expect((data(forAna).copies as Json[]).map((c) => c.key)).toEqual([secondKey]);
    expect(forAna.body).not.toContain(copyKey);
    // ben (company B) opens the copy but can't see PA: the original isn't named.
    const forBen = await api.getRaw(w.as.ben, `/tasks/${copyId}`);
    expect(data(forBen).duplicatedFrom).toBeNull();
    expect(forBen.body).not.toContain(`TA2${w.tag.toUpperCase()}`);
  });

  it('the history lines on both tasks, the other task’s number only for whoever may open it', async () => {
    const rows = async (viewer: CompanyWorld['as'][keyof CompanyWorld['as']], taskId: string) =>
      (data(await api.getRaw(viewer, `/tasks/${taskId}/activity`)) as unknown as { action: string; meta: Json }[]).filter((r) => r.action.startsWith('DUPLICATED'));
    expect((await rows(w.as.cat, w.tasks.TA2)).map((r) => r.meta.copyKey)).toEqual(expect.arrayContaining([copyKey]));
    expect((await rows(w.as.cat, copyId)).map((r) => r.meta.fromKey)).toEqual([`TA2${w.tag.toUpperCase()}-1`]);
    const anaSees = await api.getRaw(w.as.ana, `/tasks/${w.tasks.TA2}/activity`);
    expect(anaSees.body).not.toContain(copyKey);
    expect(anaSees.body).not.toContain(copyId);
    expect((await rows(w.as.ben, copyId)).map((r) => r.meta)).toEqual([{}]);
  });

  it('who may: not the original’s viewers only (404), not into a project of theirs only (403), never a client account', async () => {
    const before = await prisma.task.count({ where: { duplicatedFromId: { not: null }, projectId: { in: Object.values(w.projects) } } });
    expect((await api.post(w.as.ana, `/tasks/${w.tasks.TB1}/duplicate`, { title: 'x', projectId: w.projects.PA })).statusCode).toBe(404);
    const refused = await api.post(w.as.ana, `/tasks/${w.tasks.TA1}/duplicate`, { title: 'x', projectId: w.projects.PB });
    expect(refused.statusCode).toBe(403);
    expect((await api.post({ id: w.people.ana, roles: ['CLIENT'] }, `/tasks/${w.tasks.TA1}/duplicate`, { title: 'x', projectId: w.projects.PA })).statusCode).toBe(403);
    expect((await api.getRaw({ id: w.people.ana, roles: ['CLIENT'] }, `/tasks/${w.tasks.TA1}/duplicate`)).statusCode).toBe(403);
    expect(await prisma.task.count({ where: { duplicatedFromId: { not: null }, projectId: { in: Object.values(w.projects) } } })).toBe(before);
  });

  it('the reference stays out of task lists', async () => {
    const list = (await api.get(w.as.cat, `/tasks?projectId=${w.projects.PB}`)) as Json[];
    expect(list.find((t) => t.id === copyId)).toBeDefined();
    expect(list.every((t) => !('duplicatedFromId' in t) && !('copies' in t))).toBe(true);
  });
});
