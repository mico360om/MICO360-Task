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
import { summarizeExternalContacts } from './external-contacts';
import { createProjectAuthz } from '../projects/project-authz';
import { DELETE_NOT_ALLOWED, DELETE_SERIES_NOT_ALLOWED } from './task-delete-rule';
import { CompanyNotAvailableError } from '../companies/company-pick';
import type { CompanyAccess } from '../companies/company-access';

// c1/c2/done belong to p1, c3 to p2.
const COLUMNS: Record<string, ColumnInfo> = {
  c1: { id: 'c1', projectId: 'p1', category: 'TODO' },
  c2: { id: 'c2', projectId: 'p1', category: 'IN_PROGRESS' },
  done: { id: 'done', projectId: 'p1', category: 'DONE' },
  c3: { id: 'c3', projectId: 'p2', category: 'TODO' },
};

/** In-memory tasks; tags/assignees written on create land in the shared stores, like the real nested write. */
function inMemory(stores: { tags?: TagRepository; links?: Set<string>; dueToday?: Set<string> } = {}) {
  const rows = new Map<string, TaskRecord>();
  /** Checklists written with a task on create (as the real nested write does). */
  const checklists = new Map<string, string[]>();
  const trees = new Map<string, unknown>();
  /** External contacts written with a task on create (as the real nested write does). */
  const externalContacts = new Map<string, unknown[]>();
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
        weight: data.weight ?? null,
        createdById: data.createdById,
        completedAt: data.completedAt ?? null,
        boardDate: data.boardDate ?? null,
        recurrenceRule: data.recurrenceRule ?? null,
        recurrenceParentId: data.recurrenceParentId ?? null,
        meetingId: data.meetingId ?? null,
        inspectionFormId: data.inspectionFormId ?? null,
        inspectionPlace: data.inspectionPlace ?? null,
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
      if (data.checklist?.length) checklists.set(rec.id, [...data.checklist]);
      if (data.checklists?.length) trees.set(rec.id, data.checklists);
      if (data.externalContacts?.length) {
        externalContacts.set(rec.id, [...data.externalContacts]);
        rec.externalSummary = summarizeExternalContacts(data.externalContacts);
      }
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
  const projects: ProjectLookup = {
    async getCodeById(id) { return id === 'p1' ? 'MICO' : id === 'p2' ? 'RIG' : null; },
    async getTaskSettings(id) { return id === 'p1' || id === 'p2' ? { defaultDueToday: stores.dueToday?.has(id) ?? false } : null; },
  };
  return { tasks, projects, rows, checklists, trees, externalContacts };
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

  it('1.23.5: a task’s weight is 1–10 points, or none (the project’s default for its priority)', async () => {
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    const made = await app.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'Pour slab', projectId: 'p1', columnId: 'c1', weight: 8 } });
    expect(made.statusCode).toBe(201);
    expect(made.json().data.weight).toBe(8);
    const id = made.json().data.id;
    const cleared = await app.inject({ method: 'PUT', url: `/api/v1/tasks/${id}`, headers, payload: { weight: null } });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().data.weight).toBeNull();
    const set = await app.inject({ method: 'PUT', url: `/api/v1/tasks/${id}`, headers, payload: { weight: 10 } });
    expect(set.json().data.weight).toBe(10);
    // The live database doesn't refuse odd values: the server does.
    for (const weight of [0, 11, 2.5, -1, '3']) {
      expect((await app.inject({ method: 'PUT', url: `/api/v1/tasks/${id}`, headers, payload: { weight } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'X', projectId: 'p1', columnId: 'c1', weight } })).statusCode).toBe(400);
    }
    const plain = await app.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'No weight', projectId: 'p1', columnId: 'c1' } });
    expect(plain.json().data.weight).toBeNull();
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

  it('creates a task with its checklist in one call (a task template fills it in), and refuses a bad item before creating anything', async () => {
    const mem = inMemory();
    const app2 = await buildApp({ authService, tokenService, taskService: createTaskService(mem) });
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    const res = await app2.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'Site check', projectId: 'p1', columnId: 'c1', checklist: ['Gate', '  Fence  '] } });
    expect(res.statusCode).toBe(201);
    expect(mem.checklists.get(res.json().data.id)).toEqual(['Gate', 'Fence']);
    const blank = await app2.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'x', projectId: 'p1', columnId: 'c1', checklist: ['ok', '   '] } });
    expect(blank.statusCode).toBe(400);
    const tooMany = await app2.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'x', projectId: 'p1', columnId: 'c1', checklist: Array.from({ length: 101 }, (_, i) => `Item ${i}`) } });
    expect(tooMany.statusCode).toBe(400);
    expect(mem.rows.size).toBe(1);
  });

  it('1.23.3: creates a task with its checklists (titles, nesting), and refuses one past the limits before creating anything', async () => {
    const mem = inMemory();
    const app2 = await buildApp({ authService, tokenService, taskService: createTaskService(mem) });
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    const checklists = [{ title: 'Electrical', items: [{ text: 'Panel', children: [{ text: ' Label ' }] }] }, { title: '', items: [{ text: 'Paint' }] }];
    const res = await app2.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'Fit-out', projectId: 'p1', columnId: 'c1', checklists } });
    expect(res.statusCode).toBe(201);
    expect(mem.trees.get(res.json().data.id)).toEqual([
      { title: 'Electrical', items: [{ text: 'Panel', children: [{ text: 'Label' }] }] },
      { title: 'Checklist', items: [{ text: 'Paint' }] },
    ]);
    let deep: { text: string; children?: unknown[] } = { text: 'leaf' };
    for (let i = 0; i < 25; i++) deep = { text: `l${i}`, children: [deep] };
    const tooDeep = await app2.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title: 'x', projectId: 'p1', columnId: 'c1', checklists: [{ title: 'D', items: [deep] }] } });
    expect(tooDeep.statusCode).toBe(400);
    expect(mem.rows.size).toBe(1);
  });

  it('creates a task with its external contacts in one call, and refuses a bad one in plain words before creating anything', async () => {
    const mem = inMemory();
    const app2 = await buildApp({ authService, tokenService, taskService: createTaskService(mem) });
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    const res = await app2.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers,
      payload: { title: 'Site check', projectId: 'p1', columnId: 'c1', externalContacts: [{ name: ' Ahmed Al Said ', company: 'OXY', email: '' }] },
    });
    expect(res.statusCode).toBe(201);
    expect(mem.externalContacts.get(res.json().data.id)).toEqual([{ name: 'Ahmed Al Said', company: 'OXY', designation: null, email: null, phone: null, remarks: null }]);
    const bad = await app2.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers,
      payload: { title: 'x', projectId: 'p1', columnId: 'c1', externalContacts: [{ name: 'Ahmed' }, { name: 'Sara', email: 'not-an-email' }] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toBe('External contact 2: Enter a valid email address, like name@company.com.');
    const tooMany = await app2.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers,
      payload: { title: 'x', projectId: 'p1', columnId: 'c1', externalContacts: Array.from({ length: 21 }, (_, i) => ({ name: `P${i}` })) },
    });
    expect(tooMany.statusCode).toBe(400);
    expect(mem.rows.size).toBe(1);
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

  it('finds tasks by an external contact’s name or company, and filters them by company', async () => {
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    const post = (title: string, externalContacts: { name: string; company?: string }[]) =>
      app.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload: { title, projectId: 'p1', columnId: 'c1', externalContacts } });
    await post('Rig inspection', [{ name: 'Ahmed Al Said', company: 'OXY Oman' }]);
    await post('Pipeline survey', [{ name: 'Sara Nasser', company: 'PDO' }, { name: 'Ali', company: 'oxy  oman' }]);
    await post('Internal only', []);
    const titles = async (qs: string) => (await app.inject({ method: 'GET', url: `/api/v1/tasks?${qs}`, headers })).json().data.map((t: { title: string }) => t.title);
    expect(await titles('q=ahmed')).toEqual(['Rig inspection']);
    expect(await titles('q=pdo')).toEqual(['Pipeline survey']);
    expect(await titles(`externalCompany=${encodeURIComponent('OXY Oman')}`)).toEqual(['Rig inspection', 'Pipeline survey']);
    expect(await titles('externalCompany=PDO')).toEqual(['Pipeline survey']);
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

