import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createSearchService, type SearchData } from './search-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

// Two projects; u1 belongs to p1 only. Users carry an email in the source data to prove it is stripped.
const data: SearchData = {
  tasks: [
    { id: 't1', key: 'MICO-1', title: 'Prepare report', projectId: 'p1' },
    { id: 't2', key: 'RIG-1', title: 'Prepare rig report', projectId: 'p2' },
  ],
  projects: [
    { id: 'p1', code: 'MICO', name: 'MICO360' },
    { id: 'p2', code: 'RIG', name: 'Rig Inspection' },
  ],
  users: [{ id: 'u1', username: 'ada', email: 'ada@x.co', firstName: 'Ada', lastName: 'Lovelace' }],
};

const tokenService = createTokenService({
  accessSecret: 'srch-access',
  refreshSecret: 'srch-refresh',
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
  const searchService = createSearchService({ data: { async getSearchData() { return data; } } });
  return buildApp({ authService, tokenService, searchService, projectAccess });
}
const tokenFor = async (id: string, roles: string[]) => (await tokenService.issueTokens({ id, roles })).accessToken;

describe('Search routes — object-level scope', () => {
  it('scopes an employee to their own projects', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=report', headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.tasks.map((t: { key: string }) => t.key)).toEqual(['MICO-1']);
    const rig = await app.inject({ method: 'GET', url: '/api/v1/search?q=rig', headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` } });
    expect(rig.json().data.projects).toHaveLength(0);
  });

  it('never returns user emails', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=ada', headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` } });
    const users = res.json().data.users;
    expect(users).toHaveLength(1);
    expect(users[0]).not.toHaveProperty('email');
  });

  it('lets an admin search across every project', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=report', headers: { authorization: `Bearer ${await tokenFor('admin', ['ADMIN'])}` } });
    expect(res.json().data.tasks).toHaveLength(2);
  });

  it('rejects unauthenticated search (401)', async () => {
    const app = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/search?q=x' })).statusCode).toBe(401);
  });
});
