import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createPrismaProjectManagerLookup } from '../../src/modules/projects/prisma-member-repository';
import { createProjectAccess } from '../../src/modules/projects/project-access';
import { createProjectService } from '../../src/modules/projects/project-service';
import { managedProjectsWhere, managedVisibleWhere } from '../../src/modules/projects/project-managers';
import { createPrismaChatMemberLookup } from '../../src/modules/chat/prisma-chat-repository';
import { createPrismaAssigneeRepository, projectAudienceIds } from '../../src/modules/tasks/prisma-assignee-repository';
import { activeCompaniesOf, taskAudienceSelect, toAudienceFacts } from '../../src/modules/notifications/prisma-task-audience';
import { filterTaskRecipients } from '../../src/modules/notifications/recipient-access';
import { createPrismaMicoAiData } from '../../src/modules/mico-ai/prisma-mico-ai-data';
import { createPrismaApprovalSource } from '../../src/modules/tasks/prisma-approval-source';
import { createPrismaWorkloadStore } from '../../src/modules/planning/prisma-workload-store';
import { createPrismaWeeklySummaryPeople } from '../../src/modules/management/prisma-weekly-summary';
import { createPrismaManagementSource } from '../../src/modules/management/prisma-management-source';
import { createPrismaUserRepository } from '../../src/modules/users/prisma-user-repository';
import { DEFAULT_COMPANY } from '../../src/modules/companies/default-company';
import { buildCompanyWorld, dropCompanyWorld, sorted, type CompanyWorld } from './company-world';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// A project is visible to a non-admin only when they are on its team AND share an active company
// with it — in every copy of the team rule.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaProjectRepository(prisma);
const managers = createPrismaProjectManagerLookup(prisma);
const projectAccess = createProjectAccess({ projects: repo, managers });
const projectService = createProjectService({ projects: repo });
const chatLookup = createPrismaChatMemberLookup(prisma);
const assignees = createPrismaAssigneeRepository(prisma);
const micoData = createPrismaMicoAiData({
  prisma,
  projectAccess,
  meetingAccess: { canViewMeeting: async () => false, canEditMeeting: async () => false },
  conversationIdsFor: async () => [],
});
const approvals = createPrismaApprovalSource(prisma, { canManageProject: async () => false });
const workload = createPrismaWorkloadStore(prisma);
const weekly = createPrismaWeeklySummaryPeople(prisma);
const management = createPrismaManagementSource(prisma, 'Asia/Muscat');
let w: CompanyWorld;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
});
afterAll(async () => {
  if (w) await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

const inWorld = (ids: readonly string[]) => sorted(ids.filter((id) => Object.values(w.projects).includes(id)));
const ofWorld = (ids: Iterable<string>) => sorted([...ids].filter((id) => Object.values(w.people).includes(id)));
/** Takes cat out of Beta for the duration of `run`, then puts her back. */
async function withoutCatInBeta(run: () => Promise<void>) {
  await prisma.companyMember.delete({ where: { companyId_userId: { companyId: w.companies.B, userId: w.people.cat } } });
  try {
    await run();
  } finally {
    await prisma.companyMember.create({ data: { companyId: w.companies.B, userId: w.people.cat } });
  }
}

describe('Project visibility follows companies (integration)', () => {
  it('team AND a shared active company: ana sees PA and PAB, never PB or PC', async () => {
    const { ana } = w.people;
    expect(await repo.isAccessibleTo(w.projects.PB, ana)).toBe(false);
    expect(await repo.isAccessibleTo(w.projects.PAB, ana)).toBe(true);
    expect(inWorld((await repo.listForUser(ana)).map((p) => p.id))).toEqual(sorted([w.projects.PA, w.projects.PAB]));
    expect(await repo.isAccessibleTo(w.projects.PC, w.people.gus)).toBe(false); // Gamma is archived
  });

  it('being on the team is not enough once the company is lost', async () => {
    expect(await repo.isAccessibleTo(w.projects.PB, w.people.cat)).toBe(true);
    await withoutCatInBeta(async () => {
      expect(await repo.isAccessibleTo(w.projects.PB, w.people.cat)).toBe(false); // next call, no cache
      expect(await projectAccess.canViewTask(w.people.cat, ['EMPLOYEE'], w.tasks.TB2)).toBe(false);
      expect(await chatLookup.canAccessProject(w.projects.PB, w.people.cat)).toBe(false);
    });
  });

  it('the project service: lists follow the pick; admins with a pick get that company only', async () => {
    const ids = async (user: { id: string; roles: string[] }, pick?: string | null) => inWorld((await projectService.listVisibleProjects(user, pick)).map((p) => p.id));
    expect(await ids(w.as.cat)).toEqual(sorted([w.projects.PA, w.projects.PB]));
    expect(await ids(w.as.cat, w.companies.B)).toEqual([w.projects.PB]);
    expect(await ids(w.as.admin, w.companies.A)).toEqual(sorted([w.projects.PA, w.projects.PAB]));
    expect(await ids(w.as.admin)).toEqual(sorted(Object.values(w.projects)));
    await expect(projectService.getVisibleProject(w.projects.PB, w.as.ana)).rejects.toMatchObject({ status: 404 });
  });

  it('an admin with a pick gets only that company’s ids', async () => {
    expect(sorted((await projectAccess.accessibleProjectIds(w.people.admin, ['ADMIN'], w.companies.A))!)).toEqual(sorted([w.projects.PA, w.projects.PAB]));
    expect(await projectAccess.accessibleProjectIds(w.people.admin, ['ADMIN'])).toBeNull();
    expect(inWorld((await projectAccess.accessibleProjectIds(w.people.cat, ['EMPLOYEE'], w.companies.A))!)).toEqual([w.projects.PA]);
  });

  it('chat: PB’s channel is closed to ana; PAB’s is open to ana and ben', async () => {
    const { ana, ben, cat, gus } = w.people;
    expect(await chatLookup.canAccessProject(w.projects.PB, ana)).toBe(false);
    expect(await chatLookup.canAccessProject(w.projects.PAB, ben)).toBe(true);
    expect(sorted(await chatLookup.projectMemberIds!(w.projects.PAB))).toEqual(sorted([ana, ben]));
    expect(inWorld(await chatLookup.accessibleProjectIds(ana))).toEqual(sorted([w.projects.PA, w.projects.PAB]));
    expect(inWorld([...(await chatLookup.teamSince!(cat)).keys()])).toEqual(sorted([w.projects.PA, w.projects.PB]));
    expect([...(await chatLookup.teamSince!(gus)).keys()]).toEqual([]);
    expect(await chatLookup.canAccessProject(w.projects.PC, w.people.admin)).toBe(true);
  });

  it('task audience and assignees: nobody who can’t see the project', async () => {
    const { ana, ben, bob, cat, amy, admin } = w.people;
    const t = await prisma.task.findFirstOrThrow({ where: { id: w.tasks.TB1 }, select: taskAudienceSelect });
    const ids = [ana, ben, cat, admin];
    expect(sorted(filterTaskRecipients(ids, toAudienceFacts(t), { adminIds: [admin], companiesOf: await activeCompaniesOf(prisma, ids) }))).toEqual(sorted([ben, cat, admin]));
    expect(sorted(await assignees.eligibleUserIds!(w.projects.PAB, [ana, ben, bob, cat, amy]))).toEqual(sorted([ana, ben]));
    expect(ofWorld(await projectAudienceIds(prisma, w.projects.PAB))).toEqual(sorted([ana, ben, admin]));
    await withoutCatInBeta(async () => {
      const tb2 = await prisma.task.findFirstOrThrow({ where: { id: w.tasks.TB2 }, select: taskAudienceSelect });
      expect(filterTaskRecipients([cat], toAudienceFacts(tb2), { adminIds: [], companiesOf: await activeCompaniesOf(prisma, [cat]) })).toEqual([]); // her own task
    });
  });

  it('MICO AI data and managed-project lists stay inside the person’s companies', async () => {
    expect(sorted((await micoData.accessibleProjectIds({ userId: w.people.ana, roles: [] }))!)).toEqual(sorted([w.projects.PA, w.projects.PAB]));
    // gus runs PC (made its manager here) but Gamma is archived: he manages it on paper only.
    await prisma.project.update({ where: { id: w.projects.PC }, data: { managerId: w.people.gus } });
    try {
      expect(await prisma.project.count({ where: { AND: [managedProjectsWhere(w.people.gus), { id: w.projects.PC }] } })).toBe(1);
      expect(await prisma.project.count({ where: { AND: [managedVisibleWhere(w.people.gus), { id: w.projects.PC }] } })).toBe(0);
      expect(await managers.managesProject(w.people.gus, w.projects.PC)).toBe(false);
      expect(await approvals.canApproveAny({ id: w.people.gus, roles: ['EMPLOYEE'] })).toBe(false);
      expect(await workload.managedProjectIds(w.people.gus)).toEqual([]);
      expect((await weekly.find(w.people.gus))?.runsProjects).toBe(false);
      expect(await management.runCount(w.people.gus)).toBe(0);
      expect(await approvals.approvers(w.projects.PC)).not.toContain(w.people.gus); // told: the admins instead
    } finally {
      await prisma.project.update({ where: { id: w.projects.PC }, data: { managerId: null } });
    }
    expect(await managers.managesProject(w.people.ben, w.projects.PB)).toBe(true);
    expect((await weekly.find(w.people.ben))?.runsProjects).toBe(true);
  });

  it('a new project joins its creator’s primary company', async () => {
    const p = await repo.create({ code: `NP${w.tag.toUpperCase()}`, name: 'New project', createdById: w.people.cat, members: [{ userId: w.people.cat, role: 'MANAGER' }] });
    try {
      expect(await prisma.project.findUniqueOrThrow({ where: { id: p.id }, select: { mainCompanyId: true, companies: { select: { companyId: true } } } })).toEqual({
        mainCompanyId: w.companies.B,
        companies: [{ companyId: w.companies.B }],
      });
      expect(await repo.isAccessibleTo(p.id, w.people.cat)).toBe(true);
    } finally {
      await prisma.kanbanColumn.deleteMany({ where: { projectId: p.id } });
      await prisma.project.delete({ where: { id: p.id } });
    }
  });

  it('on a site with one active company, new projects and people go into it (as before: nothing to choose)', async () => {
    // Only the default company stays active for this test; the others are put back afterwards.
    const others = (await prisma.company.findMany({ where: { status: 'ACTIVE', id: { not: DEFAULT_COMPANY.id } }, select: { id: true } })).map((c) => c.id);
    await prisma.company.updateMany({ where: { id: { in: others } }, data: { status: 'ARCHIVED' } });
    const made: { users: string[]; projects: string[] } = { users: [], projects: [] };
    try {
      const u = await createPrismaUserRepository(prisma).create({ email: `solo.${w.tag}@world.test`, username: `solo_${w.tag}`, passwordHash: 'x', firstName: 'Solo', lastName: 'One', roleNames: ['EMPLOYEE'] });
      made.users.push(u.id);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { primaryCompanyId: true, companies: { select: { companyId: true } } } })).toEqual({
        primaryCompanyId: DEFAULT_COMPANY.id,
        companies: [{ companyId: DEFAULT_COMPANY.id }],
      });
      const p = await repo.create({ code: `SP${w.tag.toUpperCase()}`, name: 'Solo project', createdById: w.people.admin, members: [{ userId: u.id, role: 'MEMBER' }] });
      made.projects.push(p.id);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).mainCompanyId).toBe(DEFAULT_COMPANY.id);
      expect(await repo.isAccessibleTo(p.id, u.id)).toBe(true);
    } finally {
      await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: made.projects } } });
      await prisma.project.deleteMany({ where: { id: { in: made.projects } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: made.users } } });
      await prisma.user.deleteMany({ where: { id: { in: made.users } } });
      await prisma.company.updateMany({ where: { id: { in: others } }, data: { status: 'ACTIVE' } });
    }
  });
});
