import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createTaskService } from './task-service';
import { createTagService } from './tag-service';
import { createMemoryTagRepository } from './tag-repository';
import { createAssigneeService } from './assignee-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { CreateTaskData, TaskRecord, TaskRepository, ProjectLookup } from './task-repository';
import type { AssigneeRepository, AssigneeUser } from './assignee-repository';

function inMemory() {
  const rows = new Map<string, TaskRecord>();
  let seq = 0;
  const tasks: TaskRepository = {
    async create(data: CreateTaskData) {
      const now = new Date();
      const rec: TaskRecord = {
        id: `t${seq++}`,
        key: data.key,
        title: data.title,
        description: data.description ?? null,
        projectId: data.projectId,
        columnId: data.columnId,
        position: 0,
        priority: data.priority ?? 'NORMAL',
        startDate: data.startDate ?? null,
        dueDate: data.dueDate ?? null,
        estimatedHours: data.estimatedHours ?? null,
        actualHours: null,
        progress: data.progress ?? 0,
        createdById: data.createdById,
        completedAt: null,
        boardDate: data.boardDate ?? null,
        recurrenceRule: data.recurrenceRule ?? null,
        recurrenceParentId: data.recurrenceParentId ?? null,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list(filter) {
      return [...rows.values()].filter((t) => (filter.projectId ? t.projectId === filter.projectId : true));
    },
    async update(id, patch) {
      const updated = { ...rows.get(id)!, ...patch, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
    async softDelete(id) {
      rows.delete(id);
    },
    async updateSeries(seriesId, patch) {
      for (const [mid, row] of rows) {
        if (row.id === seriesId || row.recurrenceParentId === seriesId) rows.set(mid, { ...row, ...patch, updatedAt: new Date() });
      }
    },
    async softDeleteSeries(seriesId) {
      for (const [mid, row] of [...rows]) {
        if (row.id === seriesId || row.recurrenceParentId === seriesId) rows.delete(mid);
      }
    },
    async countByProject(projectId) {
      return [...rows.values()].filter((t) => t.projectId === projectId).length;
    },
  };
  const projects: ProjectLookup = { async getCodeById(id) { return id === 'p1' ? 'MICO' : id === 'p2' ? 'RIG' : null; } };
  return { tasks, projects };
}

const tokenService = createTokenService({
  accessSecret: 'task-access',
  refreshSecret: 'task-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

const events: { projectId: string; event: string; payload: unknown }[] = [];

async function makeApp() {
  events.length = 0;
  const taskService = createTaskService(inMemory());
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({
    authService,
    tokenService,
    taskService,
    onTaskEvent: (projectId, event, payload) => { events.push({ projectId, event, payload }); },
  });
}
function inMemoryAssignees(taskExists: (id: string) => Promise<boolean>) {
  const links = new Set<string>();
  const users: Record<string, AssigneeUser> = {
    u1: { id: 'u1', username: 'ada', email: 'ada@x', firstName: 'Ada', lastName: 'L' },
    u2: { id: 'u2', username: 'omar', email: 'omar@x', firstName: 'Omar', lastName: 'A' },
  };
  const repo: AssigneeRepository = {
    async add(taskId, userId) { links.add(`${taskId}:${userId}`); },
    async remove(taskId, userId) { links.delete(`${taskId}:${userId}`); },
    async list(taskId) {
      return [...links].filter((l) => l.startsWith(`${taskId}:`)).map((l) => users[l.split(':')[1]!]!).filter(Boolean);
    },
  };
  return createAssigneeService({ repo, taskLookup: { exists: taskExists } });
}

async function makeAppWithExtras() {
  const mem = inMemory();
  const taskService = createTaskService(mem);
  const exists = async (id: string) => (await mem.tasks.findById(id)) !== null;
  const tagService = createTagService({ repo: createMemoryTagRepository(), taskLookup: { exists } });
  const assigneeService = inMemoryAssignees(exists);
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, taskService, tagService, assigneeService });
}

async function token(roles: string[]) {
  return (await tokenService.issueTokens({ id: 'u1', roles })).accessToken;
}
async function tokenFor(id: string, roles: string[]) {
  return (await tokenService.issueTokens({ id, roles })).accessToken;
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});

async function createTask(roles = ['EMPLOYEE']) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/tasks',
    headers: { authorization: `Bearer ${await token(roles)}` },
    payload: { title: 'Prepare report', projectId: 'p1', columnId: 'c1' },
  });
}

