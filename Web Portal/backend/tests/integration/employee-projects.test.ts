import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaPeopleLookup, createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createPrismaMemberRepository, createPrismaProjectManagerLookup, projectRunnerIds } from '../../src/modules/projects/prisma-member-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const projects = createPrismaProjectRepository(prisma);
const managers = createPrismaProjectManagerLookup(prisma);
const members = createPrismaMemberRepository(prisma);
const people = createPrismaPeopleLookup(prisma);

const CODES = ['EMPA', 'EMPB', 'EMPC'];
const EMAIL = (n: string) => `emp-projects-${n}@mico360.test`;
const NAMES = ['creator', 'owner', 'named', 'lead', 'member', 'outsider', 'inactive', 'suspended', 'deleted'] as const;
const id: Record<(typeof NAMES)[number], string> = {} as never;
let rig = '';

async function cleanup() {
  const ps = await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } });
  const ids = ps.map((p) => p.id);
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { in: NAMES.map(EMAIL) } } });
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
  for (const n of NAMES) {
    const extra = n === 'inactive' ? { status: 'INACTIVE' as const } : n === 'suspended' ? { status: 'SUSPENDED' as const } : n === 'deleted' ? { deletedAt: new Date() } : {};
    id[n] = (await prisma.user.create({ data: { email: EMAIL(n), username: `emp-projects-${n}`, passwordHash: 'x', firstName: n, lastName: 'Test', ...extra } })).id;
  }
  rig = (await prisma.project.create({ data: { code: 'EMPA', name: 'Rig', createdById: id.creator, ownerId: id.owner, managerId: id.named } })).id;
  await prisma.projectMember.create({ data: { projectId: rig, userId: id.lead, role: 'MANAGER' } });
  await prisma.projectMember.create({ data: { projectId: rig, userId: id.member, role: 'MEMBER' } });
});

