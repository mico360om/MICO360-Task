import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../app';
import { createTaskService } from './task-service';
import { createTagService } from './tag-service';
import { createMemoryTagRepository, type TagRepository } from './tag-repository';
import { createAssigneeService } from './assignee-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { ColumnInfo, CreateTaskData, TaskRecord, TaskRepository, ProjectLookup } from './task-repository';
import type { AssigneeRepository, AssigneeUser } from './assignee-repository';
import { NotFoundError } from '../../lib/http-errors';

// c1/c2/done belong to p1, c3 to p2.
const COLUMNS: Record<string, ColumnInfo> = {
  c1: { id: 'c1', projectId: 'p1', category: 'TODO' },
  c2: { id: 'c2', projectId: 'p1', category: 'IN_PROGRESS' },
  done: { id: 'done', projectId: 'p1', category: 'DONE' },
  c3: { id: 'c3', projectId: 'p2', category: 'TODO' },
};

/** In-memory tasks; tags/assignees written on create land in the shared stores, like the real nested write. */
function inMemory(stores: { tags?: TagRepository; links?: Set<string> } = {}) {
  const rows = new Map<string, TaskRecord>();
  let seq = 0;
  const assigneesOf = (id: string) => [...(stores.links ?? [])].filter((l) => l.startsWith(`${id}:`)).map((l) => l.split(':')[1]!);
  const view = (t: TaskRecord): TaskRecord => ({ ...t, columnCategory: COLUMNS[t.columnId]?.category ?? null });
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
        isMilestone: data.isMilestone ?? false,
        createdById: data.createdById,
        completedAt: data.completedAt ?? null,
        boardDate: data.boardDate ?? null,
        recurrenceRule: data.recurrenceRule ?? null,
        recurrenceParentId: data.recurrenceParentId ?? null,
        meetingId: data.meetingId ?? null,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(rec.id, rec);
      if (stores.tags && data.tagNames?.length) {
        const tags = [];
        for (const name of data.tagNames) tags.push(await stores.tags.findOrCreateByName(name));
        await stores.tags.setForTask(rec.id, tags.map((t) => t.id));
        rec.tags = await stores.tags.listForTask(rec.id);
      }
      for (const userId of data.assigneeIds ?? []) stores.links?.add(`${rec.id}:${userId}`);
      return view(rec);
    },
    async findById(id) {
      const t = rows.get(id);
      return t ? view(t) : null;
    },
    async list(filter) {
      return [...rows.values()]
        .filter((t) => (filter.projectId ? t.projectId === filter.projectId : true))
        .filter((t) => (filter.projectIds ? filter.projectIds.includes(t.projectId) : true))
        .filter((t) => (filter.assigneeId ? assigneesOf(t.id).includes(filter.assigneeId) : true))
        .map(view);
    },
    async update(id, patch) {
      const updated = { ...rows.get(id)!, ...patch, updatedAt: new Date() };
      rows.set(id, updated);
      return view(updated);
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
    async findColumn(columnId) {
      return COLUMNS[columnId] ?? null;
    },
    async reorderInColumn(columnId, orderedIds) {
      orderedIds.forEach((id, index) => {
        const row = rows.get(id);
        if (row && row.columnId === columnId) rows.set(id, { ...row, position: index });
      });
    },
  };
  const projects: ProjectLookup = { async getCodeById(id) { return id === 'p1' ? 'MICO' : id === 'p2' ? 'RIG' : null; } };
  return { tasks, projects, rows };
}

