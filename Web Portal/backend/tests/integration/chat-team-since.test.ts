import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaChatMemberLookup } from '../../src/modules/chat/prisma-chat-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Since when someone has been on each project's team: what the chat's unread counts start from.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const lookup = createPrismaChatMemberLookup(prisma);
const CODES = ['TSONE', 'TSTWO', 'TSTHREE'];
const EMAILS = ['ts-owner@mico360.test', 'ts-member@mico360.test', 'ts-admin@mico360.test', 'ts-manager@mico360.test'];
let owner = '';
let member = '';
let admin = '';
let manager = '';
let one = '';
let two = '';
let three = '';
const CREATED_ONE = new Date('2026-03-01T08:00:00Z');
const CREATED_TWO = new Date('2026-04-01T08:00:00Z');
const MEMBER_ADDED = new Date('2026-05-10T10:30:00Z');

async function cleanup() {
  const ps = await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } });
  const ids = ps.map((p) => p.id);
  await prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  const us = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  await prisma.userRole.deleteMany({ where: { userId: { in: us.map((u) => u.id) } } });
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
  const user = (email: string) => prisma.user.create({ data: { email, username: email.split('@')[0]!, passwordHash: 'x', firstName: 'T', lastName: 'S' } });
  owner = (await user(EMAILS[0]!)).id;
  member = (await user(EMAILS[1]!)).id;
  admin = (await user(EMAILS[2]!)).id;
  manager = (await user(EMAILS[3]!)).id;
  const adminRole = await prisma.role.upsert({ where: { name: 'ADMIN' }, update: {}, create: { name: 'ADMIN' } });
  await prisma.userRole.create({ data: { userId: admin, roleId: adminRole.id } });
  one = (await prisma.project.create({ data: { code: 'TSONE', name: 'Team since one', createdById: owner, ownerId: owner, managerId: manager, createdAt: CREATED_ONE } })).id;
  two = (await prisma.project.create({ data: { code: 'TSTWO', name: 'Team since two', createdById: owner, createdAt: CREATED_TWO } })).id;
  three = (await prisma.project.create({ data: { code: 'TSTHREE', name: 'Team since three (deleted)', createdById: owner, deletedAt: new Date() } })).id;
  await prisma.projectMember.create({ data: { projectId: one, userId: member, addedAt: MEMBER_ADDED } });
  await prisma.projectMember.create({ data: { projectId: three, userId: member, addedAt: MEMBER_ADDED } });
});

describe('teamSince', () => {
  it('a member: from when they were added', async () => {
    const team = await lookup.teamSince!(member);
    expect(team.get(one)?.toISOString()).toBe(MEMBER_ADDED.toISOString());
    expect(team.has(two)).toBe(false);
  });

  it('the owner or manager: from when the project was made', async () => {
    expect((await lookup.teamSince!(owner)).get(one)?.toISOString()).toBe(CREATED_ONE.toISOString());
    expect((await lookup.teamSince!(manager)).get(one)?.toISOString()).toBe(CREATED_ONE.toISOString());
  });

  it('having created a project is not being on its team (an administrator sets projects up for others)', async () => {
    expect((await lookup.teamSince!(owner)).has(two)).toBe(false); // created it, not its owner, manager or a member
  });

  it('an administrator who is not on a project’s team: absent (they can open it, but it never counts)', async () => {
    const team = await lookup.teamSince!(admin);
    expect(team.has(one)).toBe(false);
    expect(team.has(two)).toBe(false);
    expect(await lookup.canAccessProject(one, admin)).toBe(true);
  });

  it('a deleted project is not a team anyone is on', async () => {
    expect((await lookup.teamSince!(member)).has(three)).toBe(false);
  });
});
