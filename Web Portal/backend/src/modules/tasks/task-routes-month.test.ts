import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../../app';
import { createTaskService } from './task-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { TaskListFilter, TaskRecord, TaskRepository } from './task-repository';

// Kanban Board: Monthly View — GET /tasks?month=YYYY-MM (one project's board, and All projects).
// Today is 7 Nov 2026 in Muscat. The repository narrows by a window; the exact month rule runs on its rows.
const TODAY = new Date('2026-11-07T08:00:00.000Z');
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

const tokenService = createTokenService({
  accessSecret: 'month-access',
  refreshSecret: 'month-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

let n = 0;
function row(title: string, extra: Partial<TaskRecord> = {}): TaskRecord {
  n += 1;
  return {
    id: `t${n}`, key: `MICO-${n}`, title, description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: n, priority: 'NORMAL',
    startDate: null, dueDate: null, estimatedHours: null, actualHours: null, progress: 0, createdById: 'u1', completedAt: null,
    recurrenceRule: null, recurrenceParentId: null, boardDate: null, version: 0, createdAt: TODAY, updatedAt: TODAY, ...extra,
  } as TaskRecord;
}

const ROWS: TaskRecord[] = [
  row('Spans Oct–Dec', { startDate: day('2026-10-05'), dueDate: day('2026-12-20') }),
  row('Due in Nov', { dueDate: day('2026-11-18') }),
  row('Due in Dec', { dueDate: day('2026-12-18') }),
  row('Started in Oct, no due', { startDate: new Date('2026-10-03T06:00:00Z') }),
  row('Starts in Dec', { startDate: day('2026-12-02') }),
  row('Done in Nov', { columnId: 'done', columnCategory: 'DONE', completedAt: new Date('2026-11-03T08:00:00Z'), dueDate: day('2026-09-01') }),
  row('Done in Oct', { columnId: 'done', columnCategory: 'DONE', completedAt: new Date('2026-10-30T08:00:00Z'), dueDate: day('2026-11-20') }),
  row('Overdue from Oct', { dueDate: day('2026-10-25'), priority: 'HIGH' }),
  row('No dates', {}),
  row('No dates, high', { priority: 'HIGH' }),
  // Another project (p2), which only some people see.
  row('p2 in Nov', { projectId: 'p2', columnId: 'c3', dueDate: day('2026-11-10') }),
  row('p2 no dates', { projectId: 'p2', columnId: 'c3' }),
];

const filters: TaskListFilter[] = [];
const repo = {
  async list(filter: TaskListFilter) {
    filters.push(filter);
    return ROWS.filter((t) => (!filter.projectId || t.projectId === filter.projectId) && (!filter.projectIds || filter.projectIds.includes(t.projectId)));
  },
} as unknown as TaskRepository;

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
  const taskService = createTaskService({ tasks: repo, projects: { async getCodeById() { return 'MICO'; }, async getTaskSettings() { return null; } }, timeZone: 'Asia/Muscat' });
  app = await buildApp({
    authService,
    tokenService,
    taskService,
    // u1 sees p1 only; the admin sees both.
    projectAccess: {
      async canViewTask() { return true; },
      async canViewProject(userId: string, _roles: string[], projectId: string) { return userId === 'admin' || projectId === 'p1'; },
      async accessibleProjectIds(userId: string) { return userId === 'admin' ? null : ['p1']; },
    } as never,
  });
});
afterAll(async () => {
  await app.close();
  vi.useRealTimers();
});

