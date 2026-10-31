import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_COMPANY } from '../../src/modules/companies/default-company';
import { createPrismaBootstrapRepo } from '../../src/modules/auth/prisma-bootstrap-repo';
import { runBackfill as runBackfillOn } from './company-helpers';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied (`migrate deploy` has already run
// the backfill once, on whatever the database held then). Rows made here afterwards have no company, as
// rows on a site upgraded from 1.20 do; the backfill file is then run again, statement by statement.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

const TAG = 'cmig';
const OTHER = `company_${TAG}_other`;
const fixture = {
  userIds: [] as string[],
  projectIds: [] as string[],
  standaloneMeetingId: '',
  projectMeetingId: '',
  taskNoticeId: '',
  projectNoticeId: '',
  channelNoticeId: '',
  dmNoticeId: '',
};
let u2 = '';
let p2 = '';

const runBackfill = () => runBackfillOn(prisma);

async function counts() {
  const [companies, members, projectCompanies, noMain, noPrimary, noMeetingCompany, noNoticeProject] = await Promise.all([
    prisma.company.count(),
    prisma.companyMember.count(),
    prisma.projectCompany.count(),
    prisma.project.count({ where: { mainCompanyId: null } }),
    prisma.user.count({ where: { primaryCompanyId: null } }),
    prisma.meeting.count({ where: { projectId: null, companyId: null } }),
    prisma.notification.count({ where: { projectId: null } }),
  ]);
  return { companies, members, projectCompanies, noMain, noPrimary, noMeetingCompany, noNoticeProject };
}
const membershipsOf = async (userId: string) =>
  (await prisma.companyMember.findMany({ where: { userId }, select: { companyId: true } })).map((m) => m.companyId).sort();
const companiesOfProject = async (projectId: string) =>
  (await prisma.projectCompany.findMany({ where: { projectId }, select: { companyId: true } })).map((m) => m.companyId).sort();

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const projects = await prisma.project.findMany({ where: { code: { startsWith: TAG.toUpperCase() } }, select: { id: true } });
  const projectIds = projects.map((p) => p.id);
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.meeting.deleteMany({ where: { organizerId: { in: userIds } } });
  await prisma.conversation.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { participants: { some: { userId: { in: userIds } } } }] } });
  await prisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.company.deleteMany({ where: { id: OTHER } });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
  const user = async (name: string, extra: { status?: 'ACTIVE' | 'INACTIVE'; deletedAt?: Date } = {}) =>
    (await prisma.user.create({ data: { email: `${name}@${TAG}.test`, username: `${TAG}_${name}`, passwordHash: 'x', firstName: name, lastName: 'Mig', ...extra } })).id;
  const admin = await user('admin');
  const adminRole = await prisma.role.upsert({ where: { name: 'ADMIN' }, update: {}, create: { name: 'ADMIN' } });
  await prisma.userRole.create({ data: { userId: admin, roleId: adminRole.id } });
  const emp = await user('emp');
  const inactive = await user('inactive', { status: 'INACTIVE' });
  const gone = await user('gone', { deletedAt: new Date() });
  fixture.userIds = [admin, emp, inactive, gone];

  const project = async (code: string, extra: { deletedAt?: Date } = {}) =>
    (await prisma.project.create({ data: { code, name: `Migration ${code}`, createdById: admin, ...extra } })).id;
  const p1 = await project(`${TAG.toUpperCase()}1`);
  const pGone = await project(`${TAG.toUpperCase()}D`, { deletedAt: new Date() });
  fixture.projectIds = [p1, pGone];
  const column = await prisma.kanbanColumn.create({ data: { projectId: p1, name: 'To Do', category: 'TODO', position: 0 } });
  const task = await prisma.task.create({ data: { key: `${TAG.toUpperCase()}1-1`, title: 'Survey', projectId: p1, columnId: column.id, createdById: admin } });

  fixture.standaloneMeetingId = (await prisma.meeting.create({ data: { title: 'Weekly', organizerId: emp, createdById: emp, startAt: new Date() } })).id;
  fixture.projectMeetingId = (await prisma.meeting.create({ data: { title: 'Kick-off', projectId: p1, organizerId: emp, createdById: emp, startAt: new Date() } })).id;

  const channel = await prisma.conversation.create({ data: { kind: 'PROJECT', projectId: p1 } });
  const dm = await prisma.conversation.create({ data: { kind: 'DIRECT', participants: { create: [{ userId: emp }, { userId: admin }] } } });
  const notice = async (entityType: string, entityId: string) =>
    (await prisma.notification.create({ data: { userId: emp, type: 'TEST', title: 'Test', entityType, entityId } })).id;
  fixture.taskNoticeId = await notice('task', task.id);
  fixture.projectNoticeId = await notice('project', p1);
  fixture.channelNoticeId = await notice('conversation', channel.id);
  fixture.dmNoticeId = await notice('conversation', dm.id);

  // Someone and something that already belong to another company (added before the run).
  await prisma.company.create({ data: { id: OTHER, name: `Other ${TAG}`, code: 'CMIGOTHER' } });
  u2 = await user('u2');
  await prisma.companyMember.create({ data: { companyId: OTHER, userId: u2 } });
  p2 = await project(`${TAG.toUpperCase()}2`);
  await prisma.projectCompany.create({ data: { projectId: p2, companyId: OTHER } });
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('The multi-company backfill (integration)', () => {
  it('a database with no rows still gets the default company', async () => {
    // `migrate deploy` ran the backfill on an empty database: the default company exists.
    expect(await prisma.company.count({ where: { id: DEFAULT_COMPANY.id } })).toBe(1);
  });

  it('backfill links everything to Prolens Projects LLC', async () => {
    await runBackfill();
    const c = await prisma.company.findUniqueOrThrow({ where: { id: DEFAULT_COMPANY.id } });
    expect(c).toMatchObject({ name: 'Prolens Projects LLC', code: 'PPL', status: 'ACTIVE', weekStart: null, workingHours: null, logoUrl: null, senderName: null });
    for (const u of fixture.userIds)
      expect(await prisma.user.findUniqueOrThrow({ where: { id: u }, select: { primaryCompanyId: true, companies: true } })).toMatchObject({
        primaryCompanyId: c.id,
        companies: [expect.objectContaining({ companyId: c.id })],
      });
    for (const p of fixture.projectIds)
      expect(await prisma.project.findUniqueOrThrow({ where: { id: p }, select: { mainCompanyId: true, companies: true } })).toMatchObject({
        mainCompanyId: c.id,
        companies: [expect.objectContaining({ companyId: c.id })],
      });
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: fixture.standaloneMeetingId } })).companyId).toBe(c.id);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: fixture.projectMeetingId } })).companyId).toBeNull();
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: fixture.taskNoticeId } })).projectId).toBe(fixture.projectIds[0]);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: fixture.projectNoticeId } })).projectId).toBe(fixture.projectIds[0]);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: fixture.channelNoticeId } })).projectId).toBe(fixture.projectIds[0]);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: fixture.dmNoticeId } })).projectId).toBeNull();
  });

  it('backfill is safe to run twice', async () => {
    await runBackfill();
    const before = await counts();
    await runBackfill();
    await runBackfill();
    expect(await counts()).toEqual(before);
  });

  it('backfill leaves people and projects that already have a company alone', async () => {
    await runBackfill();
    expect(await membershipsOf(u2)).toEqual([OTHER]);
    expect(await companiesOfProject(p2)).toEqual([OTHER]);
    // …and gives them their main / primary company from what they already have.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u2 } })).primaryCompanyId).toBe(OTHER);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p2 } })).mainCompanyId).toBe(OTHER);
  });

  it('a first admin made on a fresh site joins the oldest active company, as their primary company', async () => {
    const { id } = await createPrismaBootstrapRepo(prisma).createAdmin({ email: `first@${TAG}.test`, username: `${TAG}_first`, passwordHash: 'x', firstName: 'First', lastName: 'Admin' });
    expect(await prisma.user.findUniqueOrThrow({ where: { id }, select: { primaryCompanyId: true, companies: { select: { companyId: true } } } })).toEqual({
      primaryCompanyId: DEFAULT_COMPANY.id,
      companies: [{ companyId: DEFAULT_COMPANY.id }],
    });
  });
});
