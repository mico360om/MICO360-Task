import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaPeopleLookup, createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createPrismaMemberRepository, createPrismaProjectManagerLookup } from '../../src/modules/projects/prisma-member-repository';

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

  it('keeps the person who hands a project over on as a MANAGER, in the same write', async () => {
    // Not on the team yet: added as a manager.
    await projects.update(rig, { ownerId: id.member }, { keepManager: id.owner });
    // Already a plain member: promoted.
    await projects.update(rig, { managerId: null }, { keepManager: id.member });
    const rows = await prisma.projectMember.findMany({ where: { projectId: rig }, select: { userId: true, role: true } });
    expect(Object.fromEntries(rows.map((r) => [r.userId, r.role]))).toEqual({ [id.owner]: 'MANAGER', [id.lead]: 'MANAGER', [id.member]: 'MANAGER' });
    expect(await prisma.project.findUnique({ where: { id: rig }, select: { ownerId: true, managerId: true } })).toEqual({ ownerId: id.member, managerId: null });
  });

  it('knows whether someone else still runs a project', async () => {
    expect(await members.hasOtherRunner!(rig, id.lead)).toBe(true); // it has an owner
    await prisma.project.update({ where: { id: rig }, data: { ownerId: null, managerId: null } });
    expect(await members.hasOtherRunner!(rig, id.lead)).toBe(false); // the lead is the only one
    expect(await members.hasOtherRunner!(rig, id.member)).toBe(true); // the lead still runs it
  });
});