async function get(url: string, userId = 'u1') {
  const token = (await tokenService.issueTokens({ id: userId, roles: userId === 'admin' ? ['ADMIN'] : ['EMPLOYEE'] })).accessToken;
  return app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` } });
}
const titles = (res: { json(): { data: { title: string }[] } }) => res.json().data.map((t) => t.title).sort();

describe('GET /tasks?month= (the month view)', () => {
  it('a project’s month: its spans, due dates, starts, completions and overdue carry-over — and how many have no dates', async () => {
    const res = await get('/tasks?projectId=p1&month=2026-11');
    expect(res.statusCode).toBe(200);
    expect(titles(res)).toEqual(['Done in Nov', 'Due in Nov', 'Overdue from Oct', 'Spans Oct–Dec', 'Started in Oct, no due'].sort());
    expect(res.json().meta).toEqual({ month: '2026-11', undated: 2 });
  });

  it('another month: no carry-over outside the current month', async () => {
    expect(titles(await get('/tasks?projectId=p1&month=2026-12'))).toEqual(['Due in Dec', 'Spans Oct–Dec', 'Started in Oct, no due', 'Starts in Dec'].sort());
    expect(titles(await get('/tasks?projectId=p1&month=2026-10'))).toEqual(['Done in Oct', 'Overdue from Oct', 'Spans Oct–Dec', 'Started in Oct, no due'].sort());
  });

  it('undated=true adds the tasks without dates', async () => {
    const res = await get('/tasks?projectId=p1&month=2026-11&undated=true');
    expect(titles(res)).toContain('No dates');
    expect(titles(res)).toContain('No dates, high');
    expect(res.json().data).toHaveLength(7);
    expect(res.json().meta).toEqual({ month: '2026-11', undated: 2 });
  });

  it('the list’s other filters narrow the month and its undated count alike', async () => {
    const res = await get('/tasks?projectId=p1&month=2026-11&priority=HIGH');
    expect(titles(res)).toEqual(['Overdue from Oct']);
    expect(res.json().meta).toEqual({ month: '2026-11', undated: 1 });
  });

  it('asks the database for a window a day wider each side, with carry-over only for the current month', async () => {
    filters.length = 0;
    await get('/tasks?projectId=p1&month=2026-11');
    await get('/tasks?projectId=p1&month=2026-12');
    expect(filters[0]!.month).toEqual({ from: day('2026-10-31'), to: day('2026-12-02'), carry: true });
    expect(filters[1]!.month).toEqual({ from: day('2026-11-30'), to: day('2027-01-02'), carry: false });
    // Month view ignores the board's day.
    expect(filters[0]!.boardDate).toBeUndefined();
  });

  it('pages over the month like the plain list', async () => {
    const res = await get('/tasks?projectId=p1&month=2026-11&limit=2');
    expect(res.json().data).toHaveLength(2);
    expect(res.json().meta).toEqual({ total: 5, offset: 0, limit: 2, month: '2026-11', undated: 2 });
  });

  it('refuses a month that isn’t one, and a day and a month together', async () => {
    for (const bad of ['2026-13', '2026-1', '2026-11-01', 'november']) expect((await get(`/tasks?projectId=p1&month=${bad}`)).statusCode, bad).toBe(400);
    const both = await get('/tasks?projectId=p1&month=2026-11&boardDate=2026-11-07');
    expect(both.statusCode).toBe(400);
    expect(both.json().error.message).toBe('Ask for a day or a month, not both.');
  });

  it('a project the person can’t see: 403, nothing about its tasks', async () => {
    const res = await get('/tasks?projectId=p2&month=2026-11');
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('p2 in Nov');
  });

  it('All projects: only the projects the person can see — rows and the undated count', async () => {
    const mine = await get('/tasks?month=2026-11');
    expect(titles(mine)).not.toContain('p2 in Nov');
    expect(mine.json().meta.undated).toBe(2);
    const admin = await get('/tasks?month=2026-11', 'admin');
    expect(titles(admin)).toContain('p2 in Nov');
    expect(admin.json().meta.undated).toBe(3);
  });

  it('without a month the list is as before (no meta)', async () => {
    const res = await get('/tasks?projectId=p1');
    expect(res.json().meta).toBeUndefined();
    expect(res.json().data).toHaveLength(10);
  });
});
