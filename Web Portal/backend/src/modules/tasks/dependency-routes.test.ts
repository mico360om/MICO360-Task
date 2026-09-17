import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createDependencyService } from './dependency-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { DependencyEdge, DependencyRepository } from './dependency-repository';
import type { TaskLookup } from './assignee-repository';

function inMemory() {
  const edges = new Map<string, DependencyEdge>();
  let seq = 0;
  const key = (t: string, d: string) => `${t}->${d}`;
  const repo: DependencyRepository = {
    async add(taskId, dependsOnTaskId) {
      const e = { id: `e${seq++}`, taskId, dependsOnTaskId };
      edges.set(key(taskId, dependsOnTaskId), e);
      return e;
    },
    async remove(taskId, dependsOnTaskId) { edges.delete(key(taskId, dependsOnTaskId)); },
    async exists(taskId, dependsOnTaskId) { return edges.has(key(taskId, dependsOnTaskId)); },
    async dependsOn(taskId) { return [...edges.values()].filter((e) => e.taskId === taskId).map((e) => e.dependsOnTaskId); },
    async blocks(taskId) { return [...edges.values()].filter((e) => e.dependsOnTaskId === taskId).map((e) => e.taskId); },
  };
  const taskLookup: TaskLookup = { async exists(id) { return ['t1', 't2', 't3'].includes(id); } };
  return { repo, taskLookup };
}

const tokenService = createTokenService({
  accessSecret: 'dep-access',
  refreshSecret: 'dep-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

async function makeApp() {
  const dependencyService = createDependencyService(inMemory());
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, dependencyService });
}
async function token(id: string) {
  return (await tokenService.issueTokens({ id, roles: ['EMPLOYEE'] })).accessToken;
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});

describe('Dependency routes', () => {
  it('adds a dependency (201) and lists it both ways', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/t1/dependencies',
      headers: { authorization: `Bearer ${await token('u1')}` },
      payload: { dependsOnTaskId: 't2' },
    });
    expect(res.statusCode).toBe(201);

    const list = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/dependencies', headers: { authorization: `Bearer ${await token('u1')}` } });
    expect(list.json().data.blockedBy).toEqual(['t2']);
    const other = await app.inject({ method: 'GET', url: '/api/v1/tasks/t2/dependencies', headers: { authorization: `Bearer ${await token('u1')}` } });
    expect(other.json().data.blocks).toEqual(['t1']);
  });

  it('rejects a circular dependency (409)', async () => {
    const tok = await token('u1');
    await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/dependencies', headers: { authorization: `Bearer ${tok}` }, payload: { dependsOnTaskId: 't2' } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/t2/dependencies', headers: { authorization: `Bearer ${tok}` }, payload: { dependsOnTaskId: 't1' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DEPENDENCY_CYCLE');
  });

  it('removes a dependency (204)', async () => {
    const tok = await token('u1');
    await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/dependencies', headers: { authorization: `Bearer ${tok}` }, payload: { dependsOnTaskId: 't2' } });
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/tasks/t1/dependencies/t2', headers: { authorization: `Bearer ${tok}` } });
    expect(del.statusCode).toBe(204);
  });

  it('rejects unauthenticated access (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/dependencies' });
    expect(res.statusCode).toBe(401);
  });
});
