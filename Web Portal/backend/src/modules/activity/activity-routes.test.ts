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
const scopes: (string[] | null | undefined)[] = [];
const activities: ActivityRepository = {
  async create(data) { return { id: 'x', taskId: data.taskId ?? null, projectId: data.projectId ?? null, userId: data.userId, action: data.action, meta: data.meta ?? null, createdAt: new Date() }; },
  async listForTask(taskId) { return rows.filter((r) => r.taskId === taskId); },
  async listRecent(limit, projectIds) {
    scopes.push(projectIds);
    return rows.filter((r) => !projectIds || projectIds.includes(r.projectId ?? '')).slice(0, limit ?? 50);
  },
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

  it('scopes the feed in the query (before the 50-row limit), not after it', async () => {
    const app = await makeApp();
    scopes.length = 0;
    await app.inject({ method: 'GET', url: '/api/v1/activity', headers: await tokenFor('u1', ['EMPLOYEE']) });
    await app.inject({ method: 'GET', url: '/api/v1/activity', headers: await tokenFor('admin', ['ADMIN']) });
    expect(scopes).toEqual([['p1'], null]);
  });

  it('returns an empty feed to a user with no projects without querying', async () => {
    const app = await makeApp();
    scopes.length = 0;
    const res = await app.inject({ method: 'GET', url: '/api/v1/activity', headers: await tokenFor('loner', ['EMPLOYEE']) });
    expect(res.json().data).toEqual([]);
    expect(scopes).toEqual([]);
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

describe('Activity routes — a blocker is named only to someone who can open it', () => {
  // t1 (in p1) got two blockers: OPS-2, which u1 can open, and FIN-12, in a project u1 isn't on.
  const blockerRows: ActivityRecord[] = [
    { id: 'b1', taskId: 't1', projectId: 'p1', userId: 'u2', action: 'BLOCKER_ADDED', meta: { dependsOnTaskId: 'open-task', key: 'OPS-2', title: 'Order the parts' }, createdAt: new Date() },
    { id: 'b2', taskId: 't1', projectId: 'p1', userId: 'u2', action: 'BLOCKER_ADDED', meta: { dependsOnTaskId: 'hidden-task', key: 'FIN-12', title: 'Q4 payroll cuts' }, createdAt: new Date() },
    { id: 'b3', taskId: 't1', projectId: 'p1', userId: 'u2', action: 'BLOCKER_REMOVED', meta: { dependsOnTaskId: 'hidden-task', key: 'FIN-12', title: 'Q4 payroll cuts' }, createdAt: new Date() },
  ];
  const blockerApp = () =>
    buildApp({
      authService: createAuthService({
        users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
        maxAttempts: 5,
      }),
      tokenService,
      activityService: createActivityService({
        activities: { ...activities, async listForTask(taskId) { return blockerRows.filter((r) => r.taskId === taskId); }, async listRecent() { return blockerRows; } },
      }),
      projectAccess: { ...projectAccess, async canViewTask(userId: string, roles: string[], taskId: string) { return roles.includes('ADMIN') || taskId !== 'hidden-task'; } },
    });
  const names = (data: Array<{ id: string; meta: Record<string, unknown> | null }>) => data.map((r) => [r.id, r.meta?.key ?? null, r.meta?.title ?? null]);

  it('on a task’s timeline', async () => {
    const res = await (await blockerApp()).inject({ method: 'GET', url: '/api/v1/tasks/t1/activity', headers: await tokenFor('u1', ['EMPLOYEE']) });
    expect(res.statusCode).toBe(200);
    expect(names(res.json().data)).toEqual([['b1', 'OPS-2', 'Order the parts'], ['b2', null, null], ['b3', null, null]]);
    expect(JSON.stringify(res.json().data)).not.toContain('hidden-task');
  });

  it('in the activity feed', async () => {
    const res = await (await blockerApp()).inject({ method: 'GET', url: '/api/v1/activity', headers: await tokenFor('u1', ['EMPLOYEE']) });
    expect(names(res.json().data)).toEqual([['b1', 'OPS-2', 'Order the parts'], ['b2', null, null], ['b3', null, null]]);
  });

  it('an admin, who can open every task, sees every name', async () => {
    const res = await (await blockerApp()).inject({ method: 'GET', url: '/api/v1/tasks/t1/activity', headers: await tokenFor('admin', ['ADMIN']) });
    expect(names(res.json().data)).toEqual([['b1', 'OPS-2', 'Order the parts'], ['b2', 'FIN-12', 'Q4 payroll cuts'], ['b3', 'FIN-12', 'Q4 payroll cuts']]);
  });
});
