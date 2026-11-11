import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../app';
import { createTaskService } from './task-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { TaskListFilter, TaskRecord, TaskRepository } from './task-repository';
import { archivedWhere, isCountedTask } from './task-archive-where';

// Task archive (bulk lane): GET /tasks never lists archived tasks (every board, list, the app and the
// extension); a project's "Archived tasks" list asks for them with archived=only (one project at a time,
// anyone who sees it, newest archived first).
const NOW = new Date('2026-11-11T08:00:00.000Z');
const tokenService = createTokenService({
  accessSecret: 'arch-access',
  refreshSecret: 'arch-refresh',
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
    recurrenceRule: null, recurrenceParentId: null, boardDate: null, version: 0, createdAt: NOW, updatedAt: NOW, archivedAt: null, archivedById: null, ...extra,
  } as TaskRecord;
}

const ROWS: TaskRecord[] = [
  row('Live one'),
  row('Archived first', { archivedAt: new Date('2026-11-01T08:00:00Z'), archivedById: 'u9' }),
  row('Archived later', { archivedAt: new Date('2026-11-09T08:00:00Z'), archivedById: 'u9' }),
  row('Other project archived', { projectId: 'p2', archivedAt: new Date('2026-11-05T08:00:00Z') }),
  // A weekly series whose newest copy (it carries the repeat) is archived: the series goes on.
  row('Archived weekly head', { archivedAt: new Date('2026-11-10T08:00:00Z'), dueDate: new Date('2026-11-10T00:00:00Z'), recurrenceRule: { freq: 'WEEKLY', interval: 1 } as never }),
];

const filters: TaskListFilter[] = [];
// Behaves as the database does: the archived option decides which archived rows come back.
const repo = {
  async list(filter: TaskListFilter) {
    filters.push(filter);
    const a = filter.archived ?? 'exclude';
    return ROWS.filter((t) => (!filter.projectId || t.projectId === filter.projectId) && (!filter.projectIds || filter.projectIds.includes(t.projectId)))
      .filter((t) => (a === 'only' ? !!t.archivedAt : a === 'exclude' ? !t.archivedAt : true))
      .filter((t) => (filter.recurring ? !!t.recurrenceRule : true));
  },
} as unknown as TaskRepository;

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  const taskService = createTaskService({ tasks: repo, projects: { async getCodeById() { return 'MICO'; }, async getTaskSettings() { return null; } }, timeZone: 'Asia/Muscat' });
  app = await buildApp({
    authService,
    tokenService,
    taskService,
    projectAccess: {
      async canViewTask() { return true; },
      async canViewProject(userId: string, _roles: string[], projectId: string) { return userId === 'admin' || projectId === 'p1'; },
      async accessibleProjectIds(userId: string) { return userId === 'admin' ? null : ['p1']; },
    } as never,
  });
});
afterAll(async () => {
  await app.close();
});

async function get(url: string, userId = 'u1') {
  const token = (await tokenService.issueTokens({ id: userId, roles: userId === 'admin' ? ['ADMIN'] : ['EMPLOYEE'] })).accessToken;
  return app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` } });
}
const titles = (res: { json(): { data: { title: string }[] } }) => res.json().data.map((t) => t.title);

describe('GET /tasks and archived tasks', () => {
  it('a plain list (board, list, app, extension) never asks for archived tasks', async () => {
    filters.length = 0;
    const res = await get('/tasks?projectId=p1');
    expect(res.statusCode).toBe(200);
    expect(titles(res)).toEqual(['Live one']);
    expect(filters[0]!.archived ?? 'exclude').toBe('exclude');
    expect(titles(await get('/tasks?archived=exclude&projectId=p1'))).toEqual(['Live one']);
  });

  it('archived=only lists a project’s archived tasks, newest archived first, each saying when and by whom', async () => {
    const res = await get('/tasks?projectId=p1&archived=only');
    expect(res.statusCode).toBe(200);
    expect(titles(res)).toEqual(['Archived weekly head', 'Archived later', 'Archived first']);
    expect(res.json().data[1]).toMatchObject({ title: 'Archived later', archivedAt: '2026-11-09T08:00:00.000Z', archivedById: 'u9' });
    // A sort asked for wins.
    expect(titles(await get('/tasks?projectId=p1&archived=only&sort=title&order=asc'))).toEqual(['Archived first', 'Archived later', 'Archived weekly head']);
  });

  it('archived=only needs a project, and only one the person can see', async () => {
    expect((await get('/tasks?archived=only')).statusCode).toBe(400);
    expect((await get('/tasks?projectId=p2&archived=only')).statusCode).toBe(403);
    expect(titles(await get('/tasks?projectId=p2&archived=only', 'admin'))).toEqual(['Other project archived']);
    expect((await get('/tasks?projectId=p1&archived=all')).statusCode).toBe(400);
  });
});

describe('GET /calendar and an archived series head', () => {
  it('archiving the newest copy doesn’t stop its series: its days are still projected; the copy itself isn’t listed', async () => {
    const res = await get('/calendar?from=2026-11-12&to=2026-12-02');
    expect(res.statusCode).toBe(200);
    const data = res.json().data as { tasks: { title: string }[]; occurrences: { taskId: string; date: string }[]; series: { title: string }[] };
    expect(data.series.map((s) => s.title)).toEqual(['Archived weekly head']);
    expect(data.occurrences.map((o) => o.date)).toEqual(['2026-11-17', '2026-11-24', '2026-12-01']);
    expect(data.tasks.map((t) => t.title)).not.toContain('Archived weekly head');
  });
});

describe('task-archive-where', () => {
  it('lists leave archived tasks out unless asked; figures keep an archived Done task only', () => {
    expect(archivedWhere()).toEqual({ archivedAt: null });
    expect(archivedWhere('only')).toEqual({ archivedAt: { not: null } });
    expect(archivedWhere('include')).toEqual({});
    expect(archivedWhere('counted')).toHaveProperty('OR');
    const at = new Date();
    expect(isCountedTask({ archivedAt: null })).toBe(true);
    expect(isCountedTask({ archivedAt: at, columnCategory: 'DONE' })).toBe(true);
    expect(isCountedTask({ archivedAt: at, completedAt: at, columnCategory: 'TODO' })).toBe(true);
    expect(isCountedTask({ archivedAt: at, columnCategory: 'IN_PROGRESS' })).toBe(false);
  });
});