describe('Task routes', () => {
  it('creates a task with an auto-generated key (201)', async () => {
    const res = await createTask();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.key).toBe('MICO-1');
  });

  it('auto-sets the start date on create', async () => {
    const res = await createTask();
    expect(res.json().data.startDate).toBeTruthy();
  });

  it('creates a task with tags in one call (find-or-create, de-duplicated)', async () => {
    const app2 = await makeAppWithExtras();
    const res = await app2.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` },
      payload: { title: 'Prepare report', projectId: 'p1', columnId: 'c1', tags: ['Urgent', 'urgent', 'backend'] },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.tags).toHaveLength(2);
    expect(new Set(data.tags.map((t: { name: string }) => t.name))).toEqual(new Set(['Urgent', 'backend']));

    // and the tags are readable back from the task's tags endpoint
    const tags = await app2.inject({ method: 'GET', url: `/api/v1/tasks/${data.id}/tags`, headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` } });
    expect(tags.json().data).toHaveLength(2);
  });

  it('creates a task with assignees in one call and lists them back', async () => {
    const app2 = await makeAppWithExtras();
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    const res = await app2.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers,
      payload: { title: 'Prepare report', projectId: 'p1', columnId: 'c1', assigneeIds: ['u1', 'u2'] },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.assignees.map((a: { username: string }) => a.username).sort()).toEqual(['ada', 'omar']);

    const list = await app2.inject({ method: 'GET', url: `/api/v1/tasks/${data.id}/assignees`, headers });
    expect(list.json().data).toHaveLength(2);
  });

  it('filters and sorts the task list via query params', async () => {
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    const mk = (title: string, priority: string) =>
      app.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title, projectId: 'p1', columnId: 'c1', priority } });
    await mk('Fix bug', 'LOW');
    await mk('Fix crash', 'URGENT');
    await mk('Write docs', 'HIGH');

    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks?q=fix&sort=priority&order=desc', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((t: { title: string }) => t.title)).toEqual(['Fix crash', 'Fix bug']);
  });

  it('rejects an unauthenticated create (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks', payload: { title: 'x', projectId: 'p1', columnId: 'c1' } });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 creating a task in an unknown project', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` },
      payload: { title: 'x', projectId: 'ghost', columnId: 'c1' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('moves a task to another column (200)', async () => {
    const created = await createTask();
    const id = created.json().data.id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${id}/move`,
      headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` },
      payload: { columnId: 'c2' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.columnId).toBe('c2');
  });

  it('forbids an employee from deleting a task (403), allows an admin (204) and broadcasts task:deleted', async () => {
    const created = await createTask();
    const id = created.json().data.id;
    const forbidden = await app.inject({ method: 'DELETE', url: `/api/v1/tasks/${id}`, headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` } });
    expect(forbidden.statusCode).toBe(403);
    const ok = await app.inject({ method: 'DELETE', url: `/api/v1/tasks/${id}`, headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(ok.statusCode).toBe(204);
    const deleted = events.find((e) => e.event === 'task:deleted');
    expect(deleted).toBeTruthy();
    expect((deleted!.payload as { id: string }).id).toBe(id);
  });
});

describe('Task routes — object-level authorization', () => {
  // u1 belongs to p1, u2 belongs to p2. Tasks resolve to a project via the map we populate on create.
  const membership: Record<string, string[]> = { p1: ['u1'], p2: ['u2'] };
  const taskProject: Record<string, string> = {};
  const projectAccess = {
    async canViewProject(userId: string, roles: string[], projectId: string) {
      return roles.includes('ADMIN') || (membership[projectId] ?? []).includes(userId);
    },
    async canViewTask(userId: string, roles: string[], taskId: string) {
      if (roles.includes('ADMIN')) return true;
      const pid = taskProject[taskId];
      return pid ? (membership[pid] ?? []).includes(userId) : false;
    },
    async canViewColumn() { return true; },
    async accessibleProjectIds(userId: string, roles: string[]) {
      if (roles.includes('ADMIN')) return null;
      return Object.entries(membership).filter(([, u]) => u.includes(userId)).map(([p]) => p);
    },
  };

  async function build() {
    const taskService = createTaskService(inMemory());
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    const built = await buildApp({ authService, tokenService, taskService, projectAccess });
    // Seed one task in each project (admin creates them), recording each task's project.
    const seed = async (projectId: string) => {
      const r = await built.inject({ method: 'POST', url: '/api/v1/tasks', headers: { authorization: `Bearer ${await tokenFor('admin', ['ADMIN'])}` }, payload: { title: `Task ${projectId}`, projectId, columnId: 'c1' } });
      const id = r.json().data.id as string;
      taskProject[id] = projectId;
      return id;
    };
    return { app: built, t1: await seed('p1'), t2: await seed('p2') };
  }

  it('hides a task in a project the user does not belong to (404), shows their own (200)', async () => {
    const { app: a, t1, t2 } = await build();
    const emp = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    expect((await a.inject({ method: 'GET', url: `/api/v1/tasks/${t1}`, headers: emp })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: `/api/v1/tasks/${t2}`, headers: emp })).statusCode).toBe(404);
  });

  it('scopes the task list to the user’s projects', async () => {
    const { app: a } = await build();
    const emp = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    const res = await a.inject({ method: 'GET', url: '/api/v1/tasks', headers: emp });
    const projects = new Set(res.json().data.map((t: { projectId: string }) => t.projectId));
    expect([...projects]).toEqual(['p1']);
  });

  it('403s an explicit projectId the user cannot access', async () => {
    const { app: a } = await build();
    const emp = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    expect((await a.inject({ method: 'GET', url: '/api/v1/tasks?projectId=p2', headers: emp })).statusCode).toBe(403);
  });

  it('403s editing/moving a task in another project, but allows it in your own', async () => {
    const { app: a, t1, t2 } = await build();
    const emp = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    expect((await a.inject({ method: 'PUT', url: `/api/v1/tasks/${t2}`, headers: emp, payload: { title: 'hijack' } })).statusCode).toBe(403);
    expect((await a.inject({ method: 'PATCH', url: `/api/v1/tasks/${t2}/move`, headers: emp, payload: { columnId: 'c2' } })).statusCode).toBe(403);
    expect((await a.inject({ method: 'PUT', url: `/api/v1/tasks/${t1}`, headers: emp, payload: { title: 'ok' } })).statusCode).toBe(200);
  });

  it('lets an admin see any task', async () => {
    const { app: a, t2 } = await build();
    const admin = { authorization: `Bearer ${await tokenFor('admin', ['ADMIN'])}` };
    expect((await a.inject({ method: 'GET', url: `/api/v1/tasks/${t2}`, headers: admin })).statusCode).toBe(200);
  });

  it('403s creating a task in a project the user does not belong to, but allows their own', async () => {
    const { app: a } = await build();
    const emp = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    const foreign = await a.inject({ method: 'POST', url: '/api/v1/tasks', headers: emp, payload: { title: 'inject', projectId: 'p2', columnId: 'c1' } });
    expect(foreign.statusCode).toBe(403);
    const own = await a.inject({ method: 'POST', url: '/api/v1/tasks', headers: emp, payload: { title: 'mine', projectId: 'p1', columnId: 'c1' } });
    expect(own.statusCode).toBe(201);
  });

  it('403s reordering a column whose tasks the user cannot see, but allows their own', async () => {
    const { app: a, t1, t2 } = await build();
    const emp = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    expect((await a.inject({ method: 'PUT', url: '/api/v1/columns/c1/tasks/reorder', headers: emp, payload: { orderedIds: [t2] } })).statusCode).toBe(403);
    expect((await a.inject({ method: 'PUT', url: '/api/v1/columns/c1/tasks/reorder', headers: emp, payload: { orderedIds: [t1] } })).statusCode).toBe(200);
  });
});
