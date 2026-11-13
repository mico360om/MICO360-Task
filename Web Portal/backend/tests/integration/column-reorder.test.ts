import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaColumnRepository } from '../../src/modules/projects/prisma-column-repository';
import { createColumnService } from '../../src/modules/projects/column-service';
import { batch4aWorld, outcome } from './batch4a-helpers';

// Review fix #26 (13 Nov 2026): the website reordered a project's columns with many separate requests
// (temporary negative positions, then the final ones); stopped half-way, the board showed the columns
// reversed and the next drag failed (P2002). One request now reorders them all in one transaction,
// under a hold on the project's row. Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const world = batch4aWorld(prisma, 'CRO');
const repo = createPrismaColumnRepository(prisma);
const columns = createColumnService({ columns: repo });

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(() => world.clean());
afterAll(async () => {
  await world.clean();
  await prisma.$disconnect();
});

async function board() {
  const owner = await world.user(true);
  const b = await world.project(owner.id);
  const backlog = await prisma.kanbanColumn.create({ data: { projectId: b.p.id, name: 'Backlog', category: 'BACKLOG', position: 3 } });
  return { ...b, backlog };
}
const order = async (projectId: string) =>
  (await prisma.kanbanColumn.findMany({ where: { projectId }, orderBy: { position: 'asc' }, select: { name: true, position: true } })).map((c) => `${c.name}@${c.position}`);

describe('reordering a project’s columns in one step (review fix #26)', () => {
  it('saves the whole new order at once: positions 0…n-1, in the order asked', async () => {
    const { p, todo, doing, done, backlog } = await board();
    const saved = await columns.reorderColumns(p.id, [backlog.id, todo.id, doing.id, done.id]);
    expect(saved.map((c) => c.name)).toEqual(['Backlog', 'To do', 'In progress', 'Done']);
    expect(await order(p.id)).toEqual(['Backlog@0', 'To do@1', 'In progress@2', 'Done@3']);
  });

  it('heals a board an old half-done reorder left at temporary negative positions', async () => {
    const { p, todo, doing, done, backlog } = await board();
    // What the old website left behind when stopped between its two phases (the repro's state).
    for (const [i, id] of [done.id, doing.id, todo.id, backlog.id].entries()) await prisma.kanbanColumn.update({ where: { id }, data: { position: -1003 + i } });
    await columns.reorderColumns(p.id, [todo.id, backlog.id, doing.id, done.id]);
    expect(await order(p.id)).toEqual(['To do@0', 'Backlog@1', 'In progress@2', 'Done@3']);
  });

  it('a list that is not exactly the project’s columns is refused and changes nothing', async () => {
    const { p, todo, doing, done, backlog } = await board();
    const before = await order(p.id);
    await expect(columns.reorderColumns(p.id, [todo.id, doing.id, done.id])).rejects.toMatchObject({ status: 409, code: 'COLUMNS_CHANGED' });
    await expect(columns.reorderColumns(p.id, [todo.id, doing.id, done.id, backlog.id, 'not-a-column'])).rejects.toMatchObject({ code: 'COLUMNS_CHANGED' });
    const other = await world.project((await world.user()).id);
    await expect(columns.reorderColumns(p.id, [todo.id, doing.id, done.id, other.todo.id])).rejects.toMatchObject({ code: 'COLUMNS_CHANGED' });
    expect(await order(p.id)).toEqual(before);
    expect(await order(other.p.id)).toEqual(['To do@0', 'In progress@1', 'Done@2']);
  });

  it('a failure part-way leaves the old order (one transaction: nothing half-done)', async () => {
    const { p, todo, doing, done, backlog } = await board();
    const before = await order(p.id);
    const failing = createPrismaColumnRepository(prisma, {
      beforeFinalPositions: async () => {
        throw new Error('connection lost');
      },
    });
    await expect(createColumnService({ columns: failing }).reorderColumns(p.id, [backlog.id, todo.id, doing.id, done.id])).rejects.toThrow('connection lost');
    expect(await order(p.id)).toEqual(before);
  });

  it('two reorders at the same moment: both answer, the board ends in one of the two orders, never mixed or broken', async () => {
    for (let i = 0; i < 10; i++) {
      await world.clean();
      const { p, todo, doing, done, backlog } = await board();
      const a = [backlog.id, todo.id, doing.id, done.id];
      const b = [done.id, doing.id, todo.id, backlog.id];
      const r = await Promise.allSettled([columns.reorderColumns(p.id, a), columns.reorderColumns(p.id, b)]);
      expect(r.map(outcome)).toEqual(['ok', 'ok']);
      const now = await prisma.kanbanColumn.findMany({ where: { projectId: p.id }, orderBy: { position: 'asc' }, select: { id: true, position: true } });
      expect(now.map((c) => c.position)).toEqual([0, 1, 2, 3]);
      expect([a.join(), b.join()]).toContain(now.map((c) => c.id).join());
    }
  });

  it('a reorder and a single-column move (the Android app’s arrows) at the same moment never collide on the unique position', async () => {
    for (let i = 0; i < 10; i++) {
      await world.clean();
      const { p, todo, doing, done, backlog } = await board();
      const r = await Promise.allSettled([
        columns.reorderColumns(p.id, [backlog.id, todo.id, doing.id, done.id]),
        columns.updateColumn(todo.id, { position: -1 - 0 }),
      ]);
      expect(outcome(r[0]!)).toBe('ok');
      const positions = (await prisma.kanbanColumn.findMany({ where: { projectId: p.id }, select: { position: true } })).map((c) => c.position);
      expect(new Set(positions).size).toBe(4);
    }
  });
});
