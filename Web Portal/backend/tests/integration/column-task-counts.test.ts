import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaColumnRepository } from '../../src/modules/projects/prisma-column-repository';
import { createColumnService } from '../../src/modules/projects/column-service';
import { batch4aWorld } from './batch4a-helpers';

// s137 (1.23.37): Manage columns' task counts — each column's live tasks (not archived, not in the
// Recycle Bin), the same tasks that keep a column from being deleted. Requires TEST_DATABASE_URL.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const world = batch4aWorld(prisma, 'CTC');
const columns = createColumnService({ columns: createPrismaColumnRepository(prisma) });

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(() => world.clean());
afterAll(async () => {
  await world.clean();
  await prisma.$disconnect();
});

describe('column task counts (s137)', () => {
  it('counts live tasks per column; archived and binned ones are left out; empty columns read 0', async () => {
    const owner = await world.user(true);
    const { p, todo, doing, done } = await world.project(owner.id);
    await world.task(p.id, p.code, todo.id, owner.id);
    await world.task(p.id, p.code, todo.id, owner.id);
    await world.task(p.id, p.code, todo.id, owner.id, { archivedAt: new Date() });
    await world.task(p.id, p.code, doing.id, owner.id, { deletedAt: new Date() });
    await world.task(p.id, p.code, done.id, owner.id, { completedAt: new Date(), progress: 100 });
    const counted = await columns.listColumnsWithCounts(p.id);
    const by = Object.fromEntries(counted.map((c) => [c.id, c.taskCount]));
    expect(by[todo.id]).toBe(2);
    expect(by[doing.id]).toBe(0);
    expect(by[done.id]).toBe(1);
    // The same number Delete goes by.
    await expect(columns.removeColumn(todo.id)).rejects.toMatchObject({ code: 'COLUMN_NOT_EMPTY' });
  });
});