const tokenService = createTokenService({
  accessSecret: 'task-access',
  refreshSecret: 'task-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

const events: { projectId: string; event: string; payload: unknown }[] = [];

async function makeApp() {
  events.length = 0;
  const taskService = createTaskService(inMemory());
  return buildApp({
    authService,
    tokenService,
    taskService,
    onTaskEvent: (projectId, event, payload) => { events.push({ projectId, event, payload }); },
  });
}

const USERS: Record<string, AssigneeUser> = {
  u1: { id: 'u1', username: 'ada', email: 'ada@x', firstName: 'Ada', lastName: 'L' },
  u2: { id: 'u2', username: 'omar', email: 'omar@x', firstName: 'Omar', lastName: 'A' },
  owner: { id: 'owner', username: 'boss', email: 'boss@x', firstName: 'Bo', lastName: 'S' },
  outsider: { id: 'outsider', username: 'zed', email: 'zed@x', firstName: 'Zed', lastName: 'Z' },
};
// Who may be assigned in p1 (active project members).
const P1_AUDIENCE = new Set(['u1', 'u2', 'owner']);

function inMemoryAssignees(links: Set<string>, taskExists: (id: string) => Promise<boolean>, notified: string[][]) {
  const repo: AssigneeRepository = {
    async add(taskId, userId) { links.add(`${taskId}:${userId}`); },
    async remove(taskId, userId) { links.delete(`${taskId}:${userId}`); },
    async list(taskId) {
      return [...links].filter((l) => l.startsWith(`${taskId}:`)).map((l) => USERS[l.split(':')[1]!]!).filter(Boolean);
    },
    async eligibleUserIds(projectId, userIds) {
      return projectId === 'p1' ? userIds.filter((id) => P1_AUDIENCE.has(id)) : [];
    },
  };
  return createAssigneeService({ repo, taskLookup: { exists: taskExists }, onAssigned: (_t, ids) => { notified.push(ids); } });
}

async function makeAppWithExtras() {
  const tagRepo = createMemoryTagRepository();
  const links = new Set<string>();
  const notified: string[][] = [];
  const mem = inMemory({ tags: tagRepo, links });
  const taskService = createTaskService(mem);
  const exists = async (id: string) => (await mem.tasks.findById(id)) !== null;
  const tagService = createTagService({ repo: tagRepo, taskLookup: { exists } });
  const assigneeService = inMemoryAssignees(links, exists, notified);
  const app = await buildApp({
    authService,
    tokenService,
    taskService,
    tagService,
    assigneeService,
    projectService: {
      async getProject(id: string) { return { id, ownerId: id === 'p1' ? 'owner' : null }; },
    } as never,
  });
  return { app, mem, links, notified };
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
    expect(res.json().data.isMilestone).toBe(false);
  });

  it('marks a task as a milestone of its project, and back', async () => {
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    const made = await app.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'Go-live', projectId: 'p1', columnId: 'c1', isMilestone: true } });
    expect(made.statusCode).toBe(201);
    expect(made.json().data.isMilestone).toBe(true);
    const id = made.json().data.id;
    const off = await app.inject({ method: 'PUT', url: `/api/v1/tasks/${id}`, headers, payload: { isMilestone: false } });
    expect(off.json().data.isMilestone).toBe(false);
    const bad = await app.inject({ method: 'PUT', url: `/api/v1/tasks/${id}`, headers, payload: { isMilestone: 'yes' } });
    expect(bad.statusCode).toBe(400);
  });

  it('creates and edits a recurring task with a custom schedule ("the last Friday", made on schedule)', async () => {
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    const rule = { freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 5 }, createNext: 'ON_SCHEDULE' };
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'Month-end report', projectId: 'p1', columnId: 'c1', dueDate: '2026-10-30', recurrenceRule: rule } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.recurrenceRule).toEqual(rule);
    const id = res.json().data.id as string;
    const weekly = { freq: 'WEEKLY', interval: 2, weekdays: [0, 4], createNext: 'ON_COMPLETE' };
    const put = await app.inject({ method: 'PUT', url: `/api/v1/tasks/${id}`, headers, payload: { recurrenceRule: weekly } });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.recurrenceRule).toEqual(weekly);
  });

  it('rejects impossible custom schedules (400)', async () => {
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    const bad = [
      { freq: 'MONTHLY', interval: 1, nthWeekday: { week: 5, day: 1 } },
      { freq: 'MONTHLY', interval: 1, nthWeekday: { week: 1, day: 9 } },
      { freq: 'WEEKLY', interval: 1, nthWeekday: { week: 1, day: 1 } },
      { freq: 'DAILY', interval: 1, createNext: 'SOMETIMES' },
    ];
    for (const recurrenceRule of bad) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'x', projectId: 'p1', columnId: 'c1', recurrenceRule } });
      expect(res.statusCode, JSON.stringify(recurrenceRule)).toBe(400);
    }
  });

  it('auto-sets the start date on create', async () => {
    const res = await createTask();
    expect(res.json().data.startDate).toBeTruthy();
  });

  it('creates a task with tags in one call (find-or-create, de-duplicated)', async () => {
    const { app: app2 } = await makeAppWithExtras();
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

  it('creates a task with assignees in one call, notifies them, and lists them back', async () => {
    const { app: app2, notified } = await makeAppWithExtras();
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
    expect(notified).toEqual([['u1', 'u2']]); // the project owner is NOT added on top

    const list = await app2.inject({ method: 'GET', url: `/api/v1/tasks/${data.id}/assignees`, headers });
    expect(list.json().data).toHaveLength(2);
  });

  it('treats an explicit empty assigneeIds as "no assignees" and only defaults a missing field to the owner', async () => {
    const { app: app2, links } = await makeAppWithExtras();
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    const none = await app2.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'Nobody', projectId: 'p1', columnId: 'c1', assigneeIds: [] } });
    expect(none.statusCode).toBe(201);
    expect([...links].filter((l) => l.startsWith(`${none.json().data.id}:`))).toEqual([]);

    const dflt = await app2.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'Owner', projectId: 'p1', columnId: 'c1' } });
    expect(dflt.json().data.assignees.map((a: { id: string }) => a.id)).toEqual(['owner']);
  });

  it('rejects assignees who are not active project members — and creates nothing', async () => {
    const { app: app2, mem } = await makeAppWithExtras();
    const res = await app2.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` },
      payload: { title: 'x', projectId: 'p1', columnId: 'c1', assigneeIds: ['u1', 'outsider'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toEqual({ userIds: ['outsider'] });
    expect(mem.rows.size).toBe(0);
  });

  it('rejects invalid tags before creating the task', async () => {
    const { app: app2, mem } = await makeAppWithExtras();
    const res = await app2.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` },
      payload: { title: 'x', projectId: 'p1', columnId: 'c1', tags: ['ok', '   '] },
    });
    expect(res.statusCode).toBe(400);
    expect(mem.rows.size).toBe(0);
  });

  it('rejects a column from another project (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` },
      payload: { title: 'x', projectId: 'p1', columnId: 'c3' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('validates input: blank or overlong titles, impossible dates, negative hours, fractional positions', async () => {
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'ok', projectId: 'p1', columnId: 'c1', ...payload } });
    expect((await post({ title: '    ' })).statusCode).toBe(400);
    expect((await post({ title: 'x'.repeat(192) })).statusCode).toBe(400);
    expect((await post({ dueDate: '2026-13-01' })).statusCode).toBe(400);
    expect((await post({ dueDate: '2026-02-30' })).statusCode).toBe(400);
    expect((await post({ boardDate: '2026-02-30' })).statusCode).toBe(400);
    expect((await post({ estimatedHours: -2 })).statusCode).toBe(400);
    expect((await post({ description: 'ع'.repeat(33_000) })).statusCode).toBe(400); // > 65,535 bytes of Arabic
    const ok = await post({ title: '  Trimmed  ', dueDate: '2026-02-28' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data.title).toBe('Trimmed');
    expect(ok.json().data.dueDate).toBe('2026-02-28T00:00:00.000Z');

    const id = ok.json().data.id;
    const move = await app.inject({ method: 'PATCH', url: `/api/v1/tasks/${id}/move`, headers, payload: { columnId: 'c2', position: 1.5 } });
    expect(move.statusCode).toBe(400);
  });

  it('reads overdue=false as false (not as "only overdue")', async () => {
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    await app.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'Late', projectId: 'p1', columnId: 'c1', dueDate: '2020-01-01' } });
    await app.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'Fine', projectId: 'p1', columnId: 'c1', dueDate: '2999-01-01' } });
    const all = await app.inject({ method: 'GET', url: '/api/v1/tasks?overdue=false', headers });
    expect(all.json().data).toHaveLength(2);
    const overdue = await app.inject({ method: 'GET', url: '/api/v1/tasks?overdue=true', headers });
    expect(overdue.json().data.map((t: { title: string }) => t.title)).toEqual(['Late']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/tasks?overdue=maybe', headers })).statusCode).toBe(400);
  });

  it('pages the filtered list when limit/offset are given', async () => {
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    for (const title of ['A', 'B', 'C']) {
      await app.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title, projectId: 'p1', columnId: 'c1' } });
    }
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks?sort=title&limit=2&offset=1', headers });
    expect(res.json().data.map((t: { title: string }) => t.title)).toEqual(['B', 'C']);
    expect(res.json().meta).toEqual({ total: 3, offset: 1, limit: 2 });
  });

  it('filters by keyword across Arabic spelling variants', async () => {
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    await app.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'إدارة المشروع', projectId: 'p1', columnId: 'c1' } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/tasks?q=${encodeURIComponent('ادارة')}`, headers });
    expect(res.json().data).toHaveLength(1);
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

  it('completes a task moved into Done via PUT (same rules as the move endpoint)', async () => {
    const id = (await createTask()).json().data.id;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/tasks/${id}`,
      headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` },
      payload: { columnId: 'done' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.completedAt).toBeTruthy();
    expect(res.json().data.progress).toBe(100);
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

  it('answers 404 for a task that is already gone, for everyone — 403 only refuses a task that is still there', async () => {
    // An offline delete replayed after someone else deleted the task must read "gone" (done),
    // not "no permission" (a refusal) — the deleted task has no project left to check against.
    const id = (await createTask()).json().data.id;
    const admin = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const employee = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/tasks/${id}`, headers: admin })).statusCode).toBe(204);
    const again = await app.inject({ method: 'DELETE', url: `/api/v1/tasks/${id}`, headers: employee });
    expect(again.statusCode).toBe(404);
    expect(again.json().error.code).toBe('NOT_FOUND');
    const never = await app.inject({ method: 'DELETE', url: '/api/v1/tasks/no-such-task', headers: employee });
    expect(never.statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/tasks/${id}`, headers: admin })).statusCode).toBe(404);
    // Still there: the refusal stands, and nothing is deleted.
    const kept = (await createTask()).json().data.id;
    const refused = await app.inject({ method: 'DELETE', url: `/api/v1/tasks/${kept}`, headers: employee });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toEqual({ code: 'FORBIDDEN', message: 'You do not have permission to do that.' });
    expect((await app.inject({ method: 'GET', url: `/api/v1/tasks/${kept}`, headers: employee })).statusCode).toBe(200);
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
    const mem = inMemory();
    const taskService = createTaskService(mem);
    const built = await buildApp({ authService, tokenService, taskService, projectAccess });
    // Seed one task in each project (admin creates them), recording each task's project.
    const seed = async (projectId: string, columnId: string) => {
      const r = await built.inject({ method: 'POST', url: '/api/v1/tasks', headers: { authorization: `Bearer ${await tokenFor('admin', ['ADMIN'])}` }, payload: { title: `Task ${projectId}`, projectId, columnId } });
      const id = r.json().data.id as string;
      taskProject[id] = projectId;
      return id;
    };
    return { app: built, mem, t1: await seed('p1', 'c1'), t2: await seed('p2', 'c3') };
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
    expect((await a.inject({ method: 'PATCH', url: `/api/v1/tasks/${t2}/move`, headers: emp, payload: { columnId: 'c3' } })).statusCode).toBe(403);
    expect((await a.inject({ method: 'PUT', url: `/api/v1/tasks/${t1}`, headers: emp, payload: { title: 'ok' } })).statusCode).toBe(200);
  });

  it('refuses to move a task into another project’s column (400)', async () => {
    const { app: a, t1 } = await build();
    const admin = { authorization: `Bearer ${await tokenFor('admin', ['ADMIN'])}` };
    expect((await a.inject({ method: 'PATCH', url: `/api/v1/tasks/${t1}/move`, headers: admin, payload: { columnId: 'c3' } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'PUT', url: `/api/v1/tasks/${t1}`, headers: admin, payload: { columnId: 'c3' } })).statusCode).toBe(400);
  });

  it('lets an admin see any task', async () => {
    const { app: a, t2 } = await build();
    const admin = { authorization: `Bearer ${await tokenFor('admin', ['ADMIN'])}` };
    expect((await a.inject({ method: 'GET', url: `/api/v1/tasks/${t2}`, headers: admin })).statusCode).toBe(200);
  });

  it('403s creating a task in a project the user does not belong to, but allows their own', async () => {
    const { app: a } = await build();
    const emp = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    const foreign = await a.inject({ method: 'POST', url: '/api/v1/tasks', headers: emp, payload: { title: 'inject', projectId: 'p2', columnId: 'c3' } });
    expect(foreign.statusCode).toBe(403);
    const own = await a.inject({ method: 'POST', url: '/api/v1/tasks', headers: emp, payload: { title: 'mine', projectId: 'p1', columnId: 'c1' } });
    expect(own.statusCode).toBe(201);
  });

  it('authorizes a reorder by the column in the URL and only re-numbers that column’s tasks', async () => {
    const { app: a, mem, t1, t2 } = await build();
    const emp = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    // Another project's column → 403, whatever ids are sent.
    expect((await a.inject({ method: 'PUT', url: '/api/v1/columns/c3/tasks/reorder', headers: emp, payload: { orderedIds: [t1] } })).statusCode).toBe(403);
    // Own column, but a foreign task id smuggled in → ignored.
    mem.rows.set(t2, { ...mem.rows.get(t2)!, position: 9 });
    const res = await a.inject({ method: 'PUT', url: '/api/v1/columns/c1/tasks/reorder', headers: emp, payload: { orderedIds: [t2, t1] } });
    expect(res.statusCode).toBe(200);
    expect(mem.rows.get(t2)!.position).toBe(9);
    expect(mem.rows.get(t1)!.position).toBe(1);
    // Unknown column → 404.
    expect((await a.inject({ method: 'PUT', url: '/api/v1/columns/ghost/tasks/reorder', headers: emp, payload: { orderedIds: [t1] } })).statusCode).toBe(404);
  });
});

describe('GET /calendar — the visible range only, with the coming copies of repeating tasks', () => {
  const membership: Record<string, string[]> = { p1: ['u1'], p2: [] };
  const projectAccess = {
    async canViewProject(userId: string, roles: string[], projectId: string) {
      return roles.includes('ADMIN') || (membership[projectId] ?? []).includes(userId);
    },
    async canViewTask() { return true; },
    async canViewColumn() { return true; },
    async accessibleProjectIds(userId: string, roles: string[]) {
      if (roles.includes('ADMIN')) return null;
      return Object.entries(membership).filter(([, u]) => u.includes(userId)).map(([p]) => p);
    },
  };
  const day = (k: string) => new Date(`${k}T00:00:00.000Z`);

  async function build() {
    const mem = inMemory();
    const taskService = createTaskService(mem);
    const counted: string[] = [];
    const a = await buildApp({ authService, tokenService, taskService, projectAccess, seriesInstanceCount: async (id: string) => { counted.push(id); return 1; } });
    const add = (title: string, projectId: string, columnId: string, dueDate: Date | null, extra: Partial<CreateTaskData> = {}) =>
      mem.tasks.create({ key: `K-${title}`, title, projectId, columnId, dueDate, createdById: 'u1', ...extra } as CreateTaskData);
    return { a, add, counted };
  }

  afterEach(() => vi.useRealTimers());

  it('returns the tasks due in the range for projects you can see (by their calendar day)', async () => {
    const { a, add } = await build();
    await add('first of the month', 'p1', 'c1', day('2026-10-01'));
    await add('mid month, timed', 'p1', 'c1', new Date('2026-10-15T09:00:00.000Z'));
    await add('last of the month', 'p1', 'c1', day('2026-10-31'));
    await add('next month', 'p1', 'c1', day('2026-11-01'));
    await add('last month', 'p1', 'c1', day('2026-09-30'));
    await add('no date', 'p1', 'c1', null);
    await add('someone else’s project', 'p2', 'c3', day('2026-10-10'));
    const res = await a.inject({ method: 'GET', url: '/api/v1/calendar?from=2026-10-01&to=2026-10-31', headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.tasks.map((t: { title: string }) => t.title).sort()).toEqual(['first of the month', 'last of the month', 'mid month, timed']);
    // An admin sees every project.
    const all = await a.inject({ method: 'GET', url: '/api/v1/calendar?from=2026-10-01&to=2026-10-31', headers: { authorization: `Bearer ${await tokenFor('admin', ['ADMIN'])}` } });
    expect(all.json().data.tasks).toHaveLength(4);
  });

  it('adds the dates a repeating task will be copied to, marked as projected, without creating tasks', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T08:00:00.000Z'));
    const { a, add, counted } = await build();
    const head = await add('Weekly check', 'p1', 'c1', day('2026-10-05'), { recurrenceRule: { freq: 'WEEKLY', interval: 1, count: 10 } });
    await add('Hidden weekly', 'p2', 'c3', day('2026-10-05'), { recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    const res = await a.inject({ method: 'GET', url: '/api/v1/calendar?from=2026-10-01&to=2026-10-31', headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` } });
    const data = res.json().data;
    expect(data.occurrences).toEqual(['2026-10-12', '2026-10-19', '2026-10-26'].map((date) => ({ taskId: head.id, seriesId: head.id, date })));
    expect(data.series.map((s: { id: string }) => s.id)).toEqual([head.id]);
    expect(counted).toEqual([head.id]); // a series with a number of occurrences counts its copies
    // Nothing was created: the range still holds one real task.
    expect(data.tasks.map((t: { id: string }) => t.id)).toEqual([head.id]);
  });

  it('refuses a range that ends before it starts, is too long, or is not a date', async () => {
    const { a } = await build();
    const headers = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    for (const qs of ['from=2026-10-31&to=2026-10-01', 'from=2026-01-01&to=2026-12-31', 'from=Oct&to=2026-10-31', 'from=2026-10-01']) {
      expect((await a.inject({ method: 'GET', url: `/api/v1/calendar?${qs}`, headers })).statusCode).toBe(400);
    }
  });

  it('accepts a repeat rule noting the day a moved occurrence replaced', async () => {
    const { a, add } = await build();
    const t = await add('Weekly check', 'p1', 'c1', day('2026-10-05'), { recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    const res = await a.inject({
      method: 'PUT',
      url: `/api/v1/tasks/${t.id}`,
      headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` },
      payload: { dueDate: '2026-10-07', recurrenceRule: { freq: 'WEEKLY', interval: 1, resumeFrom: '2026-10-05' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.recurrenceRule.resumeFrom).toBe('2026-10-05');
  });
});

describe('GET /tasks/:id — the meeting a task was created from', () => {
  const START = new Date('2026-10-12T09:00:00.000Z');
  async function build(opts: { canView?: boolean; meetingGone?: boolean } = {}) {
    const mem = inMemory();
    const taskService = createTaskService(mem);
    const fromMeeting = await taskService.createTask({ title: 'Send the plan', projectId: 'p1', columnId: 'c1', createdById: 'u1', meetingId: 'm1' });
    const plain = await taskService.createTask({ title: 'Book the room', projectId: 'p1', columnId: 'c1', createdById: 'u1' });
    const looked: string[] = [];
    const checked: string[] = [];
    const a = await buildApp({
      authService,
      tokenService,
      taskService,
      taskMeeting: {
        async summary(id) {
          looked.push(id);
          return id === 'm1' && !opts.meetingGone ? { id: 'm1', title: 'Weekly review', startAt: START } : null;
        },
        async canView(userId, _roles, id) {
          checked.push(`${userId}:${id}`);
          return opts.canView ?? true;
        },
      },
    });
    const get = async (id: string) =>
      a.inject({ method: 'GET', url: `/api/v1/tasks/${id}`, headers: { authorization: `Bearer ${await tokenFor('u2', ['EMPLOYEE'])}` } });
    return { get, fromMeeting, plain, looked, checked };
  }

  it('links the meeting by its title and start', async () => {
    const { get, fromMeeting, checked } = await build();
    const res = await get(fromMeeting.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.meetingId).toBe('m1');
    expect(res.json().data.meeting).toEqual({ id: 'm1', title: 'Weekly review', startAt: START.toISOString(), canView: true });
    expect(checked).toEqual(['u2:m1']); // checked for the person asking
  });

  it('keeps the title and time from someone who may not see the meeting', async () => {
    const { get, fromMeeting } = await build({ canView: false });
    expect((await get(fromMeeting.id)).json().data.meeting).toEqual({ id: 'm1', title: null, startAt: null, canView: false });
  });

  it('shows no meeting for a task made anywhere else, without looking one up', async () => {
    const { get, plain, looked } = await build();
    const data = (await get(plain.id)).json().data;
    expect(data.meetingId).toBeNull();
    expect(data.meeting).toBeNull();
    expect(looked).toEqual([]);
  });

  it('shows no meeting once the meeting is deleted', async () => {
    const { get, fromMeeting } = await build({ meetingGone: true });
    expect((await get(fromMeeting.id)).json().data.meeting).toBeNull();
  });
});

describe('GET /tasks/:id — the meeting lookup built from the meeting service', () => {
  it('names the meeting for someone who may see it, and drops a deleted one', async () => {
    const mem = inMemory();
    const taskService = createTaskService(mem);
    const live = await taskService.createTask({ title: 'Send the plan', projectId: 'p1', columnId: 'c1', createdById: 'u1', meetingId: 'm1' });
    const gone = await taskService.createTask({ title: 'Old follow-up', projectId: 'p1', columnId: 'c1', createdById: 'u1', meetingId: 'm-deleted' });
    const meetingService = {
      async getMeeting(id: string) {
        if (id !== 'm1') throw new NotFoundError('Meeting not found.');
        return { id: 'm1', title: 'Weekly review', startAt: new Date('2026-10-12T09:00:00.000Z') };
      },
    };
    const meetingAccess = { async canViewMeeting(userId: string) { return userId === 'u2'; } };
    const a = await buildApp({ authService, tokenService, taskService, meetingService: meetingService as never, meetingAccess: meetingAccess as never });
    const get = async (id: string, userId: string) =>
      (await a.inject({ method: 'GET', url: `/api/v1/tasks/${id}`, headers: { authorization: `Bearer ${await tokenFor(userId, ['EMPLOYEE'])}` } })).json().data;
    expect((await get(live.id, 'u2')).meeting).toMatchObject({ id: 'm1', title: 'Weekly review', canView: true });
    expect((await get(live.id, 'u1')).meeting).toEqual({ id: 'm1', title: null, startAt: null, canView: false });
    expect((await get(gone.id, 'u2')).meeting).toBeNull();
  });
});
