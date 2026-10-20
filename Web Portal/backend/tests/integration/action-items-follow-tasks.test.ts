import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. Runs the one-time
// correction again on fresh rows (it is safe to run twice).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const SQL = readFileSync(resolve(__dirname, '../../prisma/migrations/20261021090000_action_items_follow_tasks/migration.sql'), 'utf8');

let ids: Record<string, string> = {};

async function cleanup() {
  const projects = await prisma.project.findMany({ where: { code: 'FOLLOW' }, select: { id: true } });
  const pids = projects.map((p) => p.id);
  await prisma.actionItem.deleteMany({ where: { description: { startsWith: 'follow-test' } } });
  await prisma.task.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.project.deleteMany({ where: { id: { in: pids } } });
  await prisma.user.deleteMany({ where: { email: 'follow-owner@mico360.test' } });
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
  const owner = await prisma.user.create({ data: { email: 'follow-owner@mico360.test', username: 'follow-owner', passwordHash: 'x', firstName: 'Follow', lastName: 'Owner' } });
  const project = await prisma.project.create({ data: { code: 'FOLLOW', name: 'Follow', createdById: owner.id, ownerId: owner.id } });
  const todo = await prisma.kanbanColumn.create({ data: { projectId: project.id, name: 'To do', category: 'TODO', position: 0 } });
  const done = await prisma.kanbanColumn.create({ data: { projectId: project.id, name: 'Done', category: 'DONE', position: 1 } });
  const task = (key: string, columnId: string, extra: Record<string, unknown> = {}) =>
    prisma.task.create({ data: { key, title: key, projectId: project.id, columnId, createdById: owner.id, ...extra } });
  const doneTask = await task('FOLLOW-1', done.id, { completedAt: new Date('2026-10-19T08:00:00Z') });
  const openTask = await task('FOLLOW-2', todo.id);
  const deletedDone = await task('FOLLOW-3', done.id, { deletedAt: new Date() });
  const item = (description: string, taskId: string | null, status: 'OPEN' | 'IN_PROGRESS' | 'CANCELLED' = 'OPEN') =>
    prisma.actionItem.create({ data: { description: `follow-test ${description}`, taskId, status, createdById: owner.id } });
  ids = {
    doneOpen: (await item('done task, open item', doneTask.id)).id,
    doneDoing: (await item('done task, item in progress', doneTask.id, 'IN_PROGRESS')).id,
    doneCancelled: (await item('done task, cancelled item', doneTask.id, 'CANCELLED')).id,
    openTask: (await item('open task', openTask.id)).id,
    deletedTask: (await item('deleted done task', deletedDone.id)).id,
    noTask: (await item('no task', null)).id,
  };
});

describe('One-time correction: action items of done tasks are completed (integration)', () => {
  it('completes the open items of tasks already done, with the task’s completion time', async () => {
    await prisma.$executeRawUnsafe(SQL);
    const get = (id: string) => prisma.actionItem.findUniqueOrThrow({ where: { id } });
    for (const id of [ids.doneOpen!, ids.doneDoing!]) {
      const a = await get(id);
      expect(a.status).toBe('COMPLETED');
      expect(a.progress).toBe(100);
      expect(a.completedAt).toEqual(new Date('2026-10-19T08:00:00Z'));
    }
    expect((await get(ids.doneCancelled!)).status).toBe('CANCELLED');
    expect((await get(ids.openTask!)).status).toBe('OPEN');
    expect((await get(ids.deletedTask!)).status).toBe('OPEN');
    expect((await get(ids.noTask!)).status).toBe('OPEN');
  });

  it('changes nothing when run again', async () => {
    await prisma.$executeRawUnsafe(SQL);
    const before = await prisma.actionItem.findMany({ where: { description: { startsWith: 'follow-test' } }, orderBy: { id: 'asc' } });
    await prisma.$executeRawUnsafe(SQL);
    const after = await prisma.actionItem.findMany({ where: { description: { startsWith: 'follow-test' } }, orderBy: { id: 'asc' } });
    expect(after.map((a) => [a.status, a.completedAt?.toISOString()])).toEqual(before.map((a) => [a.status, a.completedAt?.toISOString()]));
  });
});
