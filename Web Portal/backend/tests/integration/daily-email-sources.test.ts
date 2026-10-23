import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaDailyEmailSources } from '../../src/modules/daily-emails/prisma-daily-email-sources';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const sources = createPrismaDailyEmailSources(prisma);
const EMAILS = ['dm-ada@mico360.test', 'dm-bo@mico360.test', 'dm-gone@mico360.test'];
let ada = '';
let bo = '';

async function cleanup() {
  const projects = await prisma.project.findMany({ where: { code: { in: ['DMOPEN', 'DMOLD'] } }, select: { id: true } });
  const ids = projects.map((p) => p.id);
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
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
  const user = (email: string, extra: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { email, username: email.split('@')[0]!, passwordHash: 'x', firstName: email[3]!.toUpperCase() + email.slice(4, email.indexOf('@')), lastName: 'Test', ...extra } });
  ada = (await user(EMAILS[0]!, { preferredTimeZone: 'Asia/Kolkata', notificationPrefs: { muted: [], dailyEmails: { pending: true, completed: false, time: '07:00' } } })).id;
  bo = (await user(EMAILS[1]!)).id;
  await user(EMAILS[2]!, { status: 'INACTIVE' });
  const project = async (code: string, status: 'ACTIVE' | 'ARCHIVED', extra: Record<string, unknown> = {}) => {
    const p = await prisma.project.create({ data: { code, name: `Project ${code}`, status, createdById: ada, ownerId: ada, ...extra } });
    const todo = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Doing', category: 'IN_PROGRESS', position: 0 } });
    const done = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Done', category: 'DONE', position: 1 } });
    return { p, todo, done };
  };
  const open = await project('DMOPEN', 'ACTIVE', { number: '2026-014', clientName: 'Acme', managerId: bo, color: '#3A6EA5', imageUrl: '/uploads/projects/dm.png', targetDate: new Date('2026-11-30T00:00:00Z') });
  const old = await project('DMOLD', 'ARCHIVED');
  let n = 0;
  const task = (where: { p: { id: string } }, columnId: string, assignees: string[], extra: Record<string, unknown> = {}) =>
    prisma.task.create({ data: { key: `DM-${++n}`, title: `Task ${n}`, projectId: where.p.id, columnId, createdById: ada, priority: 'HIGH', assignees: { create: assignees.map((userId) => ({ userId })) }, ...extra } });
  await task(open, open.todo.id, [ada], { dueDate: new Date('2026-10-19T00:00:00Z') }); // DM-1: Ada's, pending
  await task(open, open.todo.id, [ada, bo]); // DM-2: both, pending
  await task(open, open.todo.id, [bo]); // DM-3: Bo's only
  await task(open, open.done.id, [ada], { completedAt: new Date('2026-10-20T10:00:00Z') }); // DM-4: done yesterday
  await task(open, open.done.id, [ada], { completedAt: new Date('2026-10-18T10:00:00Z') }); // DM-5: done earlier
  await task(open, open.todo.id, [ada], { deletedAt: new Date() }); // DM-6: deleted
  await task(old, old.todo.id, [ada]); // DM-7: archived project
  await task(open, open.todo.id, []); // DM-8: nobody's
});

describe('Daily email sources (integration)', () => {
  it('lists active people with their own time zone and settings', async () => {
    const people = (await sources.people.list()).filter((p) => EMAILS.includes(p.email ?? ''));
    expect(people.map((p) => p.email).sort()).toEqual([EMAILS[0], EMAILS[1]]);
    const a = people.find((p) => p.id === ada)!;
    expect(a).toMatchObject({ name: 'Ada Test', timeZone: 'Asia/Kolkata', prefs: { dailyEmails: { pending: true, completed: false, time: '07:00' } } });
    expect((await sources.people.find(bo))?.timeZone).toBeNull();
  });

  it('pending: only the person’s own open tasks in projects still going', async () => {
    const tasks = await sources.tasks.pending(ada);
    expect(tasks.map((t) => t.key).sort()).toEqual(['DM-1', 'DM-2']);
    expect(tasks.find((t) => t.key === 'DM-1')).toMatchObject({ title: 'Task 1', priority: 'HIGH', statusLabel: 'Doing', completedAt: null });
    // The project as the email heads its section: details, its manager's name, colour and picture.
    expect(tasks.find((t) => t.key === 'DM-1')!.project).toEqual({
      id: expect.any(String),
      code: 'DMOPEN',
      name: 'Project DMOPEN',
      number: '2026-014',
      clientName: 'Acme',
      managerName: 'Bo Test',
      status: 'ACTIVE',
      color: '#3A6EA5',
      imageUrl: '/uploads/projects/dm.png',
      targetDate: new Date('2026-11-30T00:00:00Z'),
    });
    expect((await sources.tasks.pending(bo)).map((t) => t.key).sort()).toEqual(['DM-2', 'DM-3']);
  });

  it('completed: the person’s tasks finished in the window', async () => {
    const tasks = await sources.tasks.completedBetween(ada, new Date('2026-10-20T00:00:00Z'), new Date('2026-10-21T00:00:00Z'));
    expect(tasks.map((t) => t.key)).toEqual(['DM-4']);
    expect(await sources.tasks.completedBetween(bo, new Date('2026-10-20T00:00:00Z'), new Date('2026-10-21T00:00:00Z'))).toEqual([]);
  });
});
