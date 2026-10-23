import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaProjectOverviewSource } from '../../src/modules/projects/prisma-project-overview-source';
import { buildProjectOverview } from '../../src/modules/projects/project-overview';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const source = createPrismaProjectOverviewSource(prisma);
const projects = createPrismaProjectRepository(prisma);
const CODES = ['OVONE', 'OVTWO'];
const EMAILS = ['ov-ada@mico360.test', 'ov-bo@mico360.test', 'ov-cy@mico360.test'];
let ada = '';
let bo = '';
let one = '';
let two = '';

async function cleanup() {
  const ps = await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } });
  const ids = ps.map((p) => p.id);
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
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
  const user = (email: string, firstName: string, extra: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { email, username: email.split('@')[0]!, passwordHash: 'x', firstName, lastName: 'Test', ...extra } });
  ada = (await user(EMAILS[0]!, 'Ada', { avatarUrl: '/uploads/avatars/ada.png' })).id;
  bo = (await user(EMAILS[1]!, 'Bo')).id;
  const cy = (await user(EMAILS[2]!, 'Cy', { deletedAt: new Date() })).id;
  one = (await prisma.project.create({ data: { code: 'OVONE', name: 'Overview one', createdById: ada, ownerId: ada } })).id;
  two = (await prisma.project.create({ data: { code: 'OVTWO', name: 'Overview two', createdById: ada } })).id;
  await prisma.projectMember.create({ data: { projectId: one, userId: bo, addedAt: new Date('2026-01-01T00:00:00Z') } });
  await prisma.projectMember.create({ data: { projectId: one, userId: ada, addedAt: new Date('2026-02-01T00:00:00Z') } });
  await prisma.projectMember.create({ data: { projectId: one, userId: cy, addedAt: new Date('2026-03-01T00:00:00Z') } }); // deleted person
  const doing = await prisma.kanbanColumn.create({ data: { projectId: one, name: 'Doing', category: 'IN_PROGRESS', position: 0 } });
  const done = await prisma.kanbanColumn.create({ data: { projectId: one, name: 'Done', category: 'DONE', position: 1 } });
  let n = 0;
  const task = (columnId: string, extra: Record<string, unknown> = {}) =>
    prisma.task.create({ data: { key: `OV-${++n}`, title: `Task ${n}`, projectId: one, columnId, createdById: ada, ...extra } });
  const past = new Date('2026-10-01T00:00:00Z');
  await task(doing.id, { dueDate: past }); // overdue
  await task(doing.id, { dueDate: past }); // overdue, same day
  await task(doing.id, { dueDate: new Date('2099-01-05T00:00:00Z') }); // next due
  await task(doing.id); // open, no due date
  await task(done.id, { dueDate: past }); // done (Done column)
  await task(doing.id, { dueDate: past, completedAt: new Date('2026-10-02T09:00:00Z') }); // done (completed)
  await task(doing.id, { dueDate: past, deletedAt: new Date() }); // deleted: not counted
});

describe('Projects overview figures (integration)', () => {
  it('counts each project’s tasks, open and overdue work and next due day in grouped queries', async () => {
    const list = (await projects.list()).filter((p) => CODES.includes(p.code));
    const rows = await source.load(list.map((p) => p.id), [ada]);
    const byCode = Object.fromEntries(
      buildProjectOverview(list, rows, { timeZone: 'Asia/Muscat', now: new Date('2026-10-23T10:00:00Z') }).map((p) => [p.code, p]),
    );

    expect(byCode.OVONE!.stats).toMatchObject({ total: 6, done: 2, open: 4, overdue: 2, nextDue: '2099-01-05' });
    expect(byCode.OVONE!.owner).toEqual({ id: ada, name: 'Ada Test', avatarUrl: '/uploads/avatars/ada.png' });
    // The team in the order people joined, without anyone deleted.
    expect(byCode.OVONE!.team.map((m) => m.name)).toEqual(['Bo Test', 'Ada Test']);
    expect(byCode.OVONE!.stats.lastActivityAt.getTime()).toBeGreaterThanOrEqual(byCode.OVONE!.updatedAt.getTime());

    expect(byCode.OVTWO!.stats).toMatchObject({ total: 0, done: 0, open: 0, overdue: 0, nextDue: null });
    expect(byCode.OVTWO!.owner).toBeNull();
    expect(byCode.OVTWO!.team).toEqual([]);
    expect(two).toBe(byCode.OVTWO!.id);
  });

  it('dates a project’s last update by its latest task change', async () => {
    const later = new Date(Date.now() + 60_000);
    await prisma.task.updateMany({ where: { key: 'OV-3' }, data: { updatedAt: later } });
    const [p] = (await projects.list()).filter((x) => x.code === 'OVONE');
    const rows = await source.load([p!.id], []);
    const [item] = buildProjectOverview([p!], rows, { timeZone: 'Asia/Muscat' });
    expect(Math.abs(item!.stats.lastActivityAt.getTime() - later.getTime())).toBeLessThan(1000);
  });
});