describe('Employee projects (integration)', () => {
  it('creates a project and its team in one write', async () => {
    const created = await projects.create({
      code: 'EMPB',
      name: 'Created by an employee',
      createdById: id.creator,
      ownerId: id.owner,
      members: [{ userId: id.creator, role: 'MANAGER' }, { userId: id.owner, role: 'MEMBER' }],
    });
    const rows = await prisma.projectMember.findMany({ where: { projectId: created.id }, select: { userId: true, role: true } });
    expect(Object.fromEntries(rows.map((r) => [r.userId, r.role]))).toEqual({ [id.creator]: 'MANAGER', [id.owner]: 'MEMBER' });
    expect(await prisma.kanbanColumn.count({ where: { projectId: created.id } })).toBe(5);
    // The creator and the team see it at once.
    expect(await projects.isAccessibleTo(created.id, id.owner)).toBe(true);
    expect((await projects.listForUser(id.creator)).map((p) => p.id)).toContain(created.id);
  });

  it('a code clash creates neither the project nor any member row', async () => {
    await expect(projects.create({ code: 'EMPA', name: 'Clash', createdById: id.creator, members: [{ userId: id.outsider, role: 'MEMBER' }] })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.projectMember.count({ where: { userId: id.outsider } })).toBe(0);
  });

  it('one definition of who runs a project: owner, named manager or MANAGER member', async () => {
    for (const n of ['owner', 'named', 'lead'] as const) expect(await managers.managesProject(id[n], rig), n).toBe(true);
    for (const n of ['member', 'outsider', 'creator'] as const) expect(await managers.managesProject(id[n], rig), n).toBe(false);
    const other = (await prisma.project.create({ data: { code: 'EMPC', name: 'Other', createdById: id.creator, ownerId: id.lead } })).id;
    expect((await managers.managedAmong!(id.lead, [rig, other])).sort()).toEqual([rig, other].sort());
    expect(await managers.managedAmong!(id.member, [rig, other])).toEqual([]);
    // A deleted project is nobody's to run.
    await prisma.project.update({ where: { id: rig }, data: { deletedAt: new Date() } });
    expect(await managers.managesProject(id.owner, rig)).toBe(false);
    expect(await managers.managedAmong!(id.lead, [rig, other])).toEqual([other]);
  });

  it('only active people can be picked', async () => {
    const asked = [id.owner, id.inactive, id.suspended, id.deleted, 'no-such-user'];
    expect(await people.activeIds(asked)).toEqual([id.owner]);
    expect(await people.activeIds([])).toEqual([]);
  });

  it('keeps the people who held the owner and manager places on as MANAGERs, in the same write', async () => {
    // The owner had no team row: added as a manager. The named manager is a plain member: promoted.
    await prisma.projectMember.create({ data: { projectId: rig, userId: id.named, role: 'MEMBER' } });
    await projects.update(rig, { ownerId: id.member, managerId: null }, { keepManagers: [id.owner, id.named] });
    const rows = await prisma.projectMember.findMany({ where: { projectId: rig }, select: { userId: true, role: true } });
    expect(Object.fromEntries(rows.map((r) => [r.userId, r.role]))).toEqual({ [id.owner]: 'MANAGER', [id.named]: 'MANAGER', [id.lead]: 'MANAGER', [id.member]: 'MEMBER' });
    expect(await prisma.project.findUnique({ where: { id: rig }, select: { ownerId: true, managerId: true } })).toEqual({ ownerId: id.member, managerId: null });
  });

  it('does not put a deleted person back on the team', async () => {
    await prisma.project.update({ where: { id: rig }, data: { ownerId: id.deleted } });
    await projects.update(rig, { ownerId: id.member }, { keepManagers: [id.deleted] });
    expect(await prisma.projectMember.count({ where: { projectId: rig, userId: id.deleted } })).toBe(0);
    expect((await prisma.project.findUnique({ where: { id: rig }, select: { ownerId: true } }))!.ownerId).toBe(id.member);
  });

  it('refuses to take the last active runner off a project, in one locked write', async () => {
    // It has an owner: the lead may step down.
    await members.changeGuarded!(rig, id.lead, { role: 'MEMBER' });
    expect((await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: rig, userId: id.lead } } }))!.role).toBe('MEMBER');
    // No owner and a named manager who has left: they don't count, so the only MANAGER can't go.
    await prisma.projectMember.update({ where: { projectId_userId: { projectId: rig, userId: id.lead } }, data: { role: 'MANAGER' } });
    await prisma.project.update({ where: { id: rig }, data: { ownerId: null, managerId: id.inactive } });
    await expect(members.changeGuarded!(rig, id.lead, { remove: true })).rejects.toMatchObject({ status: 409, code: 'LAST_PROJECT_MANAGER' });
    await expect(members.changeGuarded!(rig, id.lead, { role: 'MEMBER' })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.projectMember.count({ where: { projectId: rig, userId: id.lead, role: 'MANAGER' } })).toBe(1);
    // A plain member comes and goes as before.
    await members.changeGuarded!(rig, id.member, { remove: true });
    expect(await prisma.projectMember.count({ where: { projectId: rig, userId: id.member } })).toBe(0);
  });

  it('lets only one of two managers stepping down at once go, when one of them must stay', async () => {
    await prisma.project.update({ where: { id: rig }, data: { ownerId: null, managerId: null } });
    await prisma.projectMember.update({ where: { projectId_userId: { projectId: rig, userId: id.member } }, data: { role: 'MANAGER' } });
    const results = await Promise.allSettled([members.changeGuarded!(rig, id.lead, { role: 'MEMBER' }), members.changeGuarded!(rig, id.member, { remove: true })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(['LAST_PROJECT_MANAGER']);
    expect(await prisma.projectMember.count({ where: { projectId: rig, role: 'MANAGER' } })).toBe(1);
  });

  it('names who runs each project — owner, named manager and MANAGER members, active ones only', async () => {
    const other = (await prisma.project.create({ data: { code: 'EMPC', name: 'Other', createdById: id.creator, ownerId: id.inactive, managerId: id.lead } })).id;
    const runners = await projectRunnerIds(prisma, [rig, other]);
    expect([...(runners.get(rig) ?? [])].sort()).toEqual([id.owner, id.named, id.lead].sort());
    expect(runners.get(other)).toEqual([id.lead]); // the deactivated owner is left out
    expect((await projectRunnerIds(prisma, [])).size).toBe(0);
  });
});
