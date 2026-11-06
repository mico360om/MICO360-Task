import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createChecklistService } from '../../src/modules/tasks/checklist-service';
import { createPrismaChecklistStore, checklistPercentOf, LOCK_TASK_SQL } from '../../src/modules/tasks/prisma-checklist-store';
import { createPrismaChecklistQueries } from '../../src/modules/tasks/prisma-checklist-queries';
import { createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';
import { exportChecklist } from '../../src/modules/tasks/task-export';
import type { ItemRow, ListRow } from '../../src/modules/tasks/checklist-tree';
import { portabilityProblems } from '../../src/lib/sql-portability';
import { runBackfill } from './company-helpers';

// 1.23.3 Nested checklists on a real database (TEST_DATABASE_URL, migrations applied): the backfill run
// again (twice), the service over the Prisma store (two ticks at once), and the cross-task reads.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const BACKFILL = resolve(__dirname, '../../prisma/migrations/20261106100100_nested_checklists_backfill/migration.sql');
const statements = () =>
  readFileSync(BACKFILL, 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
const runChecklistBackfill = async () => {
  for (const s of statements()) await prisma.$executeRawUnsafe(s);
};

let clock = new Date('2026-11-06T08:00:00Z');
const store = createPrismaChecklistStore(prisma);
const queries = createPrismaChecklistQueries(prisma);
const service = createChecklistService({ store, now: () => clock });

const ids: Record<string, string> = {};
async function cleanup() {
  const projects = await prisma.project.findMany({ where: { code: 'NCL' }, select: { id: true } });
  const pids = projects.map((p) => p.id);
  await prisma.task.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.project.deleteMany({ where: { id: { in: pids } } });
  await prisma.user.deleteMany({ where: { email: { in: ['ncl-owner@mico360.test', 'ncl-mate@mico360.test'] } } });
}
async function task(key: string, extra: Record<string, unknown> = {}) {
  const t = await prisma.task.create({ data: { key, title: `Task ${key}`, projectId: ids.project!, columnId: ids.todo!, createdById: ids.owner!, ...extra } });
  ids[key] = t.id;
  return t;
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  clock = new Date('2026-11-06T08:00:00Z');
  await cleanup();
  const owner = await prisma.user.create({ data: { email: 'ncl-owner@mico360.test', username: 'ncl-owner', passwordHash: 'x', firstName: 'Nadia', lastName: 'Owner' } });
  const mate = await prisma.user.create({ data: { email: 'ncl-mate@mico360.test', username: 'ncl-mate', passwordHash: 'x', firstName: 'Mariam', lastName: 'Said' } });
  ids.owner = owner.id;
  ids.mate = mate.id;
  const project = await prisma.project.create({ data: { code: 'NCL', name: 'Nested', createdById: owner.id, ownerId: owner.id, members: { create: [{ userId: mate.id }] } } });
  ids.project = project.id;
  await runBackfill(prisma);
  ids.todo = (await prisma.kanbanColumn.create({ data: { projectId: project.id, name: 'To do', category: 'TODO', position: 0 } })).id;
  ids.done = (await prisma.kanbanColumn.create({ data: { projectId: project.id, name: 'Done', category: 'DONE', position: 1 } })).id;
});

describe('the backfill (existing tasks keep working, with one "Checklist")', () => {
  it('gives each task with items one "Checklist" in their order; a task without items gets none; running it again changes nothing', async () => {
    const a = await task('NCL-1');
    const b = await task('NCL-2');
    const c = await task('NCL-3');
    // Items as a site before 1.23.3 has them: no checklist, flat, in their own order.
    for (const [text, position] of [['Third', 2], ['First', 0], ['Second', 1]] as const) await prisma.checklistItem.create({ data: { taskId: a.id, text, position, done: text === 'First' } });
    await prisma.checklistItem.create({ data: { taskId: c.id, text: 'Only', position: 0 } });
    await runChecklistBackfill();
    const listsOf = (taskId: string) => prisma.checklistList.findMany({ where: { taskId } });
    const [la] = await listsOf(a.id);
    expect(la).toMatchObject({ title: 'Checklist', position: 0, deletedAt: null });
    expect(await listsOf(b.id)).toEqual([]);
    expect(await listsOf(c.id)).toHaveLength(1);
    const view = await service.view(a.id);
    expect(view.items.map((i) => [i.text, i.done, i.depth, i.listId === la!.id])).toEqual([
      ['First', true, 0, true],
      ['Second', false, 0, true],
      ['Third', false, 0, true],
    ]);
    expect(view).toMatchObject({ done: 1, total: 3, percent: 33 });
    const snapshot = async () => ({
      lists: await prisma.checklistList.findMany({ where: { taskId: { in: [a.id, b.id, c.id] } }, orderBy: { id: 'asc' } }),
      items: await prisma.checklistItem.findMany({ where: { taskId: { in: [a.id, b.id, c.id] } }, orderBy: { id: 'asc' } }),
    });
    const once = await snapshot();
    await runChecklistBackfill();
    await runChecklistBackfill();
    expect(await snapshot()).toEqual(once);
  });

  it('every statement (and the hold every change takes) reads alike on MySQL and MariaDB', () => {
    for (const s of [...statements(), LOCK_TASK_SQL]) expect(portabilityProblems(s), s).toEqual([]);
  });
});

describe('the service on the database', () => {
  it('two ticks at once still leave the parent right (each change holds the task)', async () => {
    const t = await task('NCL-4');
    const [panel] = (await service.addItems(t.id, ids.owner!, { texts: ['Panel'] })).items;
    const kids = (await service.addItems(t.id, ids.owner!, { texts: ['Label', 'Test', 'Photo'], parentId: panel!.id })).items;
    await Promise.all(kids.map((k) => service.toggleItem(k.id, true, ids.mate!)));
    expect(await service.getItem(panel!.id)).toMatchObject({ done: true, subDone: 3, subTotal: 3 });
    expect(await checklistPercentOf(prisma, t.id)).toBe(100);
    await service.toggleItem(kids[1]!.id, false, ids.mate!);
    expect((await service.getItem(panel!.id)).done).toBe(false);
    await expect(service.toggleItem(panel!.id, true)).rejects.toMatchObject({ code: 'CHECKLIST_PARENT', message: '1 sub-item still open.' });
  });

  it('moves, copies, deletes with Undo, and the sweep removes what was deleted over 30 days ago', async () => {
    const t = await task('NCL-5');
    const [a, b] = (await service.addItems(t.id, ids.owner!, { texts: ['A', 'B'] })).items;
    await service.addItems(t.id, ids.owner!, { texts: ['A1'], parentId: a!.id });
    await service.moveItem(b!.id, ids.owner!, { action: 'indent' });
    await expect(service.moveItem(a!.id, ids.owner!, { parentId: b!.id, afterId: null })).rejects.toMatchObject({ code: 'CHECKLIST_CIRCULAR' });
    const second = await service.addList(t.id, ids.owner!, 'Fit-out');
    await service.duplicateList((await service.view(t.id)).lists[0]!.id, ids.owner!);
    const texts = async () => (await service.view(t.id)).items.map((i) => `${i.depth}${i.text}`);
    expect(await texts()).toEqual(['0A', '1A1', '1B', '0A', '1A1', '1B']);
    expect((await service.view(t.id)).lists.map((l) => l.title)).toEqual(['Checklist', 'Checklist (copy)', 'Fit-out']);
    const gone = await service.removeItem(a!.id, ids.owner!);
    expect(gone.count).toBe(3);
    await service.restore(t.id, ids.mate!, gone.batchId);
    expect(await texts()).toEqual(['0A', '1A1', '1B', '0A', '1A1', '1B']);
    const list = await service.removeList(second.id, ids.owner!);
    expect((await service.deletedBatches(t.id)).map((d) => d.kind)).toEqual(['list']);
    clock = new Date(clock.getTime() + 31 * 86_400_000);
    expect(await service.purge()).toBe(1);
    expect(await prisma.checklistList.count({ where: { id: second.id } })).toBe(0);
    await expect(service.restore(t.id, ids.owner!, list.batchId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('reads across tasks', () => {
  it('My Tasks lists my open items of open tasks; the calendar and the reminders find dated items', async () => {
    const open = await task('NCL-6', { dueDate: new Date('2026-11-20T00:00:00Z') });
    const finished = await task('NCL-7', { columnId: ids.done, completedAt: clock });
    const waiting = await task('NCL-8', { approvalRequestedAt: clock });
    await prisma.taskAssignee.create({ data: { taskId: open.id, userId: ids.owner! } });
    const [parent, plain] = (await service.addItems(open.id, ids.owner!, { texts: ['Wiring', 'Lights'] })).items;
    await service.addItems(open.id, ids.owner!, { texts: ['Label', 'Test'], parentId: parent!.id });
    await service.updateItem(parent!.id, ids.owner!, { assigneeId: ids.mate!, dueDate: new Date('2026-11-10T00:00:00Z') });
    await service.updateItem(plain!.id, ids.owner!, { dueDate: new Date('2026-11-12T00:00:00Z') });
    for (const t of [finished, waiting]) {
      const [x] = (await service.addItems(t.id, ids.owner!, { texts: ['Hidden'] })).items;
      await service.updateItem(x!.id, ids.owner!, { assigneeId: ids.mate!, dueDate: new Date('2026-11-10T00:00:00Z') });
    }
    const mine = await queries.mine(ids.mate!, null);
    expect(mine).toEqual([
      expect.objectContaining({ text: 'Wiring', isParent: true, openSubItems: 2, dueDate: '2026-11-10', taskKey: 'NCL-6', listTitle: 'Checklist', projectId: ids.project }),
    ]);
    expect(await queries.mine(ids.mate!, [])).toEqual([]);
    const due = await queries.due({ from: '2026-11-01', to: '2026-11-30', userId: ids.mate!, ownIds: [ids.project!], listIds: [ids.project!] });
    expect(due.map((d) => [d.text, d.dueDate, d.taskKey])).toEqual(expect.arrayContaining([['Wiring', '2026-11-10', 'NCL-6'], ['Lights', '2026-11-12', 'NCL-6']]));
    // Someone else's view with no list scope over this project sees only what is given to them.
    const others = await queries.due({ from: '2026-11-01', to: '2026-11-30', userId: ids.mate!, ownIds: null, listIds: ['elsewhere'] });
    expect(others.map((d) => d.text).sort()).toEqual(['Hidden', 'Hidden', 'Wiring']);
    const reminders = await queries.forReminders();
    const here = reminders.filter((r) => r.taskKey.startsWith('NCL-'));
    expect(here.map((r) => [r.text, r.assigneeId === ids.mate, r.taskAssigneeIds])).toEqual(expect.arrayContaining([['Wiring', true, [ids.owner]], ['Lights', false, [ids.owner]]]));
    expect(here).toHaveLength(2);
  });

  it('a task made with checklists keeps their titles and nesting; its card counts the real to-do items; the export lists them', async () => {
    const repo = createPrismaTaskRepository(prisma);
    const t = await repo.create({
      key: 'NCL-9',
      title: 'Fit-out',
      projectId: ids.project!,
      columnId: ids.todo!,
      createdById: ids.owner!,
      checklists: [{ title: 'Electrical', items: [{ text: 'Panel', children: [{ text: 'Label' }, { text: 'Test' }] }] }, { title: 'Paint', items: [{ text: 'Walls' }] }],
    });
    const v = await service.view(t.id);
    expect(v.lists.map((l) => [l.title, l.total])).toEqual([['Electrical', 2], ['Paint', 1]]);
    const [row] = await repo.list({ projectIds: [ids.project!] });
    expect(row!.counts).toMatchObject({ checklistDone: 0, checklistTotal: 3 });
    const lists = await prisma.checklistList.findMany({ where: { taskId: t.id } });
    const items = await prisma.checklistItem.findMany({ where: { taskId: t.id } });
    expect(exportChecklist(lists as ListRow[], items as ItemRow[]).map((c) => [c.list, c.depth, c.text, c.leaf])).toEqual([
      ['Electrical', 0, 'Panel', false],
      ['Electrical', 1, 'Label', true],
      ['Electrical', 1, 'Test', true],
      ['Paint', 0, 'Walls', true],
    ]);
  });
});
