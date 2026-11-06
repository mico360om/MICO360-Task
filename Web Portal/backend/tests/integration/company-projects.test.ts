import { checklistTreeOf as tree, flatTexts } from '../../src/modules/tasks/checklist-tree';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app';
import { createTokenService } from '../../src/modules/auth/token-service';
import { createAuthService } from '../../src/modules/auth/auth-service';
import type { AuditService } from '../../src/modules/audit/audit-service';
import { createActivityService } from '../../src/modules/activity/activity-service';
import { createPrismaActivityRepository } from '../../src/modules/activity/prisma-activity-repository';
import { createCompanyAccess } from '../../src/modules/companies/company-access';
import { createProjectCompanies } from '../../src/modules/companies/project-companies';
import { createPrismaPeopleLookup, createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createPrismaMemberRepository, createPrismaProjectExistsLookup, createPrismaProjectManagerLookup } from '../../src/modules/projects/prisma-member-repository';
import { createProjectService } from '../../src/modules/projects/project-service';
import { createMemberService } from '../../src/modules/projects/member-service';
import { createProjectAuthz } from '../../src/modules/projects/project-authz';
import { createPrismaTemplateRepository } from '../../src/modules/templates/prisma-template-repository';
import { createTemplateService } from '../../src/modules/templates/template-service';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. The whole HTTP stack for
// projects, wired as server.ts wires it, over the companies test world.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const tokenService = createTokenService({
  accessSecret: 'cp-access',
  refreshSecret: 'cp-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const audits: { module: string; action: string; entityId: string | null; oldValue?: unknown; newValue?: unknown }[] = [];
const auditService = {
  async record(d: { module: string; action: string; entityId?: string | null; oldValue?: unknown; newValue?: unknown }) {
    audits.push({ module: d.module, action: d.action, entityId: d.entityId ?? null, oldValue: d.oldValue, newValue: d.newValue });
    return {} as never;
  },
  async list() {
    return [];
  },
  async modules() {
    return [];
  },
} as unknown as AuditService;
const onAudience = vi.fn();
const people = createPrismaPeopleLookup(prisma);
const projectCompanies = createProjectCompanies(prisma, { site: async () => ({ timeZone: 'Asia/Muscat', weekStart: 0 }) });
const projectService = createProjectService({ projects: createPrismaProjectRepository(prisma), people, companies: projectCompanies });
const templateRepo = createPrismaTemplateRepository(prisma);

let w: CompanyWorld;
let app: Awaited<ReturnType<typeof buildApp>>;
const made: string[] = [];
const templates: string[] = [];

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  app = await buildApp({
    authService,
    tokenService,
    projectService,
    memberService: createMemberService({ repo: createPrismaMemberRepository(prisma), projects: createPrismaProjectExistsLookup(prisma), people }),
    projectAuthz: createProjectAuthz({ managers: createPrismaProjectManagerLookup(prisma) }),
    auditService,
    activityService: createActivityService({ activities: createPrismaActivityRepository(prisma) }),
    templateService: createTemplateService({ repo: templateRepo, canViewProject: async () => true, canManageProject: async () => true, people, workingDays: async () => [0, 1, 2, 3, 4], timeZone: 'Asia/Muscat' }),
    companyAccess: createCompanyAccess(prisma),
    projectCompanies,
    onProjectAudienceChanged: onAudience,
  });
});
afterAll(async () => {
  // Every project the world's people made here, whatever the answer said (a run before the rules
  // existed made some that were meant to be refused).
  if (w) {
    const extra = await prisma.project.findMany({ where: { createdById: { in: Object.values(w.people) }, id: { notIn: Object.values(w.projects) } }, select: { id: true } });
    made.push(...extra.map((x) => x.id));
  }
  await prisma.activity.deleteMany({ where: { projectId: { in: made } } });
  await prisma.task.deleteMany({ where: { projectId: { in: made } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: made } } });
  await prisma.project.deleteMany({ where: { id: { in: made } } });
  await prisma.projectTemplate.deleteMany({ where: { id: { in: templates } } });
  if (w) await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

type Who = keyof CompanyWorld['as'];
const as = (who: Who, extra: Record<string, string> = {}) => {
  const headers = async () => ({ authorization: `Bearer ${(await tokenService.issueTokens(w.as[who])).accessToken}`, ...extra });
  return {
    get: async (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: await headers() }),
    post: async (url: string, payload: object) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: await headers(), payload }),
    put: async (url: string, payload: object) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: await headers(), payload }),
  };
};
let seq = 0;
const p = (over: object = {}) => ({ code: `CP${w.tag.toUpperCase()}${++seq}`, name: `Company project ${seq}`, ...over });
const created = <R extends { statusCode: number; json: () => unknown }>(res: R): R => {
  if (res.statusCode === 201) made.push((res.json() as { data: { id: string } }).data.id);
  return res;
};
const companiesOf = (data: { companies: { id: string; isMain: boolean }[] }) => data.companies.map((c) => ({ id: c.id, isMain: c.isMain }));
const name = (letter: 'A' | 'B' | 'C') => `${{ A: 'Alpha', B: 'Beta', C: 'Gamma' }[letter]} ${w.tag}`;

