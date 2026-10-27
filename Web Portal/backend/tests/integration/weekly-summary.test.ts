import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaWeeklySummaryPeople, createPrismaWeeklySummaryRepository } from '../../src/modules/management/prisma-weekly-summary';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaWeeklySummaryRepository(prisma);
const people = createPrismaWeeklySummaryPeople(prisma);
const EMAILS = ['ws-ann@mico360.test', 'ws-ben@mico360.test', 'ws-cat@mico360.test', 'ws-dan@mico360.test', 'ws-eve@mico360.test', 'ws-fay@mico360.test'];
const CODES = ['WSLIVE', 'WSGONE'];
const ids: Record<string, string> = {};

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  await prisma.weeklySummaryEmail.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.projectMember.deleteMany({ where: { project: { code: { in: CODES } } } });
  await prisma.project.deleteMany({ where: { code: { in: CODES } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
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
  const admin = await prisma.role.upsert({ where: { name: 'ADMIN' }, update: {}, create: { name: 'ADMIN' } });
  const user = async (key: string, extra: Record<string, unknown> = {}) => {
    ids[key] = (await prisma.user.create({ data: { email: `ws-${key}@mico360.test`, username: `ws-${key}`, passwordHash: 'x', firstName: key, lastName: 'Weekly', ...extra } })).id;
  };
  await user('ann', { notificationPrefs: { muted: [], weeklySummary: false }, preferredTimeZone: 'Asia/Dubai' });
  await user('ben');
  await user('cat');
  await user('dan');
  await user('eve', { status: 'INACTIVE' });
  await user('fay', { deletedAt: new Date() });
  await prisma.userRole.create({ data: { userId: ids.ann!, roleId: admin.id } });
  await prisma.project.create({ data: { code: 'WSLIVE', name: 'WS live', createdById: ids.ann!, ownerId: ids.ben, members: { create: [{ userId: ids.cat!, role: 'MANAGER' }, { userId: ids.dan! }] } } });
  // Running a deleted project doesn't count.
  await prisma.project.create({ data: { code: 'WSGONE', name: 'WS gone', createdById: ids.ann!, managerId: ids.dan, deletedAt: new Date() } });
});

describe('Weekly summary people (integration)', () => {
  it('active staff with their roles, own time zone, settings and whether they run a live project', async () => {
    const all = (await people.list()).filter((p) => EMAILS.includes(p.email ?? ''));
    const by = new Map(all.map((p) => [p.email, p]));
    expect([...by.keys()].sort()).toEqual(['ws-ann@mico360.test', 'ws-ben@mico360.test', 'ws-cat@mico360.test', 'ws-dan@mico360.test']);
    expect(by.get('ws-ann@mico360.test')).toMatchObject({ roles: ['ADMIN'], runsProjects: false, timeZone: 'Asia/Dubai', prefs: { weeklySummary: false }, name: 'ann Weekly' });
    expect(by.get('ws-ben@mico360.test')).toMatchObject({ roles: [], runsProjects: true }); // owner
    expect(by.get('ws-cat@mico360.test')!.runsProjects).toBe(true); // MANAGER member
    expect(by.get('ws-dan@mico360.test')!.runsProjects).toBe(false); // a member, and a deleted project's manager
    expect((await people.find(ids.cat!))!.runsProjects).toBe(true);
    expect(await people.find(ids.eve!)).toBeNull();
  });
});

describe('Weekly summary records (integration)', () => {
  it('one per person and week: a second claim gets nothing', async () => {
    const row = await repo.claim(ids.ben!, '2026-10-25');
    expect(row).toMatchObject({ userId: ids.ben, week: '2026-10-25', status: 'SENDING', attempts: 1 });
    expect(await repo.claim(ids.ben!, '2026-10-25')).toBeNull();
    expect(await repo.claim(ids.ben!, '2026-11-01')).not.toBeNull();
    expect((await repo.forWeeks(['2026-10-25'])).filter((r) => r.userId === ids.ben).length).toBe(1);
  });

  it('a retry is taken by one sender only, and only its holder writes down how it went', async () => {
    const row = (await repo.claim(ids.cat!, '2026-10-25'))!;
    expect(await repo.finish(row, { status: 'RETRY', lastError: 'boom', nextAttemptAt: new Date('2026-10-25T02:05:00.000Z') })).toBe(true);
    const due = (await repo.dueForRetry(new Date('2026-10-25T02:05:00.000Z'), new Date('2026-10-25T01:50:00.000Z'))).filter((r) => r.userId === ids.cat);
    expect(due).toHaveLength(1);
    expect(await repo.dueForRetry(new Date('2026-10-25T02:04:00.000Z'), new Date('2026-10-25T01:50:00.000Z')).then((r) => r.filter((x) => x.userId === ids.cat))).toEqual([]);
    const taken = (await repo.retake(due[0]!))!;
    expect(taken).toMatchObject({ status: 'SENDING', attempts: 2 });
    expect(await repo.retake(due[0]!)).toBeNull();
    expect(await repo.finish(row, { status: 'SENT' })).toBe(false); // the first attempt no longer holds it
    expect(await repo.finish(taken, { status: 'SENT', projectCount: 3, sentAt: new Date() })).toBe(true);
    expect((await repo.forWeeks(['2026-10-25'])).find((r) => r.userId === ids.cat)).toMatchObject({ status: 'SENT', projectCount: 3, attempts: 2 });
  });
});
