import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createMemberService } from './member-service';
import { createProjectAuthz } from './project-authz';
import type { MemberRepository, ProjectExistsLookup, ProjectMemberRole } from './member-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

function memoryRepo() {
  const links = new Map<string, ProjectMemberRole>();
  const base: Record<string, { id: string; username: string; email: string; firstName: string; lastName: string }> = {
    u2: { id: 'u2', username: 'omar', email: 'o@x', firstName: 'Omar', lastName: 'A' },
  };
  const repo: MemberRepository = {
    async list(pid) { return [...links.entries()].filter(([k]) => k.startsWith(`${pid}:`)).map(([k, role]) => ({ ...base[k.split(':')[1]!]!, role })); },
    async add(pid, uid) { if (!links.has(`${pid}:${uid}`)) links.set(`${pid}:${uid}`, 'MEMBER'); },
    async remove(pid, uid) { links.delete(`${pid}:${uid}`); },
    async setRole(pid, uid, role) { links.set(`${pid}:${uid}`, role); },
  };
  return repo;
}

const tokenService = createTokenService({ accessSecret: 'mr-a', refreshSecret: 'mr-r', accessTtl: 900, refreshTtl: 1000, refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} } });
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

// "mgr" is a MANAGER of p1; "emp" is a plain employee.
const projectAuthz = createProjectAuthz({
  managers: {
    async isManager(userId, projectId) { return userId === 'mgr' && projectId === 'p1'; },
    async projectIdOfColumn() { return null; },
    async projectIdOfTask() { return null; },
  },
});

async function makeApp() {
  const projects: ProjectExistsLookup = { async exists(id) { return id === 'p1'; } };
  const memberService = createMemberService({ repo: memoryRepo(), projects });
  return buildApp({ authService, tokenService, memberService, projectAuthz });
}
async function token(id: string, roles: string[]) {
  return (await tokenService.issueTokens({ id, roles })).accessToken;
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => { app = await makeApp(); });

describe('Project member routes (T2.7 per-project grant)', () => {
  it('an admin can add a member', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/p1/members', headers: { authorization: `Bearer ${await token('a', ['ADMIN'])}` }, payload: { userIds: ['u2'] } });
    expect(res.statusCode).toBe(200);
  });

  it('a plain employee cannot add a member (403)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/p1/members', headers: { authorization: `Bearer ${await token('emp', ['EMPLOYEE'])}` }, payload: { userIds: ['u2'] } });
    expect(res.statusCode).toBe(403);
  });

  it('a project MANAGER can add a member and set roles', async () => {
    const tok = `Bearer ${await token('mgr', ['EMPLOYEE'])}`;
    const add = await app.inject({ method: 'POST', url: '/api/v1/projects/p1/members', headers: { authorization: tok }, payload: { userIds: ['u2'] } });
    expect(add.statusCode).toBe(200);
    const role = await app.inject({ method: 'PATCH', url: '/api/v1/projects/p1/members/u2', headers: { authorization: tok }, payload: { role: 'MANAGER' } });
    expect(role.statusCode).toBe(200);
    expect(role.json().data.find((m: { id: string }) => m.id === 'u2').role).toBe('MANAGER');
  });

  it('a manager of a different project cannot manage p1 (403)', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/projects/p1/members/u2', headers: { authorization: `Bearer ${await token('other-mgr', ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(403);
  });
});