describe('Task routes — the picked company (companies)', () => {
  // cat belongs to companies A and B (projects p1, p2); ana only to A. The company module is a fake
  // whose checkPick refuses a company that isn't the person's — the real resolver reads the header.
  const companiesOf: Record<string, string[]> = { cat: ['A', 'B'], ana: ['A'] };
  const inCompany: Record<string, string> = { p1: 'A', p2: 'B' };
  const companyAccess = {
    async checkPick(viewer: { id: string }, pick: string | null) {
      if (pick !== null && !(companiesOf[viewer.id] ?? []).includes(pick)) throw new CompanyNotAvailableError();
      return pick;
    },
  } as unknown as CompanyAccess;
  const projectAccess = {
    canViewProject: async () => true,
    canViewTask: async () => true,
    canViewColumn: async () => true,
    accessibleProjectIds: vi.fn(async (_userId: string, _roles: string[], pick?: string | null) => Object.keys(inCompany).filter((p) => !pick || inCompany[p] === pick)),
  };

  async function build() {
    const taskService = createTaskService(inMemory());
    const built = await buildApp({ authService, tokenService, taskService, projectAccess, companyAccess });
    const admin = { authorization: `Bearer ${await tokenFor('admin', ['ADMIN'])}` };
    const tb1 = (await built.inject({ method: 'POST', url: '/api/v1/tasks', headers: admin, payload: { title: 'In B', projectId: 'p2', columnId: 'c3' } })).json().data.id as string;
    projectAccess.accessibleProjectIds.mockClear();
    return { app: built, tb1 };
  }
  const as = async (id: string, headers: Record<string, string> = {}) => ({ authorization: `Bearer ${await tokenFor(id, [])}`, ...headers });

  it('lists ask for the picked company', async () => {
    const { app: a } = await build();
    await a.inject({ method: 'GET', url: '/api/v1/tasks/mine', headers: await as('cat', { 'x-company-id': 'A' }) });
    expect(projectAccess.accessibleProjectIds).toHaveBeenCalledWith('cat', [], 'A');
    for (const url of ['/api/v1/tasks', '/api/v1/calendar?from=2026-10-01&to=2026-10-31']) {
      projectAccess.accessibleProjectIds.mockClear();
      expect((await a.inject({ method: 'GET', url, headers: await as('cat', { 'x-company-id': 'B' }) })).statusCode, url).toBe(200);
      expect(projectAccess.accessibleProjectIds, url).toHaveBeenCalledWith('cat', [], 'B');
    }
    projectAccess.accessibleProjectIds.mockClear();
    await a.inject({ method: 'GET', url: '/api/v1/tasks/mine', headers: await as('cat') });
    expect(projectAccess.accessibleProjectIds).toHaveBeenCalledWith('cat', [], null); // no header: all my companies
  });

  it('a pick that isn’t yours is refused', async () => {
    const { app: a } = await build();
    const res = await a.inject({ method: 'GET', url: '/api/v1/tasks', headers: await as('ana', { 'x-company-id': 'B' }) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('COMPANY_NOT_AVAILABLE');
  });

  it('opening one task ignores the pick', async () => {
    const { app: a, tb1 } = await build();
    expect((await a.inject({ method: 'GET', url: `/api/v1/tasks/${tb1}`, headers: await as('cat', { 'x-company-id': 'A' }) })).statusCode).toBe(200);
  });

  it('a board opened by its link (one named project) is checked without the pick; creating a task too', async () => {
    const { app: a } = await build();
    const res = await a.inject({ method: 'GET', url: '/api/v1/tasks?projectId=p2', headers: await as('cat', { 'x-company-id': 'A' }) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((t: { projectId: string }) => t.projectId)).toEqual(['p2']);
    expect(projectAccess.accessibleProjectIds).toHaveBeenLastCalledWith('cat', [], undefined);
    const created = await a.inject({ method: 'POST', url: '/api/v1/tasks', headers: await as('cat', { 'x-company-id': 'A' }), payload: { title: 'Also in B', projectId: 'p2', columnId: 'c3' } });
    expect(created.statusCode).toBe(201);
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

  it('1.23.3: dated checklist items in the range come with the tasks, in the caller’s scope', async () => {
    const asked: unknown[] = [];
    const mem = inMemory();
    const item = { id: 'i1', text: 'Label circuits', done: false, dueDate: '2026-10-12', assigneeId: 'u1', taskId: 't1', taskKey: 'MICO-142', taskTitle: 'Wiring', projectId: 'p1' };
    const a = await buildApp({
      authService,
      tokenService,
      taskService: createTaskService(mem),
      projectAccess,
      checklistDue: async (opts) => {
        asked.push(opts);
        return [item];
      },
    });
    const res = await a.inject({ method: 'GET', url: '/api/v1/calendar?from=2026-10-01&to=2026-10-31', headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` } });
    expect(res.json().data.checklistItems).toEqual([item]);
    expect(asked).toEqual([{ from: '2026-10-01', to: '2026-10-31', userId: 'u1', ownIds: ['p1'], listIds: ['p1'] }]);
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

describe('POST /tasks — a project whose new tasks are due today', () => {
  // 01:30 on 23 Oct in Muscat — still the 22nd in UTC.
  const NOW = new Date('2026-10-22T21:30:00Z');
  async function build() {
    const taskService = createTaskService({ ...inMemory({ dueToday: new Set(['p1']) }), timeZone: 'Asia/Muscat', now: () => NOW });
    const a = await buildApp({ authService, tokenService, taskService });
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    const post = (payload: Record<string, unknown>) => a.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload });
    const put = (id: string, payload: Record<string, unknown>) => a.inject({ method: 'PUT', url: `/api/v1/tasks/${id}`, headers, payload });
    return { post, put };
  }

  it('a task sent without a due date — from the website, the extension, the Android app or quick add — is due today', async () => {
    const { post } = await build();
    const res = await post({ title: 'Call the client', projectId: 'p1', columnId: 'c1' });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.dueDate).toBe('2026-10-23T00:00:00.000Z');
  });

  it('keeps a date that was picked, and leaves projects without the setting alone', async () => {
    const { post } = await build();
    expect((await post({ title: 'Picked', projectId: 'p1', columnId: 'c1', dueDate: '2026-11-05' })).json().data.dueDate).toBe('2026-11-05T00:00:00.000Z');
    expect((await post({ title: 'Other project', projectId: 'p2', columnId: 'c3' })).json().data.dueDate).toBeNull();
  });

  it('a date cleared later stays cleared, and an edit that doesn’t mention it doesn’t bring it back', async () => {
    const { post, put } = await build();
    const id = (await post({ title: 'Call the client', projectId: 'p1', columnId: 'c1' })).json().data.id;
    expect((await put(id, { dueDate: null })).json().data.dueDate).toBeNull();
    expect((await put(id, { title: 'Call the client back' })).json().data.dueDate).toBeNull();
  });

  it('a task added from a later day’s board is due on that board day', async () => {
    const { post } = await build();
    const res = await post({ title: 'Site visit', projectId: 'p1', columnId: 'c1', boardDate: '2026-10-27' });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ dueDate: '2026-10-27T00:00:00.000Z', boardDate: '2026-10-27T12:00:00.000Z' });
  });
});

describe('Task routes — a task that carries an inspection form (scheduled checks)', () => {
  // f-live is a form; f-gone was deleted (soft); anything else isn't there.
  const FORMS: Record<string, { id: string; title: string; deleted: boolean }> = {
    'f-live': { id: 'f-live', title: 'Rig daily check', deleted: false },
    'f-gone': { id: 'f-gone', title: 'Old deck check', deleted: true },
  };
  async function build() {
    const mem = inMemory();
    const taskService = createTaskService({ ...mem, inspectionForms: { isLive: async (id) => FORMS[id]?.deleted === false } });
    const built = await buildApp({ authService, tokenService, taskService, taskInspectionForm: async (id) => FORMS[id] ?? null });
    const headers = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    const post = (payload: Record<string, unknown>) => built.inject({ method: 'POST', url: '/api/v1/tasks', headers, payload });
    const put = (id: string, payload: Record<string, unknown>) => built.inject({ method: 'PUT', url: `/api/v1/tasks/${id}`, headers, payload });
    const get = (url: string) => built.inject({ method: 'GET', url: `/api/v1${url}`, headers });
    return { mem, post, put, get };
  }
  const base = { title: 'Daily rig check – Rig 3', projectId: 'p1', columnId: 'c1' };

  it('creates one with its form and place (trimmed), and every read carries them', async () => {
    const { post, get } = await build();
    const made = await post({ ...base, inspectionFormId: 'f-live', inspectionPlace: '  Rig 3 – الحفار ٣  ' });
    expect(made.statusCode).toBe(201);
    expect(made.json().data).toMatchObject({ inspectionFormId: 'f-live', inspectionPlace: 'Rig 3 – الحفار ٣' });
    const id = made.json().data.id;
    expect((await get('/tasks?projectId=p1')).json().data[0]).toMatchObject({ inspectionFormId: 'f-live', inspectionPlace: 'Rig 3 – الحفار ٣' });
    expect((await get(`/tasks/${id}`)).json().data).toMatchObject({ inspectionFormId: 'f-live', inspectionForm: { id: 'f-live', title: 'Rig daily check', deleted: false } });
  });

  it('a task without a form says so: no form, no place', async () => {
    const { post, get } = await build();
    const id = (await post({ ...base, inspectionPlace: '   ' })).json().data.id;
    expect((await get(`/tasks/${id}`)).json().data).toMatchObject({ inspectionFormId: null, inspectionPlace: null, inspectionForm: null });
  });

  it('refuses a form that isn’t there, or was deleted, in plain words — and creates nothing', async () => {
    const { post, mem } = await build();
    for (const formId of ['f-gone', 'nope']) {
      const res = await post({ ...base, inspectionFormId: formId });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toBe('That inspection form isn’t there any more. Pick another form.');
    }
    expect(mem.rows.size).toBe(0);
  });

  it('refuses a place longer than 200 characters', async () => {
    const { post } = await build();
    expect((await post({ ...base, inspectionFormId: 'f-live', inspectionPlace: 'x'.repeat(201) })).statusCode).toBe(400);
    expect((await post({ ...base, inspectionFormId: 'f-live', inspectionPlace: 'x'.repeat(200) })).statusCode).toBe(201);
  });

  it('edits change the form and place, and can clear them', async () => {
    const { post, put } = await build();
    const id = (await post(base)).json().data.id;
    expect((await put(id, { inspectionFormId: 'f-live', inspectionPlace: 'Rig 4' })).json().data).toMatchObject({ inspectionFormId: 'f-live', inspectionPlace: 'Rig 4' });
    expect((await put(id, { inspectionPlace: '' })).json().data).toMatchObject({ inspectionFormId: 'f-live', inspectionPlace: null });
    expect((await put(id, { inspectionFormId: null })).json().data).toMatchObject({ inspectionFormId: null });
    expect((await put(id, { inspectionFormId: 'f-gone' })).statusCode).toBe(400);
  });

  it('a check whose form was deleted keeps it through an edit of anything else (and even if it is sent back unchanged)', async () => {
    const { post, put, mem } = await build();
    const id = (await post({ ...base, inspectionFormId: 'f-live' })).json().data.id;
    mem.rows.set(id, { ...mem.rows.get(id)!, inspectionFormId: 'f-gone' });
    expect((await put(id, { title: 'Renamed' })).json().data).toMatchObject({ title: 'Renamed', inspectionFormId: 'f-gone' });
    expect((await put(id, { inspectionFormId: 'f-gone' })).statusCode).toBe(200);
  });

  it('a repeating task with a form is a schedule: created and stopped through the normal task routes', async () => {
    const { post, put } = await build();
    const rule = { freq: 'WEEKLY', interval: 1, weekdays: [0, 1, 2, 3, 4], createNext: 'ON_SCHEDULE' };
    const made = await post({ ...base, inspectionFormId: 'f-live', inspectionPlace: 'Rig 3', dueDate: '2026-10-28', recurrenceRule: rule });
    expect(made.statusCode).toBe(201);
    expect(made.json().data).toMatchObject({ inspectionFormId: 'f-live', recurrenceRule: rule });
    expect((await put(made.json().data.id, { recurrenceRule: null })).json().data.recurrenceRule).toBeNull();
  });

  it('a repeating task with a form is always made on schedule: create and edit are set to on-schedule, whatever was sent', async () => {
    const { post, put } = await build();
    for (const createNext of [undefined, 'ON_COMPLETE']) {
      const made = await post({ ...base, inspectionFormId: 'f-live', dueDate: '2026-10-28', recurrenceRule: { freq: 'DAILY', interval: 1, ...(createNext ? { createNext } : {}) } });
      expect(made.json().data.recurrenceRule).toEqual({ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' });
    }
    // A form given to a repeating task, and a repeat changed on a check.
    const plain = (await post({ ...base, dueDate: '2026-10-28', recurrenceRule: { freq: 'WEEKLY', interval: 1 } })).json().data;
    expect(plain.recurrenceRule).toEqual({ freq: 'WEEKLY', interval: 1 });
    expect((await put(plain.id, { inspectionFormId: 'f-live' })).json().data.recurrenceRule).toEqual({ freq: 'WEEKLY', interval: 1, createNext: 'ON_SCHEDULE' });
    expect((await put(plain.id, { recurrenceRule: { freq: 'DAILY', interval: 2, createNext: 'ON_COMPLETE' } })).json().data.recurrenceRule).toEqual({ freq: 'DAILY', interval: 2, createNext: 'ON_SCHEDULE' });
    // Without a form nothing changes.
    const other = (await post({ ...base, dueDate: '2026-10-28', recurrenceRule: { freq: 'DAILY', interval: 1, createNext: 'ON_COMPLETE' } })).json().data;
    expect(other.recurrenceRule.createNext).toBe('ON_COMPLETE');
  });

  it('requireNewest: a change meant for a series’ newest copy (a schedule’s Stop or Edit) is refused on an earlier copy or one that no longer repeats', async () => {
    const { post, put, mem } = await build();
    const made = (await post({ ...base, inspectionFormId: 'f-live', dueDate: '2026-10-28', recurrenceRule: { freq: 'DAILY', interval: 1 } })).json().data;
    expect((await put(made.id, { title: 'Renamed', requireNewest: true })).statusCode).toBe(200);
    // The repeat moved on: this is an earlier copy now.
    mem.rows.set(made.id, { ...mem.rows.get(made.id)!, recurrenceRule: null, recurrenceNextId: 't-next', recurrenceParentId: made.id });
    const stale = await put(made.id, { recurrenceRule: null, requireNewest: true });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('RECURRENCE_NOT_NEWEST');
    // Without the flag, an ordinary edit of an earlier copy is as before.
    expect((await put(made.id, { title: 'Old copy renamed' })).statusCode).toBe(200);
  });
});

describe('Task routes — who may delete a task (its creator, or the one person it’s assigned to)', () => {
  // 'boss' is an admin; 'mgr' runs p1 (project-level, not a role); 'emp' is an employee there.
  // Tasks go straight into the store, so who created them and who they're assigned to is exact.
  async function build() {
    const links = new Set<string>();
    const mem = inMemory({ links });
    const taskService = createTaskService(mem);
    const repo: AssigneeRepository = {
      async add(taskId, userId) { links.add(`${taskId}:${userId}`); },
      async remove(taskId, userId) { links.delete(`${taskId}:${userId}`); },
      async list(taskId) {
        return [...links].filter((l) => l.startsWith(`${taskId}:`)).map((l) => l.split(':')[1]!).map((id) => ({ id, username: id, email: `${id}@x`, firstName: id, lastName: '' }));
      },
      async eligibleUserIds(_projectId, userIds) { return userIds; },
    };
    const assigneeService = createAssigneeService({ repo, taskLookup: { exists: async (id) => mem.rows.has(id) } });
    const projectAuthz = createProjectAuthz({
      managers: {
        async managesProject(userId, projectId) { return userId === 'mgr' && projectId === 'p1'; },
        async projectIdOfTask(taskId) { return mem.rows.get(taskId)?.projectId ?? null; },
        async projectIdOfColumn() { return null; },
      },
    });
    const built = await buildApp({ authService, tokenService, taskService, assigneeService, projectAuthz });
    let n = 0;
    const seed = (createdById: string, assigneeIds: string[], extra: Partial<TaskRecord> = {}) => {
      n += 1;
      const id = `d${n}`;
      const at = new Date();
      mem.rows.set(id, {
        id, key: `MICO-${n}`, title: `Task ${n}`, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL',
        startDate: null, dueDate: null, estimatedHours: null, actualHours: null, progress: 0, createdById, completedAt: null,
        recurrenceRule: null, recurrenceParentId: null, boardDate: null, version: 0, createdAt: at, updatedAt: at, ...extra,
      });
      for (const u of assigneeIds) links.add(`${id}:${u}`);
      return id;
    };
    const as = async (userId: string) => ({ authorization: `Bearer ${await tokenFor(userId, userId === 'boss' ? ['ADMIN'] : ['EMPLOYEE'])}` });
    const del = async (userId: string, id: string, scope?: 'series') =>
      built.inject({ method: 'DELETE', url: `/api/v1/tasks/${id}${scope ? `?scope=${scope}` : ''}`, headers: await as(userId) });
    const details = async (userId: string, id: string) => (await built.inject({ method: 'GET', url: `/api/v1/tasks/${id}`, headers: await as(userId) })).json().data;
    return { mem, seed, del, details };
  }

  for (const who of ['boss', 'mgr']) {
    const label = who === 'boss' ? 'an admin' : 'a project manager';
    it(`${label} may delete a task they created, even one assigned to others`, async () => {
      const { seed, del, mem } = await build();
      const id = seed(who, ['a', 'b']);
      expect((await del(who, id)).statusCode).toBe(204);
      expect(mem.rows.has(id)).toBe(false);
    });

    it(`${label} may delete a task someone else created that is assigned to them alone`, async () => {
      const { seed, del, mem } = await build();
      const id = seed('someone', [who]);
      expect((await del(who, id)).statusCode).toBe(204);
      expect(mem.rows.has(id)).toBe(false);
    });

    it(`${label} may not delete a task someone else created that is assigned to them and others — 403 says why`, async () => {
      const { seed, del, mem } = await build();
      const id = seed('someone', [who, 'a']);
      const res = await del(who, id);
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toEqual({ code: 'DELETE_NOT_ALLOWED', message: DELETE_NOT_ALLOWED });
      expect(mem.rows.has(id)).toBe(true);
    });

    it(`${label} may not delete a task someone else created that is unassigned, or assigned to others only`, async () => {
      const { seed, del, mem } = await build();
      for (const id of [seed('someone', []), seed('someone', ['a']), seed('someone', ['a', 'b'])]) {
        const res = await del(who, id);
        expect(res.statusCode).toBe(403);
        expect(res.json().error).toEqual({ code: 'DELETE_NOT_ALLOWED', message: DELETE_NOT_ALLOWED });
        expect(mem.rows.has(id)).toBe(true);
      }
    });
  }

  it('an employee still may not delete a task — not even one they created and are alone on (as before)', async () => {
    const { seed, del, mem } = await build();
    const id = seed('emp', ['emp']);
    const res = await del('emp', id);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toEqual({ code: 'FORBIDDEN', message: 'You do not have permission to do that.' });
    expect(mem.rows.has(id)).toBe(true);
  });

  it('a manager of another project is refused as before (they do not run this one)', async () => {
    const { seed, del } = await build();
    const id = seed('mgr', ['mgr'], { projectId: 'p2', columnId: 'c3' });
    expect((await del('mgr', id)).json().error.code).toBe('FORBIDDEN');
  });

  it('a gone task still answers 404 first, for everyone — the refusal is only for a task that is there', async () => {
    const { seed, del } = await build();
    const id = seed('someone', ['a', 'b']);
    expect((await del('boss', 'no-such-task')).statusCode).toBe(404);
    expect((await del('emp', 'no-such-task')).statusCode).toBe(404);
    expect((await del('mgr', id)).statusCode).toBe(403);
    expect((await del('someone', id)).statusCode).toBe(403); // created it, but doesn't run the project
  });

  describe('a repeating task', () => {
    // The series' first task is its own parent once a copy is made; every copy keeps its creator.
    const rule = { freq: 'WEEKLY' as const, interval: 1 };
    function series(seed: (c: string, a: string[], e?: Partial<TaskRecord>) => string, creator: string, assignees: string[]) {
      const first = seed(creator, assignees);
      const copy = seed(creator, assignees, { recurrenceParentId: first, recurrenceRule: rule });
      return { first, copy };
    }

    it('“delete this copy” follows the rule on that copy', async () => {
      const { seed, del, mem } = await build();
      const mine = series(seed, 'someone', ['mgr']);
      expect((await del('mgr', mine.copy)).statusCode).toBe(204);
      expect(mem.rows.has(mine.copy)).toBe(false);
      const shared = series(seed, 'someone', ['mgr', 'a']);
      expect((await del('mgr', shared.copy)).json().error).toEqual({ code: 'DELETE_NOT_ALLOWED', message: DELETE_NOT_ALLOWED });
    });

    it('“delete the entire series” is only for the person who created the series', async () => {
      const { seed, del, mem } = await build();
      const theirs = series(seed, 'someone', ['mgr']);
      const refused = await del('mgr', theirs.copy, 'series');
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error).toEqual({ code: 'DELETE_NOT_ALLOWED', message: DELETE_SERIES_NOT_ALLOWED });
      expect(mem.rows.has(theirs.first) && mem.rows.has(theirs.copy)).toBe(true);

      const mine = series(seed, 'mgr', ['a', 'b']);
      expect((await del('mgr', mine.copy, 'series')).statusCode).toBe(204);
      expect(mem.rows.has(mine.first) || mem.rows.has(mine.copy)).toBe(false);
    });

    it('a task that does not repeat sent with scope=series is judged as the one task it is', async () => {
      const { seed, del } = await build();
      const id = seed('someone', ['boss']);
      expect((await del('boss', id, 'series')).statusCode).toBe(204);
    });
  });

  it('a task’s details say whether the person asking may delete it, and its entire series', async () => {
    const { seed, details } = await build();
    const created = seed('mgr', ['a', 'b']);
    const alone = seed('someone', ['mgr']);
    const shared = seed('someone', ['mgr', 'a']);
    expect(await details('mgr', created)).toMatchObject({ canDelete: true, canDeleteSeries: true });
    expect(await details('mgr', alone)).toMatchObject({ canDelete: true, canDeleteSeries: false });
    expect(await details('mgr', shared)).toMatchObject({ canDelete: false, canDeleteSeries: false });
    expect(await details('boss', shared)).toMatchObject({ canDelete: false });
    // An employee may not delete tasks at all.
    expect(await details('emp', created)).toMatchObject({ canDelete: false, canDeleteSeries: false });
  });
});
