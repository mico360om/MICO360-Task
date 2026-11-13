import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaColumnRepository, countWaitingTasksIn } from '../../src/modules/projects/prisma-column-repository';
import { createColumnService } from '../../src/modules/projects/column-service';
import { batch4aWorld } from './batch4a-helpers';

// Review fix #13 (13 Nov 2026): a column changed To-do→Done left its tasks "done" with no completion
// date; Done→To-do kept their old dates. A change into or out of Done is now refused while the column
// holds tasks — live, archived or in the Recycle Bin — and other status changes keep working.
// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const world = batch4aWorld(prisma, 'CSC');
const columns = createColumnService({ columns: createPrismaColumnRepository(prisma), waitingTasksIn: (id) => countWaitingTasksIn(prisma, id) });
const MESSAGE = 'Move the tasks out of this column first, then change its status.';

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(() => world.clean());
afterAll(async () => {
  await world.clean();
  await prisma.$disconnect();
});

async function setup() {
  const owner = await world.user(true);
  const b = await world.project(owner.id);
  return { owner, ...b };
}

describe('changing a column’s status kind (review fix #13)', () => {
  it('To do → Done with an open task in it: refused (409), the column and the task stay as they were', async () => {
    const { owner, p, todo } = await setup();
    const t = await world.task(p.id, p.code, todo.id, owner.id, { dueDate: new Date('2026-01-01T00:00:00Z'), progress: 20 });
    await expect(columns.updateColumn(todo.id, { category: 'DONE' })).rejects.toMatchObject({ status: 409, code: 'COLUMN_HAS_TASKS', message: MESSAGE });
    expect((await prisma.kanbanColumn.findUniqueOrThrow({ where: { id: todo.id } })).category).toBe('TODO');
    expect(await prisma.task.findUniqueOrThrow({ where: { id: t.id }, select: { completedAt: true, progress: true } })).toEqual({ completedAt: null, progress: 20 });
  });

  it('Done → To do with a finished task in it: refused, its completion date kept', async () => {
    const { owner, p, done } = await setup();
    const at = new Date('2026-02-01T00:00:00Z');
    await world.task(p.id, p.code, done.id, owner.id, { completedAt: at, progress: 100 });
    await expect(columns.updateColumn(done.id, { category: 'TODO' })).rejects.toMatchObject({ status: 409, code: 'COLUMN_HAS_TASKS' });
    expect((await prisma.kanbanColumn.findUniqueOrThrow({ where: { id: done.id } })).category).toBe('DONE');
  });

  it('archived tasks and tasks in the Recycle Bin count too (they come back into this column), and the message says so', async () => {
    const { owner, p, todo, doing } = await setup();
    await world.task(p.id, p.code, todo.id, owner.id, { archivedAt: new Date() });
    await world.task(p.id, p.code, doing.id, owner.id, { deletedAt: new Date() });
    await expect(columns.updateColumn(todo.id, { category: 'DONE' })).rejects.toMatchObject({ code: 'COLUMN_HAS_TASKS', message: `${MESSAGE} That includes 1 archived task.` });
    await expect(columns.updateColumn(doing.id, { category: 'DONE' })).rejects.toMatchObject({ code: 'COLUMN_HAS_TASKS', message: `${MESSAGE} That includes 1 task in the Recycle Bin.` });
  });

  it('a merged task’s record (hidden for good, nobody can move it) does not hold the column', async () => {
    const { owner, p, todo, doing } = await setup();
    const main = await world.task(p.id, p.code, doing.id, owner.id);
    await world.task(p.id, p.code, todo.id, owner.id, { deletedAt: new Date(), mergedIntoId: main.id, mergedAt: new Date() });
    await expect(columns.updateColumn(todo.id, { category: 'DONE' })).resolves.toMatchObject({ category: 'DONE' });
  });

  it('other changes keep working: between open kinds with tasks in it, into or out of Done when empty, a rename of a full Done column', async () => {
    const { owner, p, todo, doing, done } = await setup();
    await world.task(p.id, p.code, todo.id, owner.id);
    await world.task(p.id, p.code, done.id, owner.id, { completedAt: new Date(), progress: 100 });
    await expect(columns.updateColumn(todo.id, { category: 'IN_PROGRESS' })).resolves.toMatchObject({ category: 'IN_PROGRESS' });
    await expect(columns.updateColumn(todo.id, { category: 'BLOCKED', name: 'Waiting' })).resolves.toMatchObject({ category: 'BLOCKED', name: 'Waiting' });
    await expect(columns.updateColumn(doing.id, { category: 'DONE' })).resolves.toMatchObject({ category: 'DONE' });
    await expect(columns.updateColumn(doing.id, { category: 'REVIEW' })).resolves.toMatchObject({ category: 'REVIEW' });
    await expect(columns.updateColumn(done.id, { name: 'Finished', enabled: false })).resolves.toMatchObject({ name: 'Finished', category: 'DONE', enabled: false });
    await expect(columns.updateColumn(done.id, { category: 'DONE' })).resolves.toMatchObject({ category: 'DONE' });
  });

  it('tasks waiting for approval keep their own words (TASKS_WAITING), as before', async () => {
    const { owner, p, doing } = await setup();
    await world.task(p.id, p.code, doing.id, owner.id, { needsApproval: true, approvalRequestedAt: new Date(), approvalRequestedById: owner.id });
    await expect(columns.updateColumn(doing.id, { category: 'DONE' })).rejects.toMatchObject({ code: 'TASKS_WAITING' });
  });
});
