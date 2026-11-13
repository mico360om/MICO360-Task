import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaRecurrencePort } from '../../src/modules/tasks/prisma-recurrence-port';
import { createPrismaTaskMoveRepository } from '../../src/modules/tasks/prisma-task-move-repository';
import { createTaskMoveService } from '../../src/modules/tasks/task-move-service';
import { createTaskMergeService } from '../../src/modules/task-merge/merge-service';
import { createGuestService } from '../../src/modules/guests/guest-service';
import { createPrismaTemplateRepository } from '../../src/modules/templates/prisma-template-repository';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';

// 1.24 Guests and categories through the task's other journeys: repeat copies, moves, merges and project templates.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const NOW = new Date('2026-11-10T06:00:00Z');
const guests = createGuestService({ prisma });
const moves = createTaskMoveService({ repo: createPrismaTaskMoveRepository(prisma), timeZone: TZ, now: () => NOW });
const merges = createTaskMergeService({ prisma, timeZone: TZ, now: () => NOW, readFile: async () => null });

const CODES = ['GCF1', 'GCF2', 'GCF3', 'GCF4'];
const COMPANIES = ['gcf_company_a', 'gcf_company_b'];
let admin = { id: '', roles: ['ADMIN'] as string[] };
let mate = '';
const P: Record<string, { id: string; todo: string }> = {};
let n = 0;

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } })).map((p) => p.id);
  await prisma.activity.deleteMany({ where: { projectId: { in: ids } } });
  const taskIds = (await prisma.task.findMany({ where: { projectId: { in: ids } }, select: { id: true } })).map((t) => t.id);
  await prisma.taskMerge.deleteMany({ where: { mainTaskId: { in: taskIds } } }).catch(() => undefined);
  await prisma.taskKeyAlias.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.task.updateMany({ where: { projectId: { in: ids } }, data: { mergedIntoId: null, recurrenceSourceId: null } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.projectTemplate.deleteMany({ where: { name: 'GCF template' } });
  await prisma.guestContact.deleteMany({ where: { companyId: { in: COMPANIES } } });
  await prisma.companyMember.deleteMany({ where: { companyId: { in: COMPANIES } } });
  await prisma.company.deleteMany({ where: { id: { in: COMPANIES } } });
  await prisma.user.deleteMany({ where: { email: { in: ['gcf-admin@mico360.test', 'gcf-mate@mico360.test'] } } });
}

async function task(project: string, extra: { assignees?: string[]; title?: string } = {}) {
  n += 1;
  const t = await prisma.task.create({ data: { key: `${project}-${n}`, title: extra.title ?? `Task ${n}`, projectId: P[project]!.id, columnId: P[project]!.todo, createdById: admin.id } });
  for (const userId of extra.assignees ?? [mate]) await prisma.taskAssignee.create({ data: { taskId: t.id, userId } });
  return t.id;
}
const category = (project: string, name: string, color = 'teal') =>
  prisma.projectCategory.create({ data: { projectId: P[project]!.id, name, nameKey: name.toLowerCase().replace(/\s+/g, ''), color } }).then((c) => c.id);
const categoryNames = async (taskId: string) =>
  (await prisma.taskCategory.findMany({ where: { taskId }, include: { category: true } })).map((c) => `${c.category.projectId === P.GCF1!.id ? '1' : c.category.projectId === P.GCF2!.id ? '2' : '3'}:${c.category.name}`).sort();
const guestOn = async (taskId: string) =>
  (await prisma.taskExternalContact.findMany({ where: { taskId }, include: { guest: true }, orderBy: { position: 'asc' } })).map((r) => ({ name: r.name, company: r.guest?.companyId, guestId: r.guestId, note: r.remarks }));

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await cleanup();
  for (const [i, id] of COMPANIES.entries()) await prisma.company.create({ data: { id, name: `GCF Co ${i}`, code: `GF${i}` } });
  admin = { id: (await prisma.user.create({ data: { email: 'gcf-admin@mico360.test', username: 'gcfadmin', passwordHash: 'x', firstName: 'Ada', lastName: 'Admin', roles: { create: { role: { connectOrCreate: { where: { name: 'ADMIN' }, create: { name: 'ADMIN' } } } } } } })).id, roles: ['ADMIN'] };
  mate = (await prisma.user.create({ data: { email: 'gcf-mate@mico360.test', username: 'gcfmate', passwordHash: 'x', firstName: 'Omar', lastName: 'Mate' } })).id;
  await prisma.companyMember.createMany({ data: COMPANIES.flatMap((companyId) => [admin.id, mate].map((userId) => ({ companyId, userId }))) });
  for (const [code, company] of [['GCF1', COMPANIES[0]], ['GCF2', COMPANIES[0]], ['GCF3', COMPANIES[1]]] as const) {
    const p = await prisma.project.create({ data: { code, name: `Project ${code}`, createdById: admin.id, ownerId: admin.id, mainCompanyId: company!, companies: { create: [{ companyId: company! }] }, members: { create: [{ userId: mate }] } } });
    const todo = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'To do', category: 'TODO', position: 0 } });
    await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Done', category: 'DONE', position: 1 } });
    P[code] = { id: p.id, todo: todo.id };
  }
});

