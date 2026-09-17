import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createProjectService } from './project-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { ProjectRecord, ProjectRepository, CreateProjectData } from './project-repository';
import type { TaskService } from '../tasks/task-service';
import type { AuditService } from '../audit/audit-service';

// Tasks the stub task service reports for the progress endpoint.
let projectTasks: { columnCategory?: string | null; dueDate?: Date | null }[] = [];
// Captured audit records for assertions.
let auditRecords: { userId?: string | null; action: string; module: string; entityId?: string | null }[] = [];

function inMemoryRepo(): ProjectRepository {
  const rows = new Map<string, ProjectRecord>();
  let seq = 0;
  return {
    async create(data: CreateProjectData) {
      const now = new Date();
      const rec: ProjectRecord = {
        id: `p${seq++}`,
        code: data.code,
        name: data.name,
        description: data.description ?? null,
        clientName: data.clientName ?? null,
        managerId: data.managerId ?? null,
        status: data.status ?? 'PLANNING',
        priority: data.priority ?? 'NORMAL',
        color: data.color ?? '#8B1E1E',
        imageUrl: null,
        ownerId: data.ownerId ?? null,
        startDate: data.startDate ?? null,
        targetDate: data.targetDate ?? null,
        notes: data.notes ?? null,
        createdById: data.createdById,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByCode(code) {
      return [...rows.values()].find((p) => p.code === code) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async listForUser(userId) {
      return [...rows.values()].filter((p) => p.ownerId === userId || p.managerId === userId || p.createdById === userId);
    },
    async isAccessibleTo(projectId, userId) {
      const p = rows.get(projectId);
      return p ? p.ownerId === userId || p.managerId === userId || p.createdById === userId : false;
    },
    async update(id, patch) {
      const updated = { ...rows.get(id)!, ...patch, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
    async softDelete(id) {
      rows.delete(id);
    },
  };
}

const tokenService = createTokenService({
  accessSecret: 'proj-access',
  refreshSecret: 'proj-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

async function makeApp() {
  const projectService = createProjectService({ projects: inMemoryRepo() });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  // Stub task service just for the progress endpoint (listTasks) + broadcast scoping (getTask).
  const taskService = {
    async listTasks() { return projectTasks; },
    async getTask() { return { projectId: 'p0' }; },
  } as unknown as TaskService;
  const auditService = {
    async record(d: { userId?: string | null; action: string; module: string; entityId?: string | null }) {
      auditRecords.push(d);
      return { ...d, id: 'a', createdAt: new Date() };
    },
    async list() { return auditRecords; },
  } as unknown as AuditService;
  return buildApp({ authService, tokenService, projectService, taskService, auditService });
}

async function createProject(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    headers: { authorization: `Bearer ${await token(['ADMIN'])}` },
    payload: { code: 'MICO', name: 'MICO360 Platform' },
  });
  return res.json().data.id;
}

async function token(roles: string[]) {
  return (await tokenService.issueTokens({ id: 'admin', roles })).accessToken;
}
async function tokenFor(id: string, roles: string[]) {
  return (await tokenService.issueTokens({ id, roles })).accessToken;
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  projectTasks = [];
  auditRecords = [];
  app = await makeApp();
});

describe('Project routes', () => {
  it('lets an admin create a project (201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${await token(['ADMIN'])}` },
      payload: { code: 'MICO', name: 'MICO360 Platform' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.code).toBe('MICO');
  });

  it('forbids an employee from creating a project (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` },
      payload: { code: 'X', name: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an unauthenticated create (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { code: 'X', name: 'X' } });
    expect(res.statusCode).toBe(401);
  });

  it('lets any authenticated user list projects (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects', headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it('shows an employee only the projects they belong to', async () => {
    const admin = { authorization: `Bearer ${await token(['ADMIN'])}` };
    // Two projects: one owned by emp1, one not theirs.
    await app.inject({ method: 'POST', url: '/api/v1/projects', headers: admin, payload: { code: 'MINE', name: 'Mine', ownerId: 'emp1' } });
    await app.inject({ method: 'POST', url: '/api/v1/projects', headers: admin, payload: { code: 'THEIRS', name: 'Not mine' } });

    const empRes = await app.inject({ method: 'GET', url: '/api/v1/projects', headers: { authorization: `Bearer ${await tokenFor('emp1', ['EMPLOYEE'])}` } });
    const codes = empRes.json().data.map((p: { code: string }) => p.code);
    expect(codes).toEqual(['MINE']);

    // The admin still sees both.
    const adminRes = await app.inject({ method: 'GET', url: '/api/v1/projects', headers: admin });
    expect(adminRes.json().data).toHaveLength(2);
  });

  it('404s when an employee opens a project they don’t belong to', async () => {
    const admin = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const created = await app.inject({ method: 'POST', url: '/api/v1/projects', headers: admin, payload: { code: 'SECRET', name: 'Secret' } });
    const id = created.json().data.id;
    const res = await app.inject({ method: 'GET', url: `/api/v1/projects/${id}`, headers: { authorization: `Bearer ${await tokenFor('emp1', ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(404);
  });

  it('lets an employee open a project they own', async () => {
    const admin = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const created = await app.inject({ method: 'POST', url: '/api/v1/projects', headers: admin, payload: { code: 'OWN', name: 'Owned', ownerId: 'emp1' } });
    const id = created.json().data.id;
    const res = await app.inject({ method: 'GET', url: `/api/v1/projects/${id}`, headers: { authorization: `Bearer ${await tokenFor('emp1', ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.code).toBe('OWN');
  });

  it('returns 404 for an unknown project', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/nope', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('lets an admin archive a project (status → ARCHIVED)', async () => {
    const id = await createProject();
    const res = await app.inject({ method: 'POST', url: `/api/v1/projects/${id}/archive`, headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('ARCHIVED');
  });

  it('exposes per-project progress to any authenticated user', async () => {
    const id = await createProject();
    projectTasks = [
      { columnCategory: 'DONE' },
      { columnCategory: 'IN_PROGRESS' },
      { columnCategory: 'TODO', dueDate: new Date('2000-01-01') }, // overdue
    ];
    const res = await app.inject({ method: 'GET', url: `/api/v1/projects/${id}/progress`, headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ total: 3, completed: 1, inProgress: 1, overdue: 1, completionPct: 33 });
  });

  it('404s progress for an unknown project', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/ghost/progress', headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(404);
  });

  it('writes an audit record (user + action + module + entity) on project create, update, archive, delete', async () => {
    const id = await createProject();
    await app.inject({ method: 'PUT', url: `/api/v1/projects/${id}`, headers: { authorization: `Bearer ${await token(['ADMIN'])}` }, payload: { name: 'Renamed' } });
    await app.inject({ method: 'POST', url: `/api/v1/projects/${id}/archive`, headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    await app.inject({ method: 'DELETE', url: `/api/v1/projects/${id}`, headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });

    const actions = auditRecords.filter((r) => r.module === 'projects').map((r) => r.action);
    expect(actions).toEqual(['project.create', 'project.update', 'project.archive', 'project.delete']);
    expect(auditRecords.every((r) => r.userId === 'admin')).toBe(true); // token id is 'admin'
    expect(auditRecords[0]!.entityId).toBe(id);
  });
});
