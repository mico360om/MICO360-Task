import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createWatcherService } from './watcher-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { WatcherRepository, WatcherUser } from './watcher-repository';
import type { TaskService } from './task-service';

function inMemory() {
  const map = new Map<string, Set<string>>();
  const user = (id: string): WatcherUser => ({ id, username: id, email: `${id}@x`, firstName: id, lastName: '' });
  const repo: WatcherRepository = {
    async add(taskId, userId) { (map.get(taskId) ?? map.set(taskId, new Set()).get(taskId)!).add(userId); },
    async remove(taskId, userId) { map.get(taskId)?.delete(userId); },
    async list(taskId) { return [...(map.get(taskId) ?? [])].map(user); },
    async isWatching(taskId, userId) { return !!map.get(taskId)?.has(userId); },
    async listWatcherIds(taskId) { return [...(map.get(taskId) ?? [])]; },
  };
  const taskLookup = { async exists(id: string) { return id === 't1'; } };
  return { repo, taskLookup };
}

const tokenService = createTokenService({
  accessSecret: 'wch-access',
  refreshSecret: 'wch-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

async function makeApp() {
  const watcherService = createWatcherService(inMemory());
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const taskService = { async getTask() { return { projectId: 'p1' }; } } as unknown as TaskService;
  return buildApp({ authService, tokenService, watcherService, taskService });
}
async function token(id = 'u1') {
  return (await tokenService.issueTokens({ id, roles: ['EMPLOYEE'] })).accessToken;
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});

describe('Watcher routes', () => {
  it('lets a user watch a task, then reports the watching state', async () => {
    const headers = { authorization: `Bearer ${await token()}` };
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/watch', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.watching).toBe(true);
    expect(res.json().data.watchers[0].id).toBe('u1');

    const status = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/watch', headers });
    expect(status.json().data.watching).toBe(true);
  });

  it('unwatches a task (204) and clears the state', async () => {
    const headers = { authorization: `Bearer ${await token()}` };
    await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/watch', headers });
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/tasks/t1/watch', headers });
    expect(del.statusCode).toBe(204);
    const status = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/watch', headers });
    expect(status.json().data.watching).toBe(false);
  });

  it('lists all watchers of a task', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/watch', headers: { authorization: `Bearer ${await token('u1')}` } });
    await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/watch', headers: { authorization: `Bearer ${await token('u2')}` } });
    const list = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/watchers', headers: { authorization: `Bearer ${await token('u1')}` } });
    expect(list.json().data.map((w: { id: string }) => w.id).sort()).toEqual(['u1', 'u2']);
  });

  it('rejects unauthenticated access (401) and unknown tasks (404)', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/watch' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/ghost/watch', headers: { authorization: `Bearer ${await token()}` } });
    expect(res.statusCode).toBe(404);
  });
});