describe('repeat copies keep guests and categories', () => {
  it('the next copy links the same guests (with their notes) and has the same categories', async () => {
    const t = await task('GCF1');
    const civil = await category('GCF1', 'Civil');
    await prisma.taskCategory.create({ data: { taskId: t, categoryId: civil } });
    const g = await guests.createForProject(P.GCF1!.id, { name: 'Ahmed', company: 'Acme' }, admin.id);
    await guests.addToTask(t, g.id, 'Signs off', admin.id);
    await prisma.task.update({ where: { id: t }, data: { recurrenceRule: { freq: 'WEEKLY', interval: 1 } } });
    const port = createPrismaRecurrencePort(prisma, { timeZone: TZ, now: () => NOW });
    const next = await port.spawnNext(t, new Date('2026-11-17T00:00:00Z'), { freq: 'WEEKLY', interval: 1 });
    expect(next).toBeTruthy();
    const copyId = (next as { id: string }).id;
    expect(await guestOn(copyId)).toEqual([{ name: 'Ahmed', company: COMPANIES[0], guestId: g.id, note: 'Signs off' }]);
    expect(await categoryNames(copyId)).toEqual(['1:Civil']);
  });
});

describe('moving a task to another project', () => {
  it('keeps the categories the new project has by name, drops the rest — the preview says which', async () => {
    const t = await task('GCF1');
    for (const id of [await category('GCF1', 'Civil'), await category('GCF1', 'Electrical')]) await prisma.taskCategory.create({ data: { taskId: t, categoryId: id } });
    const civil2 = await category('GCF2', ' civil', 'gold');
    const preview = await moves.preview(admin, [t], P.GCF2!.id);
    expect(preview.tasks[0]).toMatchObject({ canMove: true, categoriesDropped: ['Electrical'], guestsCopied: 0 });
    await moves.moveTask(admin, t, { projectId: P.GCF2!.id });
    expect((await prisma.taskCategory.findMany({ where: { taskId: t } })).map((c) => c.categoryId)).toEqual([civil2]);
    const lines = await prisma.activity.findMany({ where: { taskId: t, action: 'CATEGORY_REMOVED' } });
    expect(lines.map((l) => (l.meta as { name: string }).name)).toEqual(['Electrical']);
  });

  it('to another company’s project: its guests are copied onto that company’s list and relinked', async () => {
    const t = await task('GCF1');
    const g = await guests.createForProject(P.GCF1!.id, { name: 'Ahmed', company: 'Acme', email: 'a@acme.com' }, admin.id);
    await guests.addToTask(t, g.id, 'note', admin.id);
    const theirs = await guests.createForProject(P.GCF3!.id, { name: 'ahmed', email: 'A@acme.com' }, admin.id);
    const preview = await moves.preview(admin, [t], P.GCF3!.id);
    expect(preview.tasks[0]).toMatchObject({ guestsCopied: 1, categoriesDropped: [] });
    await moves.moveTask(admin, t, { projectId: P.GCF3!.id, assignees: 'ADD_TO_TEAM' });
    // The same person on company B's list is used (the duplicate rule); company A's guest is unchanged.
    expect(await guestOn(t)).toEqual([{ name: 'ahmed', company: COMPANIES[1], guestId: theirs.id, note: 'note' }]);
    expect((await prisma.guestContact.findUniqueOrThrow({ where: { id: g.id } })).companyId).toBe(COMPANIES[0]);
  });

  it('unassigning everyone from a task with guests is refused (it needs a team member)', async () => {
    const outsider = (await prisma.user.create({ data: { email: 'gcf-out@mico360.test', username: 'gcfout', passwordHash: 'x', firstName: 'Out', lastName: 'Sider' } })).id;
    try {
      await prisma.projectMember.create({ data: { projectId: P.GCF1!.id, userId: outsider } });
      await prisma.companyMember.create({ data: { companyId: COMPANIES[0]!, userId: outsider } });
      const t = await task('GCF1', { assignees: [outsider] });
      const g = await guests.createForProject(P.GCF1!.id, { name: 'Ahmed' }, admin.id);
      await guests.addToTask(t, g.id, null, admin.id);
      await expect(moves.moveTask(admin, t, { projectId: P.GCF2!.id, assignees: 'UNASSIGN' })).rejects.toMatchObject({ code: 'NEEDS_TEAM_MEMBER' });
    } finally {
      await prisma.user.delete({ where: { id: outsider } }).catch(() => undefined);
    }
  });
});

