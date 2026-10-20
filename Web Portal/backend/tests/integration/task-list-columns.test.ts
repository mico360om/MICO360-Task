import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaTaskRepository(prisma);
let projectId = '';

async function cleanup() {
  const projects = await prisma.project.findMany({ where: { code: 'COLVIS' }, select: { id: true } });
  const ids = projects.map((p) => p.id);
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: 'colvis@mico360.test' } });
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
  const owner = await prisma.user.create({ data: { email: 'colvis@mico360.test', username: 'colvis', passwordHash: 'x', firstName: 'Col', lastName: 'Vis' } });
  projectId = (await prisma.project.create({ data: { code: 'COLVIS', name: 'Columns', createdById: owner.id, ownerId: owner.id } })).id;
  const shown = await prisma.kanbanColumn.create({ data: { projectId, name: 'Doing', category: 'IN_PROGRESS', position: 0 } });
  const hidden = await prisma.kanbanColumn.create({ data: { projectId, name: 'Someday', category: 'BACKLOG', position: 1, enabled: false } });
  await prisma.task.create({ data: { key: 'COLVIS-1', title: 'On the board', projectId, columnId: shown.id, createdById: owner.id } });
  await prisma.task.create({ data: { key: 'COLVIS-2', title: 'In a hidden column', projectId, columnId: hidden.id, createdById: owner.id } });
});

describe('Task list rows say whether their column is on the board (integration)', () => {
  it('marks a task in a column switched off in Manage columns', async () => {
    const rows = await repo.list({ projectIds: [projectId] });
    const byKey = Object.fromEntries(rows.map((t) => [t.key, t]));
    expect(byKey['COLVIS-1']).toMatchObject({ columnCategory: 'IN_PROGRESS', columnHidden: false });
    expect(byKey['COLVIS-2']).toMatchObject({ columnCategory: 'BACKLOG', columnHidden: true });
  });
});
