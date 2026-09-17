import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createTagService } from './tag-service';
import { createMemoryTagRepository } from './tag-repository';

const tokenService = createTokenService({
  accessSecret: 'tag-access',
  refreshSecret: 'tag-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

async function makeApp() {
  const tagService = createTagService({
    repo: createMemoryTagRepository(),
    taskLookup: { async exists(id: string) { return id !== 'ghost'; } },
  });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, tagService });
}

const auth = async (roles: string[] = ['EMPLOYEE']) => ({
  authorization: `Bearer ${(await tokenService.issueTokens({ id: 'u1', roles })).accessToken}`,
});

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});

describe('Tag routes — object-level authorization', () => {
  // Only u1 may view the fixture tasks; everyone else is an outsider.
  const members = new Set(['u1']);
  const projectAccess = {
    async canViewProject(userId: string, roles: string[]) { return roles.includes('ADMIN') || members.has(userId); },
    async canViewTask(userId: string, roles: string[]) { return roles.includes('ADMIN') || members.has(userId); },
    async canViewColumn() { return true; },
    async accessibleProjectIds(userId: string, roles: string[]) { return roles.includes('ADMIN') ? null : members.has(userId) ? ['p1'] : []; },
  };
  async function build() {
    const tagService = createTagService({
      repo: createMemoryTagRepository(),
      taskLookup: { async exists(id: string) { return id !== 'ghost'; } },
    });
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    return buildApp({ authService, tokenService, tagService, projectAccess });
  }
  const tokenFor = async (id: string, roles: string[]) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

  it('403s a non-member reading or changing a task’s tags, but allows a member', async () => {
    const a = await build();
    const outsider = await tokenFor('u9', ['EMPLOYEE']);
    const member = await tokenFor('u1', ['EMPLOYEE']);
    expect((await a.inject({ method: 'GET', url: '/api/v1/tasks/t1/tags', headers: outsider })).statusCode).toBe(403);
    expect((await a.inject({ method: 'PUT', url: '/api/v1/tasks/t1/tags', headers: outsider, payload: { tags: ['x'] } })).statusCode).toBe(403);
    expect((await a.inject({ method: 'PUT', url: '/api/v1/tasks/t1/tags', headers: member, payload: { tags: ['x'] } })).statusCode).toBe(200);
  });
});

describe('Tag routes', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tags' });
    expect(res.statusCode).toBe(401);
  });

  it('sets, reads and clears a task’s tags', async () => {
    const headers = await auth();
    const put = await app.inject({ method: 'PUT', url: '/api/v1/tasks/t1/tags', headers, payload: { tags: ['Urgent', 'urgent', ' Backend '] } });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.map((t: { name: string }) => t.name)).toEqual(['Backend', 'Urgent']);

    const get = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/tags', headers });
    expect(get.json().data).toHaveLength(2);

    // the created tags show up in the shared catalog
    const cat = await app.inject({ method: 'GET', url: '/api/v1/tags', headers });
    expect(cat.json().data.map((t: { name: string }) => t.name)).toEqual(['Backend', 'Urgent']);

    const cleared = await app.inject({ method: 'PUT', url: '/api/v1/tasks/t1/tags', headers, payload: { tags: [] } });
    expect(cleared.json().data).toEqual([]);
  });

  it('removes a single tag', async () => {
    const headers = await auth();
    const put = await app.inject({ method: 'PUT', url: '/api/v1/tasks/t1/tags', headers, payload: { tags: ['keep', 'drop'] } });
    const drop = put.json().data.find((t: { name: string; id: string }) => t.name === 'drop');
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/tasks/t1/tags/${drop.id}`, headers });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/tags', headers });
    expect(get.json().data.map((t: { name: string }) => t.name)).toEqual(['keep']);
  });

  it('404s for an unknown task', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/ghost/tags', headers: await auth() });
    expect(res.statusCode).toBe(404);
  });

  it('rejects too many tags with a 400', async () => {
    const many = Array.from({ length: 11 }, (_, i) => `tag${i}`);
    const res = await app.inject({ method: 'PUT', url: '/api/v1/tasks/t1/tags', headers: await auth(), payload: { tags: many } });
    expect(res.statusCode).toBe(400);
  });
});