describe('Projects’ companies (integration, over HTTP)', () => {
  it('a new project goes into the picked company, else the creator’s primary; an administrator names one', async () => {
    const { A, B } = w.companies;
    expect(companiesOf(created(await as('cat', { 'x-company-id': A }).post('/projects', p())).json().data)).toEqual([{ id: A, isMain: true }]);
    const second = created(await as('cat').post('/projects', p())).json().data;
    expect(companiesOf(second)).toEqual([{ id: B, isMain: true }]); // cat's primary company
    expect(second.mainCompanyId).toBe(B);
    const refused = await as('admin').post('/projects', p());
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toBe('Choose at least one company for this project.');
    expect(companiesOf(created(await as('admin').post('/projects', p({ companyIds: [B, A] }))).json().data)).toEqual([{ id: B, isMain: true }, { id: A, isMain: false }]);
  });

  it('an employee can’t put a project in someone else’s company; nobody can use an archived one', async () => {
    const { B, C } = w.companies;
    const foreign = await as('ana').post('/projects', p({ companyIds: [B] }));
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error).toMatchObject({ code: 'NOT_YOUR_COMPANY', message: 'You can only add or remove your own companies.' });
    expect((await as('ana', { 'x-company-id': B }).post('/projects', p())).json().error.code).toBe('COMPANY_NOT_AVAILABLE');
    const archived = await as('admin').post('/projects', p({ companyIds: [C] }));
    expect(archived.statusCode).toBe(400);
    expect(archived.json().error).toEqual({ code: 'COMPANY_ARCHIVED', message: `${name('C')} is archived.` });
    expect((await as('admin').post('/projects', p({ companyIds: ['nope'] }))).json().error.message).toBe('Company not found.');
  });

  it('the first company is the main one; changing them writes history and the audit log', async () => {
    const { A, B } = w.companies;
    const { PA } = w.projects;
    const r = (await as('admin').put(`/projects/${PA}`, { companyIds: [B, A] })).json().data;
    expect(r.mainCompanyId).toBe(B);
    expect(r.companies.map((c: { id: string; isMain: boolean }) => [c.id, c.isMain])).toEqual([[B, true], [A, false]]);
    const line = await prisma.activity.findFirstOrThrow({ where: { projectId: PA, action: 'PROJECT_COMPANIES_CHANGED' }, orderBy: { createdAt: 'desc' } });
    expect(line).toMatchObject({ taskId: null, userId: w.people.admin, meta: { added: [name('B')], removed: [], main: name('B') } });
    expect(audits.at(-1)).toMatchObject({ module: 'projects', action: 'project.companies', entityId: PA, oldValue: { companyIds: [A], mainCompanyId: A }, newValue: { companyIds: [B, A], mainCompanyId: B } });
    expect(onAudience).toHaveBeenCalledWith(PA);
    // Put back: B taken off, A main again (and nothing at all when nothing changes).
    const back = (await as('admin').put(`/projects/${PA}`, { companyIds: [A] })).json().data;
    expect(back.companies.map((c: { id: string }) => c.id)).toEqual([A]);
    expect((await prisma.activity.findFirstOrThrow({ where: { projectId: PA, action: 'PROJECT_COMPANIES_CHANGED' }, orderBy: { createdAt: 'desc' } })).meta).toEqual({ added: [], removed: [name('B')], main: name('A') });
    onAudience.mockClear();
    const count = audits.length;
    await as('admin').put(`/projects/${PA}`, { companyIds: [A], name: `Project PA ${w.tag}` });
    expect(onAudience).not.toHaveBeenCalled();
    expect(audits.slice(count).map((a) => a.action)).toEqual(['project.update']);
  });

  it('who runs a project may change its companies within their own, never so they lose it; others may not', async () => {
    const { A, B } = w.companies;
    const { PA } = w.projects;
    await prisma.projectMember.update({ where: { projectId_userId: { projectId: PA, userId: w.people.cat } }, data: { role: 'MANAGER' } });
    try {
      expect((await as('ana').put(`/projects/${PA}`, { companyIds: [A, B] })).statusCode).toBe(403); // a plain member
      const both = await as('cat').put(`/projects/${PA}`, { companyIds: [A, B] });
      expect(both.json().data.companies.map((c: { id: string }) => c.id)).toEqual([A, B]);
      expect((await as('cat').put(`/projects/${PA}`, { companyIds: [A] })).statusCode).toBe(200);
    } finally {
      await prisma.projectMember.update({ where: { projectId_userId: { projectId: PA, userId: w.people.cat } }, data: { role: 'MEMBER' } });
    }
    // ana runs a project whose main company is B: taking A off would hide it from her.
    const shared = created(await as('admin').post('/projects', p({ companyIds: [B, A], memberIds: [w.people.ana] }))).json().data;
    await prisma.projectMember.update({ where: { projectId_userId: { projectId: shared.id, userId: w.people.ana } }, data: { role: 'MANAGER' } });
    const lose = await as('ana').put(`/projects/${shared.id}`, { companyIds: [B] });
    expect(lose.statusCode).toBe(409);
    expect(lose.json().error).toEqual({ code: 'WOULD_LOSE_ACCESS', message: 'You’d lose access to this project. Ask an administrator to make this change.' });
    expect((await as('ana').put(`/projects/${shared.id}`, { companyIds: [A] })).json().error).toMatchObject({ code: 'NOT_YOUR_COMPANY' }); // B isn't hers to take off
    expect((await as('ana').put(`/projects/${shared.id}`, { companyIds: [A, B] })).json().data.mainCompanyId).toBe(A); // her own company as the main one
    expect((await as('admin').put(`/projects/${shared.id}`, { companyIds: [] })).statusCode).toBe(400);
  });

  it('team members must be in one of the project’s companies', async () => {
    const { A } = w.companies;
    const outside = await as('admin').post(`/projects/${w.projects.PA}/members`, { userIds: [w.people.bob] });
    expect(outside.statusCode).toBe(400);
    expect(outside.json().error.message).toBe('Bob Betaonly isn’t in any of this project’s companies.');
    expect((await as('admin').post('/projects', p({ companyIds: [A], ownerId: w.people.bob }))).json().error.message).toBe('Bob Betaonly isn’t in any of this project’s companies.');
    expect((await as('admin').post('/projects', p({ companyIds: [A], memberIds: [w.people.gus] }))).json().error.message).toBe('Gus Gammaonly isn’t in any of this project’s companies.');
    // A shared project's team can come from any of its companies.
    expect((await as('admin').post(`/projects/${w.projects.PAB}/members`, { userIds: [w.people.bob] })).statusCode).toBe(200);
    await prisma.projectMember.delete({ where: { projectId_userId: { projectId: w.projects.PAB, userId: w.people.bob } } });
  });

  it('a template project asks for its companies too', async () => {
    const { A } = w.companies;
    const tpl = await templateRepo.createProjectTemplate(
      { name: `Tpl ${w.tag}`, description: null, columns: [{ name: 'To Do', category: 'TODO', color: '#3A6EA5' }, { name: 'Done', category: 'DONE', color: '#2E7D53' }], roles: [], tasks: [{ title: 'First', description: null, priority: 'NORMAL', dueOffsetDays: 0, roleKey: null, checklists: tree([]) }] },
      w.people.admin,
    );
    templates.push(tpl.id);
    const fromTemplate = created(await as('admin').post(`/templates/projects/${tpl.id}/projects`, p({ startDate: '2026-11-01', companyIds: [A] }))).json().data;
    expect(companiesOf(fromTemplate)).toEqual([{ id: A, isMain: true }]);
    expect((await as('admin').post(`/templates/projects/${tpl.id}/projects`, p({ startDate: '2026-11-01' }))).json().error.message).toBe('Choose at least one company for this project.');
    expect(companiesOf(created(await as('ana').post(`/templates/projects/${tpl.id}/projects`, p({ startDate: '2026-11-01' }))).json().data)).toEqual([{ id: A, isMain: true }]); // her primary
  });

  it('the project page and lists carry its companies (main first) and whether it counts as archived', async () => {
    const { A, B } = w.companies;
    const one = (await as('ana').get(`/projects/${w.projects.PAB}`)).json().data;
    expect(one).toMatchObject({
      mainCompanyId: A,
      archived: false,
      companies: [
        { id: A, name: name('A'), code: `A${w.tag.toUpperCase()}`, logoUrl: null, isMain: true, timeZone: 'Asia/Muscat', weekStart: 0 },
        { id: B, name: name('B'), isMain: false, timeZone: 'Asia/Muscat', weekStart: 0 },
      ],
    });
    expect((await as('admin').get(`/projects/${w.projects.PC}`)).json().data).toMatchObject({ archived: true, companies: [{ id: w.companies.C, isMain: true }] });
    const listed = (await as('ben').get('/projects')).json().data.find((x: { id: string }) => x.id === w.projects.PAB);
    expect(listed).toMatchObject({ mainCompanyId: A, archived: false, companies: [{ id: A, isMain: true }, { id: B, isMain: false }] });
  });
});
