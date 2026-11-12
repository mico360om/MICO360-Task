import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildApp } from './app';
import { createTokenService } from './modules/auth/token-service';
import { createAuthService } from './modules/auth/auth-service';
import { createAuthGuard, type UserState } from './modules/auth/auth-guard';
import { createTaskService } from './modules/tasks/task-service';
import { createMemoryIdempotencyStore } from './lib/idempotency';
import type { CreateTaskData, TaskRecord, TaskRepository } from './modules/tasks/task-repository';

// Review fix N1 (13 Nov 2026): the server shares ONE sign-in check (and its 10-second account cache)
// between the routes and the code that ends sessions, so a deactivation, a password change or a role
// change is refused on the very next request — not up to 10 seconds later.
const tokenService = createTokenService({
  accessSecret: 'sg-access',
  refreshSecret: 'sg-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

const states = new Map<string, UserState>();
const userState = async (id: string) => states.get(id) ?? null;
const bearer = async (id: string, roles: string[], ver = 0) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles, tokenVersion: ver })).accessToken}` });

afterEach(() => {
  states.clear();
  vi.useRealTimers();
});

describe('one shared sign-in check (N1)', () => {
  it('buildApp uses the guard it is given: forgetting an account there refuses its revoked token at once', async () => {
    const guard = createAuthGuard(tokenService, { userState });
    const app = await buildApp({ authService, tokenService, userState, authGuard: guard });
    states.set('a1', { active: true, tokenVersion: 0, roles: ['ADMIN'] });
    const h = await bearer('a1', ['ADMIN']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/metrics', headers: h })).statusCode).toBe(200);

    // An administrator deactivates them (status off, token version raised); the revoke forgets the cache.
    states.set('a1', { active: false, tokenVersion: 1, roles: ['ADMIN'] });
    guard.forgetUser('a1');
    const after = await app.inject({ method: 'GET', url: '/api/v1/metrics', headers: h });
    expect(after.statusCode).toBe(401);
    await app.close();
  });

  it('without a forget the cache still holds for up to 10 seconds (what N1 was), then refuses', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T08:00:00Z'));
    const guard = createAuthGuard(tokenService, { userState });
    const app = await buildApp({ authService, tokenService, userState, authGuard: guard });
    states.set('a1', { active: true, tokenVersion: 0, roles: ['ADMIN'] });
    const h = await bearer('a1', ['ADMIN']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/metrics', headers: h })).statusCode).toBe(200);
    states.set('a1', { active: false, tokenVersion: 1, roles: ['ADMIN'] });
    expect((await app.inject({ method: 'GET', url: '/api/v1/metrics', headers: h })).statusCode).toBe(200);
    vi.setSystemTime(new Date('2026-11-13T08:00:11Z'));
    expect((await app.inject({ method: 'GET', url: '/api/v1/metrics', headers: h })).statusCode).toBe(401);
    await app.close();
  });
});

// Review fix #3 (13 Nov 2026): a repeated request (same Idempotency-Key) is answered from the store only
// while the session is still current — the same check (and cache) the routes use.

function fakeTasks() {
  const rows: TaskRecord[] = [];
  const repo = {
    async create(data: CreateTaskData) {
      const now = new Date();
      const rec = {
        ...data, id: `t${rows.length + 1}`, position: 0, progress: 0, columnCategory: 'TODO', version: 0, createdAt: now, updatedAt: now,
        description: data.description ?? null, completedAt: null, recurrenceRule: null, recurrenceParentId: null, formerKeys: [],
      } as unknown as TaskRecord;
      rows.push(rec);
      return rec;
    },
    async findById(id: string) { return rows.find((r) => r.id === id) ?? null; },
    async countByProject() { return rows.length; },
    async findColumn(id: string) { return { id, projectId: 'p1', category: 'TODO' }; },
  } as unknown as TaskRepository;
  return { repo, rows };
}
const body = { title: 'Pour slab', projectId: 'p1', columnId: 'c1' };

async function taskApp() {
  const { repo, rows } = fakeTasks();
  const taskService = createTaskService({ tasks: repo, projects: { async getCodeById() { return 'P1'; }, async getTaskSettings() { return null; } } });
  const store = createMemoryIdempotencyStore();
  const guard = createAuthGuard(tokenService, { userState });
  const app = await buildApp({
    authService,
    tokenService,
    taskService,
    userState,
    authGuard: guard,
    projectAccess: { async canViewTask() { return true; }, async canViewProject() { return true; }, async canViewColumn() { return true; }, async accessibleProjectIds() { return ['p1']; } } as never,
    idempotencyStore: store,
  });
  return { app, rows, store, guard };
}

describe('a repeated request is answered only while the session is current (#3)', () => {
  it('a deactivated user replaying their own key gets 401, not the stored answer', async () => {
    states.set('u1', { active: true, tokenVersion: 0, roles: ['EMPLOYEE'] });
    const { app, rows, guard } = await taskApp();
    const h = { ...(await bearer('u1', ['EMPLOYEE'])), 'idempotency-key': 'K1' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks', headers: h, payload: body })).statusCode).toBe(201);
    states.set('u1', { active: false, tokenVersion: 1, roles: ['EMPLOYEE'] });
    guard.forgetUser('u1');
    const replay = await app.inject({ method: 'POST', url: '/api/v1/tasks', headers: h, payload: body });
    expect(replay.statusCode).toBe(401);
    expect(replay.headers['idempotent-replay']).toBeUndefined();
    expect(rows.length).toBe(1);
    await app.close();
  });

  it('…even past the 10-second cache, with no forget at all (the reviewers’ repro)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T08:00:00Z'));
    states.set('u1', { active: true, tokenVersion: 0, roles: ['EMPLOYEE'] });
    const { app } = await taskApp();
    const h = { ...(await bearer('u1', ['EMPLOYEE'])), 'idempotency-key': 'K1' };
    await app.inject({ method: 'POST', url: '/api/v1/tasks', headers: h, payload: body });
    states.set('u1', { active: false, tokenVersion: 1, roles: ['EMPLOYEE'] });
    vi.setSystemTime(new Date('2026-11-13T08:00:11Z'));
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks', headers: h, payload: body })).statusCode).toBe(401);
    await app.close();
  });

  it('a stale session reserves nothing: no 401 is stored to be replayed after signing in again', async () => {
    states.set('u1', { active: true, tokenVersion: 1, roles: ['EMPLOYEE'] });
    const { app, store, rows } = await taskApp();
    const stale = { ...(await bearer('u1', ['EMPLOYEE'], 0)), 'idempotency-key': 'K9' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks', headers: stale, payload: body })).statusCode).toBe(401);
    expect(await store.find('u1', 'K9')).toBeNull();
    const fresh = { ...(await bearer('u1', ['EMPLOYEE'], 1)), 'idempotency-key': 'K9' };
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks', headers: fresh, payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.headers['idempotent-replay']).toBeUndefined();
    expect(rows.length).toBe(1);
    await app.close();
  });

  it('a current session still gets its replay (offline queues and retries keep working)', async () => {
    states.set('u1', { active: true, tokenVersion: 0, roles: ['EMPLOYEE'] });
    const { app, rows } = await taskApp();
    const h = { ...(await bearer('u1', ['EMPLOYEE'])), 'idempotency-key': 'K2' };
    const first = await app.inject({ method: 'POST', url: '/api/v1/tasks', headers: h, payload: body });
    const replay = await app.inject({ method: 'POST', url: '/api/v1/tasks', headers: h, payload: body });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(rows.length).toBe(1);
    await app.close();
  });
});
