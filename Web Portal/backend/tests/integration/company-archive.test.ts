import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app';
import { createTokenService } from '../../src/modules/auth/token-service';
import { createAuthService } from '../../src/modules/auth/auth-service';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createProjectService } from '../../src/modules/projects/project-service';
import { createTaskMoveService } from '../../src/modules/tasks/task-move-service';
import { createPrismaTaskMoveRepository } from '../../src/modules/tasks/prisma-task-move-repository';
import { createPrismaRecurrencePort } from '../../src/modules/tasks/prisma-recurrence-port';
import { createPrismaWorkloadStore } from '../../src/modules/planning/prisma-workload-store';
import { createClientAccessService } from '../../src/modules/client-view/client-access-service';
import { createPrismaClientShareStore } from '../../src/modules/client-view/prisma-client-share-store';
import { createPrismaClientViewSource } from '../../src/modules/client-view/client-view-source';
import { createInspectionService } from '../../src/modules/inspections/inspection-service';
import { createPrismaInspectionStore } from '../../src/modules/inspections/prisma-inspection-store';
import { createInspectionPorts } from '../../src/modules/inspections/prisma-inspection-ports';
import { createPrismaDailyEmailSources } from '../../src/modules/daily-emails/prisma-daily-email-sources';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createTaskSearchEngine } from '../../src/modules/search/task-search-engine';
import { createPrismaManagementSource } from '../../src/modules/management/prisma-management-source';
import { createPrismaMicoAiData } from '../../src/modules/mico-ai/prisma-mico-ai-data';
import { createProjectAccess } from '../../src/modules/projects/project-access';
import { createPrismaProjectManagerLookup } from '../../src/modules/projects/prisma-member-repository';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// companies (Task 4): a project counts as archived when its own status is ARCHIVED or ALL its
// companies are — everywhere the server asks (Gamma is archived; PC lives only in Gamma; PX in Alpha
// and Gamma). Nothing is written onto the project: unarchiving the company restores it.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const tokenService = createTokenService({
  accessSecret: 'archive-access',
  refreshSecret: 'archive-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const projectService = createProjectService({ projects: createPrismaProjectRepository(prisma) });
const moveService = createTaskMoveService({ repo: createPrismaTaskMoveRepository(prisma) });
const recurrencePort = createPrismaRecurrencePort(prisma);
const workloadStore = createPrismaWorkloadStore(prisma);
const clientAccess = createClientAccessService({
  store: createPrismaClientShareStore(prisma),
  source: createPrismaClientViewSource(prisma),
  mailer: { isConfigured: () => true, sendClientInvitation: async () => 'sent' as const, sendClientCode: async () => {} },
  userName: async () => 'Admin',
  appUrl: 'http://app.test',
  assetUrl: 'http://api.test',
  timeZone: 'Asia/Muscat',
});
const yes = async () => true;
const inspections = createInspectionService({
  store: createPrismaInspectionStore(prisma),
  ports: createInspectionPorts({
    prisma,
    access: { canViewProject: yes, canViewTask: yes },
    authz: { canManageProject: yes },
    tasks: { createTask: async () => { throw new Error('not in this test'); } },
    columns: { listColumns: async () => [] },
    assignees: { eligibleAssignees: async () => [], assertAssignable: async () => [], notifyAssigned: async () => {} },
    broadcast: () => {},
    userNames: async () => new Map(),
  }),
});
const dailySources = createPrismaDailyEmailSources(prisma);
const management = createPrismaManagementSource(prisma, 'Asia/Muscat');
const micoData = createPrismaMicoAiData({
  prisma,
  projectAccess: createProjectAccess({ projects: createPrismaProjectRepository(prisma), managers: createPrismaProjectManagerLookup(prisma) }),
  meetingAccess: { canViewMeeting: async () => false, canEditMeeting: async () => false },
  conversationIdsFor: async () => [],
});
const statusIn = async (projectId: string) => ({
  management: (await management.projects(null)).find((p) => p.id === projectId)?.status,
  micoAi: (await micoData.projects([projectId]))[0]?.status,
});
const searchIndex = createTaskSearchIndex({ prisma });
const searchEngine = createTaskSearchEngine({ prisma, index: searchIndex, timeZone: 'Asia/Muscat' });