describe('merging tasks', () => {
  it('keeps the union of categories (another project’s by name) and each guest once; Undo gives each back', async () => {
    const main = await task('GCF1', { title: 'Main' });
    const other = await task('GCF2', { title: 'Other' });
    const civil1 = await category('GCF1', 'Civil');
    const hse1 = await category('GCF1', 'HSE');
    await prisma.taskCategory.create({ data: { taskId: main, categoryId: civil1 } });
    for (const id of [await category('GCF2', 'HSE'), await category('GCF2', 'Roads')]) await prisma.taskCategory.create({ data: { taskId: other, categoryId: id } });
    const ahmed = await guests.createForProject(P.GCF1!.id, { name: 'Ahmed' }, admin.id);
    const sara = await guests.createForProject(P.GCF1!.id, { name: 'Sara' }, admin.id);
    await guests.addToTask(main, ahmed.id, null, admin.id);
    await guests.addToTask(other, ahmed.id, 'from other', admin.id);
    await guests.addToTask(other, sara.id, null, admin.id);
    const r = await merges.merge(admin, { taskIds: [main, other], mainTaskId: main });
    expect(await categoryNames(main)).toEqual(['1:Civil', '1:HSE']);
    expect((await guestOn(main)).map((g) => g.guestId)).toEqual([ahmed.id, sara.id]);
    void hse1;
    await merges.undo(admin, r.mergeId);
    expect(await categoryNames(main)).toEqual(['1:Civil']);
    expect(await categoryNames(other)).toEqual(['2:HSE', '2:Roads']);
    expect((await guestOn(other)).map((g) => g.guestId).sort()).toEqual([ahmed.id, sara.id].sort());
    expect((await guestOn(main)).map((g) => g.guestId)).toEqual([ahmed.id]);
  });
});

describe('project templates', () => {
  it('“Save as template” keeps the project’s categories (not retired ones); a project made from it starts with them', async () => {
    await category('GCF1', 'Civil', 'teal');
    const retired = await category('GCF1', 'Old', 'plum');
    await prisma.projectCategory.update({ where: { id: retired }, data: { retiredAt: new Date() } });
    await category('GCF1', 'HSE', 'pink');
    const templates = createPrismaTemplateRepository(prisma);
    const snap = await templates.projectSnapshot(P.GCF1!.id);
    expect(snap?.categories).toEqual([{ name: 'Civil', color: 'teal' }, { name: 'HSE', color: 'pink' }]);
    const saved = await templates.createProjectTemplate({ name: 'GCF template', description: null, columns: snap!.columns, roles: [], tasks: [], categories: snap!.categories }, admin.id);
    expect(saved.categories).toEqual([{ name: 'Civil', color: 'teal' }, { name: 'HSE', color: 'pink' }]);
    const projects = createPrismaProjectRepository(prisma);
    const made = await projects.create({
      code: 'GCF4',
      name: 'From template',
      createdById: admin.id,
      ownerId: admin.id,
      companyIds: [COMPANIES[0]!],
      startWith: { columns: saved.columns, startColumn: 0, tasks: [], boardDate: NOW, templateName: 'GCF template', categories: saved.categories },
    } as Parameters<typeof projects.create>[0]);
    const list = await prisma.projectCategory.findMany({ where: { projectId: made.id }, orderBy: { position: 'asc' } });
    expect(list.map((c) => [c.name, c.color, c.position])).toEqual([['Civil', 'teal', 0], ['HSE', 'pink', 1]]);
  });
});
