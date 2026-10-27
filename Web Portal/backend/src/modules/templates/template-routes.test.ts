import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createProjectService } from '../projects/project-service';
import type { CreateProjectData, ProjectRecord, ProjectRepository } from '../projects/project-repository';
import type { AuditService } from '../audit/audit-service';
import { createTemplateService } from './template-service';
import { createMemoryTemplateRepository } from './memory-template-repository';

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const NOW = new Date('2026-10-27T06:00:00Z');

// People: an administrator; "lead" runs Rig 7; "member" is on its team; "outsider" isn't; "gone" is inactive.
const ACTIVE = new Set(['admin', 'lead', 'member', 'outsider', 'omar', 'sara']);
const sees = (userId: string, roles: string[]) => roles.includes('ADMIN') || userId === 'lead' || userId === 'member';
const runs = (userId: string, roles: string[]) => roles.includes('ADMIN') || userId === 'lead';

let created: CreateProjectData[] = [];
let audit: { action: string; module: string; entityId?: string | null; userId?: string | null; newValue?: unknown; oldValue?: unknown }[] = [];
let notices: { actorId: string; userIds: string[] }[] = [];

function projectRepo(): ProjectRepository {
  const rows = new Map<string, ProjectRecord>();
  return {
    async create(data) {
      created.push(data);
      const at = new Date();
      const rec: ProjectRecord = {
        id: `p${rows.size + 1}`, code: data.code, number: null, name: data.name, description: data.description ?? null, clientName: null, managerId: null,
        ownerId: data.ownerId ?? null, status: data.status ?? 'PLANNING', priority: data.priority ?? 'NORMAL', color: '#8B1E1E', icon: null, imageUrl: null,
        startDate: data.startDate ?? null, targetDate: null, notes: null, carryForward: data.carryForward ?? true, defaultDueToday: data.defaultDueToday ?? false,
        createdById: data.createdById, createdAt: at, updatedAt: at,
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async findByCode(code) { return [...rows.values()].find((p) => p.code === code) ?? null; },
    async list() { return [...rows.values()]; },
    async listForUser() { return []; },
    async isAccessibleTo() { return false; },
    async update(id, patch) { const p = { ...rows.get(id)!, ...patch }; rows.set(id, p); return p; },
    async softDelete(id) { rows.delete(id); },
  };
}

const tokenService = createTokenService({
  accessSecret: 'tpl-access',
  refreshSecret: 'tpl-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const auth = async (id: string, roles: string[] = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });
const asAdmin = () => auth('admin', ['ADMIN']);

let repo: ReturnType<typeof createMemoryTemplateRepository>;
async function makeApp() {
  repo = createMemoryTemplateRepository({
    projects: [
      {
        id: 'p-rig', name: 'Rig 7', startDate: day('2026-11-01'), createdAt: new Date('2026-10-20T08:00:00Z'),
        columns: [{ name: 'To Do', category: 'TODO', color: '#3A6EA5' }, { name: 'Done', category: 'DONE', color: '#2E7D53' }],
        tasks: [{ id: 't1', title: 'Kick-off', description: null, priority: 'HIGH', dueDate: day('2026-11-03'), assigneeIds: ['sara'], checklist: ['Agenda'] }],
      },
    ],
    tasks: [{ id: 't1', projectId: 'p-rig', title: 'Kick-off', description: null, priority: 'HIGH', checklist: ['Agenda'] }],
  });
  const people = { activeIds: async (ids: string[]) => ids.filter((id) => ACTIVE.has(id)) };
  const templateService = createTemplateService({
    repo,
    canViewProject: async (u, r) => sees(u, r),
    canManageProject: async (u, r) => runs(u, r),
    people,
    workingDays: async () => [0, 1, 2, 3, 4],
    timeZone: 'Asia/Muscat',
    now: () => NOW,
  });
  const projectService = createProjectService({ projects: projectRepo(), people });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const auditService = {
    async record(d: (typeof audit)[number]) { audit.push(d); return { ...d, id: 'a', createdAt: new Date() }; },
    async list() { return []; },
  } as unknown as AuditService;
  return buildApp({
    authService,
    tokenService,
    projectService,
    templateService,
    auditService,
    projectNotices: {
      async projectCreated({ actorId, userIds }: { actorId: string; userIds: string[] }) { notices.push({ actorId, userIds }); },
      async membersAdded() {},
    } as never,
  });
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  created = [];
  audit = [];
  notices = [];
  app = await makeApp();
});

const projectTemplate = {
  name: 'Rig inspection',
  description: 'Our standard inspection',
  columns: [{ name: 'To Do', category: 'TODO', color: '#3A6EA5' }, { name: 'Done', category: 'DONE', color: '#2E7D53' }],
  roles: [{ key: 'insp', name: 'Inspector' }, { key: 'lead', name: 'Site lead' }],
  tasks: [
    { title: 'Kick-off', priority: 'HIGH', dueOffsetDays: 0, roleKey: 'lead', checklist: ['Agenda'] },
    { title: 'Inspect', description: 'Walk the site', dueOffsetDays: 5, roleKey: 'insp', checklist: ['Valves', 'Pumps'] },
    { title: 'Report', dueOffsetDays: null },
  ],
};
const taskTemplate = { name: 'Weekly site check', title: 'Site check', description: 'Walk round', priority: 'HIGH', checklist: ['Gate', 'Fence'] };

async function adminTemplate(): Promise<{ id: string; roles: { id: string; name: string }[] }> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/templates/projects', headers: await asAdmin(), payload: projectTemplate });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

describe('Template routes: who may do what', () => {
  it('everything needs a sign-in', async () => {
    for (const url of ['/api/v1/templates/projects', '/api/v1/templates/tasks']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
  });

  it('everyone can list, open and preview templates', async () => {
    const t = await adminTemplate();
    const headers = await auth('outsider');
    const list = await app.inject({ method: 'GET', url: '/api/v1/templates/projects', headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toMatchObject([{ id: t.id, name: 'Rig inspection', taskCount: 3, roleCount: 2, columnCount: 2, canManage: false }]);
    const one = await app.inject({ method: 'GET', url: `/api/v1/templates/projects/${t.id}`, headers });
    expect(one.json().data.tasks).toHaveLength(3);
    const plan = await app.inject({ method: 'GET', url: `/api/v1/templates/projects/${t.id}/plan?start=2026-11-01`, headers });
    expect(plan.statusCode).toBe(200);
    expect(plan.json().data.tasks.map((x: { dueDate: string | null }) => x.dueDate)).toEqual(['2026-11-01', '2026-11-08', null]);
    expect((await app.inject({ method: 'GET', url: `/api/v1/templates/projects/${t.id}/plan?start=2026-02-30`, headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/templates/projects/nope', headers })).statusCode).toBe(404);
  });

  it('only an administrator creates a template from scratch', async () => {
    for (const who of ['lead', 'member', 'outsider']) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/templates/projects', headers: await auth(who), payload: projectTemplate });
      expect(res.statusCode, who).toBe(403);
      const task = await app.inject({ method: 'POST', url: '/api/v1/templates/tasks', headers: await auth(who), payload: taskTemplate });
      expect(task.statusCode, who).toBe(403);
    }
    expect((await app.inject({ method: 'POST', url: '/api/v1/templates/tasks', headers: await asAdmin(), payload: taskTemplate })).statusCode).toBe(201);
  });

  it('refuses a template that breaks its rules, in plain words', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/templates/projects', headers: await asAdmin(), payload: { ...projectTemplate, roles: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/names a role this template doesn’t have/);
    const tooMany = { ...projectTemplate, tasks: Array.from({ length: 501 }, (_, i) => ({ title: `T${i}` })) };
    expect((await app.inject({ method: 'POST', url: '/api/v1/templates/projects', headers: await asAdmin(), payload: tooMany })).statusCode).toBe(400);
  });

  it('takes a 200-task template in one request', async () => {
    const big = { ...projectTemplate, tasks: Array.from({ length: 200 }, (_, i) => ({ title: `Task ${i + 1}`, description: 'x'.repeat(2000), dueOffsetDays: i, checklist: ['a', 'b', 'c'] })) };
    const res = await app.inject({ method: 'POST', url: '/api/v1/templates/projects', headers: await asAdmin(), payload: big });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.taskCount).toBe(200);
  });

  it('the maker and administrators change and delete a template; nobody else', async () => {
    const saved = await app.inject({ method: 'POST', url: '/api/v1/templates/projects/from-project/p-rig', headers: await auth('lead'), payload: { name: 'Lead’s template', roles: [] } });
    expect(saved.statusCode).toBe(201);
    const id = saved.json().data.id;
    const edit = { ...projectTemplate, name: 'Renamed' };
    for (const who of ['member', 'outsider']) {
      expect((await app.inject({ method: 'PUT', url: `/api/v1/templates/projects/${id}`, headers: await auth(who), payload: edit })).statusCode, who).toBe(403);
      expect((await app.inject({ method: 'DELETE', url: `/api/v1/templates/projects/${id}`, headers: await auth(who) })).statusCode, who).toBe(403);
    }
    expect((await app.inject({ method: 'PUT', url: `/api/v1/templates/projects/${id}`, headers: await auth('lead'), payload: edit })).json().data.name).toBe('Renamed');
    expect((await app.inject({ method: 'PUT', url: `/api/v1/templates/projects/${id}`, headers: await asAdmin(), payload: { ...edit, name: 'By admin' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/templates/projects/${id}`, headers: await auth('lead') })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/templates/projects/${id}`, headers: await auth('lead') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/templates/projects/${id}`, headers: await asAdmin(), payload: edit })).statusCode).toBe(404);
  });

  it('saving a project as a template: whoever runs it; a plain member is refused; an outsider gets “not found”', async () => {
    const payload = { name: 'Rig standard', roles: [{ userId: 'sara', name: 'Inspector' }] };
    expect((await app.inject({ method: 'POST', url: '/api/v1/templates/projects/from-project/p-rig', headers: await auth('member'), payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/templates/projects/from-project/p-rig', headers: await auth('outsider'), payload })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/templates/projects/from-project/p-rig', headers: await auth('member') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/templates/projects/from-project/p-rig', headers: await auth('outsider') })).statusCode).toBe(404);
    const draft = await app.inject({ method: 'GET', url: '/api/v1/templates/projects/from-project/p-rig', headers: await auth('lead') });
    expect(draft.json().data).toMatchObject({ taskCount: 1, base: { day: '2026-11-01', from: 'start' }, people: [{ id: 'sara', taskCount: 1 }] });
    const res = await app.inject({ method: 'POST', url: '/api/v1/templates/projects/from-project/p-rig', headers: await auth('lead'), payload });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ name: 'Rig standard', createdById: 'lead', canManage: true, roles: [{ name: 'Inspector' }], tasks: [{ title: 'Kick-off', dueOffsetDays: 2, checklist: ['Agenda'] }] });
    expect((await app.inject({ method: 'POST', url: '/api/v1/templates/projects/from-project/p-rig', headers: await asAdmin(), payload })).statusCode).toBe(201);
  });

  it('saving a task as a template: whoever runs its project', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/templates/tasks/from-task/t1', headers: await auth('member'), payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/templates/tasks/from-task/t1', headers: await auth('outsider'), payload: {} })).statusCode).toBe(404);
    const res = await app.inject({ method: 'POST', url: '/api/v1/templates/tasks/from-task/t1', headers: await auth('lead'), payload: { name: 'Kick-off meeting' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ name: 'Kick-off meeting', title: 'Kick-off', priority: 'HIGH', checklist: ['Agenda'], canManage: true });
    const id = res.json().data.id;
    expect((await app.inject({ method: 'PUT', url: `/api/v1/templates/tasks/${id}`, headers: await auth('member'), payload: taskTemplate })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/templates/tasks/${id}`, headers: await auth('lead'), payload: taskTemplate })).statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/v1/templates/tasks', headers: await auth('outsider') });
    expect(list.json().data).toMatchObject([{ id, name: 'Weekly site check', checklist: ['Gate', 'Fence'], canManage: false }]);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/templates/tasks/${id}`, headers: await auth('outsider') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/templates/tasks/${id}`, headers: await asAdmin() })).statusCode).toBe(204);
  });
});

describe('Template routes: making a project from a template', () => {
  it('anyone can: one write with the template’s board and tasks, the role fillers on the team', async () => {
    const t = await adminTemplate();
    const insp = t.roles.find((r) => r.name === 'Inspector')!.id;
    const lead = t.roles.find((r) => r.name === 'Site lead')!.id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/templates/projects/${t.id}/projects`,
      headers: await auth('outsider'),
      payload: { code: 'RIG8', name: 'Rig 8', startDate: '2026-11-01', roles: { [insp]: 'omar', [lead]: 'omar' }, memberIds: ['sara'] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ code: 'RIG8', name: 'Rig 8', ownerId: 'outsider', startDate: '2026-11-01T00:00:00.000Z', canManage: true, taskCount: 3 });
    expect(created).toHaveLength(1);
    const data = created[0]!;
    // The creator runs it; the team they picked and the role fillers join it.
    expect(data.members).toEqual([{ userId: 'outsider', role: 'MANAGER' }, { userId: 'sara', role: 'MEMBER' }, { userId: 'omar', role: 'MEMBER' }]);
    expect(data.startWith!.columns.map((c) => c.name)).toEqual(['To Do', 'Done']);
    expect(data.startWith!.tasks.map((x) => [x.title, x.dueDate?.toISOString().slice(0, 10) ?? null, x.assigneeIds, x.checklist])).toEqual([
      ['Kick-off', '2026-11-01', ['omar'], ['Agenda']],
      ['Inspect', '2026-11-08', ['omar'], ['Valves', 'Pumps']],
      ['Report', null, null, []],
    ]);
    expect(audit.filter((a) => a.module === 'projects')).toEqual([
      expect.objectContaining({ action: 'project.create_from_template', module: 'projects', entityId: 'p1', userId: 'outsider', newValue: expect.objectContaining({ code: 'RIG8', template: { id: t.id, name: 'Rig inspection' }, startDate: '2026-11-01', taskCount: 3, roles: [{ role: 'Inspector', userId: 'omar' }, { role: 'Site lead', userId: 'omar' }] }) }),
    ]);
    expect(notices).toEqual([{ actorId: 'outsider', userIds: ['outsider', 'sara', 'omar'] }]);
  });

  it('refuses an inactive person for a role, and a template that is gone', async () => {
    const t = await adminTemplate();
    const insp = t.roles.find((r) => r.name === 'Inspector')!.id;
    const bad = await app.inject({ method: 'POST', url: `/api/v1/templates/projects/${t.id}/projects`, headers: await auth('lead'), payload: { code: 'RIG9', name: 'Rig 9', startDate: '2026-11-01', roles: { [insp]: 'gone' } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toBe('The person picked for Inspector isn’t an active user. Pick someone else.');
    expect(created).toHaveLength(0);
    const gone = await app.inject({ method: 'POST', url: '/api/v1/templates/projects/nope/projects', headers: await auth('lead'), payload: { code: 'RIG9', name: 'Rig 9', startDate: '2026-11-01' } });
    expect(gone.statusCode).toBe(404);
    const noDate = await app.inject({ method: 'POST', url: `/api/v1/templates/projects/${t.id}/projects`, headers: await auth('lead'), payload: { code: 'RIG9', name: 'Rig 9' } });
    expect(noDate.statusCode).toBe(400);
  });

  it('deleting the template afterwards leaves the project as it is', async () => {
    const t = await adminTemplate();
    await app.inject({ method: 'POST', url: `/api/v1/templates/projects/${t.id}/projects`, headers: await auth('lead'), payload: { code: 'RIGX', name: 'Rig X', startDate: '2026-11-01' } });
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/templates/projects/${t.id}`, headers: await asAdmin() })).statusCode).toBe(204);
    const project = await app.inject({ method: 'GET', url: '/api/v1/projects/p1', headers: await asAdmin() });
    expect(project.json().data).toMatchObject({ code: 'RIGX', name: 'Rig X' });
  });
});

describe('Template routes: the audit log', () => {
  it('records creating, changing and deleting templates', async () => {
    const t = await adminTemplate();
    await app.inject({ method: 'PUT', url: `/api/v1/templates/projects/${t.id}`, headers: await asAdmin(), payload: { ...projectTemplate, name: 'Renamed' } });
    await app.inject({ method: 'DELETE', url: `/api/v1/templates/projects/${t.id}`, headers: await asAdmin() });
    const task = await app.inject({ method: 'POST', url: '/api/v1/templates/tasks/from-task/t1', headers: await auth('lead'), payload: {} });
    const taskId = task.json().data.id;
    await app.inject({ method: 'PUT', url: `/api/v1/templates/tasks/${taskId}`, headers: await auth('lead'), payload: taskTemplate });
    await app.inject({ method: 'DELETE', url: `/api/v1/templates/tasks/${taskId}`, headers: await auth('lead') });
    expect(audit.map((a) => [a.action, a.module, a.userId])).toEqual([
      ['template.project.create', 'templates', 'admin'],
      ['template.project.update', 'templates', 'admin'],
      ['template.project.delete', 'templates', 'admin'],
      ['template.task.create', 'templates', 'lead'],
      ['template.task.update', 'templates', 'lead'],
      ['template.task.delete', 'templates', 'lead'],
    ]);
    expect(audit[0]!.newValue).toMatchObject({ name: 'Rig inspection', taskCount: 3, roles: ['Inspector', 'Site lead'] });
    expect(audit[1]!).toMatchObject({ oldValue: { name: 'Rig inspection' }, newValue: { name: 'Renamed' } });
    expect(audit[3]!.newValue).toMatchObject({ name: 'Kick-off', fromTask: 't1' });
  });
});
