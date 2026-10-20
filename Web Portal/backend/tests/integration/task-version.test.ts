import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';
import { TaskVersionConflictError } from '../../src/modules/tasks/task-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaTaskRepository(prisma);
let taskId = '';

async function cleanup() {
  const projects = await prisma.project.findMany({ where: { code: 'TVER' }, select: { id: true } });
  const ids = projects.map((p) => p.id);
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: 'tver@mico360.test' } });
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
  const owner = await prisma.user.create({ data: { email: 'tver@mico360.test', username: 'tver', passwordHash: 'x', firstName: 'T', lastName: 'Ver' } });
  const project = await prisma.project.create({ data: { code: 'TVER', name: 'Versions', createdById: owner.id, ownerId: owner.id } });
  const col = await prisma.kanbanColumn.create({ data: { projectId: project.id, name: 'To do', category: 'TODO', position: 0 } });
  taskId = (await prisma.task.create({ data: { key: 'TVER-1', title: 'Original', projectId: project.id, columnId: col.id, createdById: owner.id } })).id;
});

describe('Task edits against a version (integration)', () => {
  it('lets only one of two edits made from the same copy through, even at the same moment', async () => {
    const start = (await repo.findById(taskId))!.version;
    const results = await Promise.allSettled([
      repo.update(taskId, { title: 'From the web' }, { expectedVersion: start }),
      repo.update(taskId, { title: 'From the phone' }, { expectedVersion: start }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(TaskVersionConflictError);
    const now = (await repo.findById(taskId))!;
    expect(now.version).toBe(start + 1);
    expect(now.title).toBe((ok[0] as PromiseFulfilledResult<{ title: string }>).value.title);
  });

  it('saves an edit from the current copy, and without a version as before', async () => {
    const start = (await repo.findById(taskId))!.version;
    expect((await repo.update(taskId, { title: 'Next' }, { expectedVersion: start })).version).toBe(start + 1);
    expect((await repo.update(taskId, { title: 'No version' })).version).toBe(start + 2);
  });
});
