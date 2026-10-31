import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  LIVE_PROJECT_WHERE,
  colleagueWhere,
  createCompanyAccess,
  inCompanyWhere,
  sharedCompanyWhere,
  teamWhere,
  visibleProjectWhere,
  type Viewer,
} from '../../src/modules/companies/company-access';
import { buildCompanyWorld, dropCompanyWorld, sorted, type CompanyWorld } from './company-world';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const access = createCompanyAccess(prisma);
let w: CompanyWorld;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
});
afterAll(async () => {
  if (w) await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

/** The world's projects a viewer gets for a pick (other tests' projects left out). */
const ids = async (viewer: Viewer, pick: string | null) => {
  const all = await access.visibleProjectIds(viewer, pick);
  const mine = Object.values(w.projects);
  return sorted((all ?? []).filter((id) => mine.includes(id)));
};
const colleagues = async (viewer: Viewer) =>
  sorted((await prisma.user.findMany({ where: { AND: [colleagueWhere(viewer.id), { id: { not: viewer.id } }] }, select: { id: true } })).map((u) => u.id));
const view = async (viewer: Viewer, meetingId: string) => {
  const m = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { attendees: { select: { userId: true } } } });
  return access.meetingView(viewer, {
    projectId: m.projectId,
    organizerId: m.organizerId,
    createdById: m.createdById,
    attendeeUserIds: m.attendees.flatMap((a) => (a.userId ? [a.userId] : [])),
  });
};

describe('The company access module (integration)', () => {
  it('visible projects per person and pick', async () => {
    const { ana, ben, bob, gus, cat, admin } = w.as;
    const { PA, PB, PAB, PC } = w.projects;
    const { A, B, C } = w.companies;
    expect(await ids(ana, null)).toEqual(sorted([PA, PAB]));
    expect(await ids(ben, null)).toEqual(sorted([PB, PAB]));
    expect(await ids(bob, null)).toEqual([]);
    expect(await ids(gus, null)).toEqual([]);
    expect(await ids(cat, null)).toEqual(sorted([PA, PB]));
    expect(await ids(cat, A)).toEqual([PA]);
    expect(await ids(cat, B)).toEqual([PB]);
    expect(await access.visibleProjectIds(admin, null)).toBeNull();
    expect(await ids(admin, A)).toEqual(sorted([PA, PAB]));
    expect(await ids(admin, C)).toEqual([PC]);
  });

  it('a pick is checked against active companies', async () => {
    const { ana, gus, admin, cat } = w.as;
    await expect(access.checkPick(ana, w.companies.B)).rejects.toMatchObject({ code: 'COMPANY_NOT_AVAILABLE' });
    await expect(access.checkPick(gus, w.companies.C)).rejects.toMatchObject({ code: 'COMPANY_NOT_AVAILABLE' });
    expect(await access.checkPick(admin, w.companies.C)).toBe(w.companies.C);
    await expect(access.checkPick(admin, 'nope')).rejects.toMatchObject({ code: 'COMPANY_NOT_AVAILABLE' });
    expect(await access.checkPick(cat, w.companies.B)).toBe(w.companies.B);
    expect(await access.checkPick(cat, null)).toBeNull();
  });

  it('a person’s active companies (archived ones give no access)', async () => {
    expect(sorted(await access.activeCompanyIds(w.people.cat))).toEqual(sorted([w.companies.A, w.companies.B]));
    expect(await access.activeCompanyIds(w.people.gus)).toEqual([]);
    expect(await access.activeCompanyIds(w.people.admin)).toEqual([]);
  });

  it('a pick never widens: a non-admin’s foreign pick matches nothing even where the project is visible', async () => {
    // ana sees PAB (through A); a stale pick of B must not show it under B.
    const scope = await access.projectScope(w.as.ana, w.companies.B);
    expect(await prisma.project.count({ where: { AND: [scope, { id: { in: Object.values(w.projects) } }] } })).toBe(0);
  });

  it('can see one project', async () => {
    expect(await access.canSeeProject(w.as.ana, w.projects.PAB)).toBe(true);
    expect(await access.canSeeProject(w.as.ana, w.projects.PB)).toBe(false);
    expect(await access.canSeeProject(w.as.gus, w.projects.PC)).toBe(false); // C is archived
    expect(await access.canSeeProject(w.as.admin, w.projects.PC)).toBe(true);
    expect(await access.canSeeProject(w.as.admin, 'missing')).toBe(false);
  });

  it('colleagues and known people', async () => {
    const { ana, ben, gus, admin } = w.as;
    const { amy, bob, cat } = w.people;
    expect(await colleagues(ana)).toEqual(sorted([amy, cat]));
    expect(await colleagues(ben)).toEqual(sorted([bob, cat]));
    expect(await colleagues(gus)).toEqual([]);
    expect(await access.knownPeople(ana)).toEqual(new Map([[amy, { colleague: true }], [cat, { colleague: true }], [w.people.ben, { colleague: false }]]));
    expect(await access.knownPeople(admin)).toBe('everyone');
  });

  it('is a colleague: shares an active company, or either one is an admin', async () => {
    expect(await access.isColleague(w.as.ana, w.people.amy)).toBe(true);
    expect(await access.isColleague(w.as.ana, w.people.ben)).toBe(false);
    expect(await access.isColleague(w.as.ana, w.people.admin)).toBe(true);
    expect(await access.isColleague(w.as.admin, w.people.gus)).toBe(true);
    expect(await access.isColleague(w.as.gus, w.people.amy)).toBe(false);
  });

  it('who can see a project', async () => {
    const { ana, ben, bob, cat, admin } = w.people;
    expect(sorted([...(await access.whoCanSeeProject(w.projects.PAB, [ana, ben, bob, cat, admin]))])).toEqual(sorted([ana, ben, admin]));
    expect(sorted([...(await access.whoCanSeeProject(w.projects.PC, [w.people.gus, admin]))])).toEqual([admin]);
  });

  it('people in a project’s companies', async () => {
    const people = await access.projectCompanyPeople([w.companies.A, w.companies.C]);
    const mine = Object.values(w.people);
    expect(sorted(people.filter((id) => mine.includes(id)))).toEqual(sorted([w.people.ana, w.people.amy, w.people.cat]));
  });

  it('meeting views', async () => {
    const { bob, ana, amy, admin } = w.as;
    expect(await view(bob, w.meetings.MA)).toBe('invitee');
    expect(await view(ana, w.meetings.MA)).toBe('full');
    expect(await view(ana, w.meetings.MN_A)).toBe('full');
    expect(await view(amy, w.meetings.MA)).toBeNull();
    expect(await view(admin, w.meetings.MB)).toBe('full');
  });

  it('the query pieces', async () => {
    const inWorld = { id: { in: Object.values(w.projects) } };
    const count = (where: object) => prisma.project.count({ where: { AND: [where, inWorld] } });
    expect(await count(teamWhere(w.people.cat))).toBe(2); // PA, PB
    expect(await count(sharedCompanyWhere(w.people.ana))).toBe(2); // PA, PAB (A)
    expect(await count(visibleProjectWhere(w.people.gus))).toBe(0);
    expect(await count(inCompanyWhere(w.companies.B))).toBe(2); // PB, PAB
    expect(await count(LIVE_PROJECT_WHERE)).toBe(3); // PC's only company is archived
  });
});
