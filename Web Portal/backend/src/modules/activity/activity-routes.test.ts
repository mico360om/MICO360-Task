import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createActivityService } from './activity-service';
import type { ActivityRecord, ActivityRepository } from './activity-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

// Recent activity spans two projects; u1 belongs to p1 only.
const rows: ActivityRecord[] = [
  { id: 'a1', taskId: 't1', projectId: 'p1', userId: 'u1', action: 'CREATED', meta: null, createdAt: new Date() },
  { id: 'a2', taskId: 't2', projectId: 'p2', userId: 'u2', action: 'MOVED', meta: null, createdAt: new Date() },
];
const activities: ActivityRepository = {
  async create(data) { return { id: 'x', taskId: data.taskId ?? null, projectId: data.projectId ?? null, userId: data.userId, action: data.action, meta: data.meta ?? null, createdAt: new Date() }; },
  async listForTask(taskId) { return rows.filter((r) => r.taskId === taskId); },
  async listRecent() { return rows; },
};

const tokenService = createTokenService({
  accessSecret: 'act-access',
  refreshSecret: 'act-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

const membership: Record<string, string[]> = { p1: ['u1'] };
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

async function makeApp() {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, activityService: createActivityService({ activities }), projectAccess });
}
const tokenFor = async (id: string, roles: string[]) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

describe('Activity routes — object-level scope', () => {
  it('scopes the global feed to the employee’s projects', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/activity', headers: await tokenFor('u1', ['EMPLOYEE']) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((r: { id: string }) => r.id)).toEqual(['a1']);
  });

  it('shows an admin the whole feed', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/activity', headers: await tokenFor('admin', ['ADMIN']) });
    expect(res.json().data).toHaveLength(2);
  });

  it('rejects unauthenticated access (401)', async () => {
    const app = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/activity' })).statusCode).toBe(401);
  });
});