let w: CompanyWorld;
let PX = '';
let seriesPC = '';
let formId = '';
let app: Awaited<ReturnType<typeof buildApp>>;

const moveTargets = async (viewer: { id: string; roles: string[] }) => (await moveService.targets(viewer)).projects.map((p) => p.id);
const projectRoutesGet = async (viewer: { id: string; roles: string[] }, projectId: string) => {
  const token = (await tokenService.issueTokens({ id: viewer.id, roles: viewer.roles })).accessToken;
  const res = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}`, headers: { authorization: `Bearer ${token}` } });
  expect(res.statusCode).toBe(200);
  return res.json().data as { id: string; status: string; archived: boolean };
};
const projectRoutesList = async (viewer: { id: string; roles: string[] }) => {
  const token = (await tokenService.issueTokens({ id: viewer.id, roles: viewer.roles })).accessToken;
  const res = await app.inject({ method: 'GET', url: '/api/v1/projects', headers: { authorization: `Bearer ${token}` } });
  return new Map((res.json().data as { id: string; archived: boolean }[]).map((p) => [p.id, p.archived]));
};

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  const T = w.tag.toUpperCase();
  const px = await prisma.project.create({
    data: {
      code: `PX${T}`,
      name: `Project PX ${w.tag}`,
      status: 'ACTIVE',
      createdById: w.people.admin,
      mainCompanyId: w.companies.A,
      companies: { create: [{ companyId: w.companies.A }, { companyId: w.companies.C }] },
      members: { create: { userId: w.people.ana, role: 'MEMBER' } },
    },
  });
  PX = px.id;
  await prisma.kanbanColumn.create({ data: { projectId: PX, name: 'To Do', category: 'TODO', position: 0 } });
  // A repeating task in PC: its series makes no more copies while PC counts as archived.
  const column = await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: w.projects.PC } });
  seriesPC = (
    await prisma.task.create({
      data: { key: `SPC${T}-1`, title: 'Weekly ZZGAMMA check', projectId: w.projects.PC, columnId: column.id, createdById: w.people.gus, recurrenceRule: { freq: 'WEEKLY', interval: 1 } as Prisma.InputJsonValue },
    })
  ).id;
  // TC1 is due tomorrow and open: it is in gus's pending tasks only while PC is live.
  await prisma.task.update({ where: { id: w.tasks.TC1 }, data: { dueDate: new Date(Date.now() + 86_400_000) } });
  formId = (await prisma.inspectionForm.create({ data: { title: 'Deck check', sections: [], createdById: w.people.admin } })).id;
  for (const taskId of Object.values(w.tasks)) await searchIndex.taskChanged(taskId);
  app = await buildApp({ authService, tokenService, projectService, appConfig: { timeZone: 'Asia/Muscat', productName: 'MICO360 Tasks', companyName: 'MICO360' } });
});

afterAll(async () => {
  await app?.close();
  await prisma.inspectionForm.deleteMany({ where: { id: formId } });
  await prisma.task.deleteMany({ where: { projectId: PX } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: PX } });
  await prisma.project.deleteMany({ where: { id: PX } });
  await prisma.company.update({ where: { id: w.companies.C }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('archived = own status or all companies archived (companies)', () => {
  it('a project whose companies are all archived counts as archived everywhere', async () => {
    const { admin, gus } = w.as;
    const PC = w.projects.PC;
    expect(await moveTargets(admin)).not.toContain(PC);
    expect((await recurrencePort.listSeriesHeads()).map((t) => t.id)).not.toContain(seriesPC);
    expect((await workloadStore.liveProjects(null)).map((p) => p.id)).not.toContain(PC);
    await expect(clientAccess.share({ projectId: PC, name: 'X', email: 'x@mico360.test', actorId: admin.id })).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    await expect(inspections.start(admin, PC, { formId })).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    expect((await projectRoutesGet(admin, PC)).archived).toBe(true);
    expect((await projectRoutesGet(admin, PC)).status).toBe('ACTIVE'); // never rewritten
    expect((await projectRoutesList(admin)).get(PC)).toBe(true);
    expect((await dailySources.tasks.pending(gus.id)).map((t) => t.id)).not.toContain(w.tasks.TC1);
    const found = await searchEngine.search({ q: 'ZZGAMMA', scope: { projectIds: null }, limit: 20 });
    expect(found.hits.map((h) => h.id)).not.toContain(w.tasks.TC1);
    const withArchived = await searchEngine.search({ q: 'ZZGAMMA', scope: { projectIds: null }, includeArchived: true, limit: 20 });
    expect(withArchived.hits.find((h) => h.id === w.tasks.TC1)?.project.archived).toBe(true);
    // Management (its status filter and label) and MICO AI describe it as Archived.
    expect(await statusIn(PC)).toEqual({ management: 'ARCHIVED', micoAi: 'ARCHIVED' });
    expect(await statusIn(PX)).toEqual({ management: 'ACTIVE', micoAi: 'ACTIVE' });
  });

  it('one active company keeps it live; unarchiving restores it', async () => {
    const { admin, gus } = w.as;
    const PC = w.projects.PC;
    expect((await projectRoutesGet(admin, PX)).archived).toBe(false);
    expect(await moveTargets(admin)).toContain(PX);
    expect((await projectRoutesGet(admin, w.projects.PA)).archived).toBe(false);
    await prisma.company.update({ where: { id: w.companies.C }, data: { status: 'ACTIVE', archivedAt: null } });
    try {
      expect((await projectRoutesGet(admin, PC)).archived).toBe(false);
      expect(await moveTargets(admin)).toContain(PC);
      expect((await recurrencePort.listSeriesHeads()).map((t) => t.id)).toContain(seriesPC);
      expect((await workloadStore.liveProjects(null)).map((p) => p.id)).toContain(PC);
      expect((await dailySources.tasks.pending(gus.id)).map((t) => t.id)).toContain(w.tasks.TC1);
      const found = await searchEngine.search({ q: 'ZZGAMMA', scope: { projectIds: null }, limit: 20 });
      expect(found.hits.find((h) => h.id === w.tasks.TC1)?.project.archived).toBe(false);
      expect(await statusIn(PC)).toEqual({ management: 'ACTIVE', micoAi: 'ACTIVE' });
    } finally {
      await prisma.company.update({ where: { id: w.companies.C }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    }
  });

  it('moving tasks: someone who runs a project only in a company they no longer have can’t move its tasks', async () => {
    const PC = w.projects.PC;
    await prisma.project.update({ where: { id: PC }, data: { ownerId: w.people.gus } });
    try {
      // gus owns PC, but his only company (Gamma) is archived: he manages nothing he can see.
      expect((await moveService.targets(w.as.gus)).managedProjectIds).not.toContain(PC);
      await prisma.company.update({ where: { id: w.companies.C }, data: { status: 'ACTIVE', archivedAt: null } });
      expect((await moveService.targets(w.as.gus)).managedProjectIds).toContain(PC);
    } finally {
      await prisma.company.update({ where: { id: w.companies.C }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
      await prisma.project.update({ where: { id: PC }, data: { ownerId: null } });
    }
  });

  it('its own ARCHIVED status still archives it, whatever its companies', async () => {
    const { admin } = w.as;
    await prisma.project.update({ where: { id: PX }, data: { status: 'ARCHIVED' } });
    try {
      expect((await projectRoutesGet(admin, PX)).archived).toBe(true);
      expect(await moveTargets(admin)).not.toContain(PX);
    } finally {
      await prisma.project.update({ where: { id: PX }, data: { status: 'ACTIVE' } });
    }
  });
});
