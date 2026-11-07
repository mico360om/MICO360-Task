import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { ProjectAccess } from '../projects/project-access';
import type { ActivityService } from '../activity/activity-service';
import type { ProjectHealthService } from './health-service';

// 1.23.5 — the project page's Overview: health, Next actions and Recent activity, only for people who
// may see the project (a 404 otherwise), staff only (a client account is refused).
const tokenService = createTokenService({
  accessSecret: 'health-access',
  refreshSecret: 'health-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

const DETAIL = { projectId: 'p1', rag: 'AMBER', reasons: [], risks: [], owners: { owner: null, managers: [], milestones: [] } };
const ACTIONS = { today: '2026-11-20', timeZone: 'Asia/Muscat', manager: false, items: [], total: 0, counts: {}, watch: ['p1'] };

async function setup() {
  const health = {
    cards: vi.fn(async () => new Map()),
    detail: vi.fn(async (id: string) => (id === 'p1' ? DETAIL : null)),
    nextActions: vi.fn(async (id: string) => (id === 'p1' ? ACTIONS : null)),
    changed: vi.fn(),
  } as unknown as Pick<ProjectHealthService, 'cards' | 'detail' | 'nextActions' | 'changed'>;
  // u1 is on p1's team; u2 isn't.
  const projectAccess = {
    canViewProject: async (u: string, roles: string[], p: string) => roles.includes('ADMIN') || (u === 'u1' && p === 'p1'),
    canViewTask: async (u: string, _r: string[], t: string) => u === 'u1' && t !== 'hidden',
    canViewColumn: async () => true,
    accessibleProjectIds: async () => ['p1'],
  } as unknown as ProjectAccess;
  const lines = [
    { id: 'a1', taskId: 't1', projectId: 'p1', userId: 'u1', action: 'MOVED', meta: { from: 'To Do', to: 'Done' }, createdAt: new Date() },
    { id: 'a2', taskId: 't1', projectId: 'p1', userId: 'u1', action: 'BLOCKER_ADDED', meta: { dependsOnTaskId: 'hidden', key: 'OPS-1', title: 'Secret' }, createdAt: new Date() },
  ];
  const listRecent = vi.fn(async () => lines);
  const activityService = { listRecent } as unknown as ActivityService;
  const app = await buildApp({ authService, tokenService, projectHealth: health, projectAccess, activityService });
  const as = async (id: string, roles: string[] = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });
  return { app, as, health, listRecent };
}

describe('GET /projects/:id/health', () => {
  it('answers the project’s health to someone who may see it; a 404 to anyone else', async () => {
    const { app, as } = await setup();
    const ok = await app.inject({ method: 'GET', url: '/api/v1/projects/p1/health', headers: await as('u1') });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toEqual(DETAIL);
    expect((await app.inject({ method: 'GET', url: '/api/v1/projects/p1/health', headers: await as('u2') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/projects/zz/health', headers: await as('admin', ['ADMIN']) })).statusCode).toBe(404);
  });

  it('needs a signed-in staff member: no session 401, a client account 403', async () => {
    const { app, as } = await setup();
    for (const url of ['/api/v1/projects/p1/health', '/api/v1/projects/p1/next-actions', '/api/v1/projects/p1/activity']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      const client = await app.inject({ method: 'GET', url, headers: await as('c1', ['CLIENT']) });
      expect(client.statusCode).toBe(403);
      expect(client.json().error.code).toBe('CLIENT_NOT_ALLOWED');
    }
  });
});

describe('GET /projects/:id/next-actions', () => {
  it('the project’s Next actions, asked fresh after the person’s own change', async () => {
    const { app, as, health } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/p1/next-actions', headers: await as('u1') });
    expect(res.json().data).toEqual(ACTIONS);
    expect(health.nextActions).toHaveBeenLastCalledWith('p1', { fresh: false, viewer: { id: 'u1', roles: ['EMPLOYEE'] } });
    await app.inject({ method: 'GET', url: '/api/v1/projects/p1/next-actions?fresh=1', headers: await as('u1') });
    expect(health.nextActions).toHaveBeenLastCalledWith('p1', { fresh: true, viewer: { id: 'u1', roles: ['EMPLOYEE'] } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/projects/p1/next-actions', headers: await as('u2') })).statusCode).toBe(404);
  });
});

describe('GET /projects/:id/activity', () => {
  it('the project’s latest 10 entries; a blocker the reader can’t open isn’t named', async () => {
    const { app, as, listRecent } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/p1/activity', headers: await as('u1') });
    expect(res.statusCode).toBe(200);
    expect(listRecent).toHaveBeenCalledWith(10, ['p1']);
    const [, blocker] = res.json().data;
    expect(JSON.stringify(blocker)).not.toContain('Secret');
    expect((await app.inject({ method: 'GET', url: '/api/v1/projects/p1/activity', headers: await as('u2') })).statusCode).toBe(404);
  });
});
