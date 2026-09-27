import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createUserService } from './user-service';
import { createMemoryUserRepository } from './memory-user-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { AuditService } from '../audit/audit-service';

const tokenService = createTokenService({
  accessSecret: 'usr-access',
  refreshSecret: 'usr-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

let mem: ReturnType<typeof createMemoryUserRepository>;
let audited: { action: string; entityId: string | null }[];

async function makeApp() {
  mem = createMemoryUserRepository();
  audited = [];
  const auditService = {
    async record(d: { action: string; entityId?: string | null }) {
      audited.push({ action: d.action, entityId: d.entityId ?? null });
      return {} as never;
    },
    async list() {
      return [];
    },
  } as unknown as AuditService;
  const userService = createUserService({
    users: mem.repo,
    issueSession: (user) => tokenService.issueTokens(user),
  });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, userService, auditService });
}
async function token(roles: string[]) {
  return (await tokenService.issueTokens({ id: 'admin', roles })).accessToken;
}
async function tokenFor(id: string, roles: string[]) {
  return (await tokenService.issueTokens({ id, roles })).accessToken;
}

const newUser = { email: 'sara@x.co', username: 'sara', password: 'Password1!', firstName: 'Sara', lastName: 'A' };

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});

describe('User routes (admin only)', () => {
  it('lets an admin create a user (201)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: { authorization: `Bearer ${await token(['ADMIN'])}` }, payload: newUser });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.username).toBe('sara');
    expect(res.json().data.roles).toEqual(['EMPLOYEE']);
  });

  it('rejects a weak password on create (400 WEAK_PASSWORD)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: { authorization: `Bearer ${await token(['ADMIN'])}` }, payload: { ...newUser, password: '123456' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('WEAK_PASSWORD');
  });

  it('forbids an employee from creating a user (403)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` }, payload: newUser });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an unauthenticated list (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a duplicate user (409)', async () => {
    const headers = { authorization: `Bearer ${await token(['ADMIN'])}` };
    await app.inject({ method: 'POST', url: '/api/v1/users', headers, payload: newUser });
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers, payload: { ...newUser, username: 'sara2' } });
    expect(res.statusCode).toBe(409);
  });

  it('re-creates a deleted user’s account with the same email (201, not 500)', async () => {
    const headers = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const { id } = (await app.inject({ method: 'POST', url: '/api/v1/users', headers, payload: newUser })).json().data;
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/users/${id}`, headers })).statusCode).toBe(204);
    const again = await app.inject({ method: 'POST', url: '/api/v1/users', headers, payload: newUser });
    expect(again.statusCode).toBe(201);
  });
});

describe('User profile & role editing', () => {
  async function createSara(roleNames?: string[]) {
    const headers = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers, payload: { ...newUser, ...(roleNames ? { roleNames } : {}) } });
    return res.json().data as { id: string };
  }

  it('lets an admin edit email, username and roles (PUT)', async () => {
    const headers = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const { id } = await createSara();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${id}`,
      headers,
      payload: { firstName: 'Sarah', email: 'sarah@x.co', username: 'sarah', roleNames: ['MANAGER'] },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.email).toBe('sarah@x.co');
    expect(d.username).toBe('sarah');
    expect(d.roles).toEqual(['MANAGER']);
  });

  it('rejects removing every role (400)', async () => {
    const headers = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const { id } = await createSara();
    const res = await app.inject({ method: 'PUT', url: `/api/v1/users/${id}`, headers, payload: { roleNames: [] } });
    expect(res.statusCode).toBe(400);
  });

  it('refuses to demote or deactivate the last active admin (409 LAST_ADMIN)', async () => {
    const headers = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const { id } = await createSara(['ADMIN']);
    const demote = await app.inject({ method: 'PUT', url: `/api/v1/users/${id}`, headers, payload: { roleNames: ['EMPLOYEE'] } });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().error.code).toBe('LAST_ADMIN');
    const deactivate = await app.inject({ method: 'PATCH', url: `/api/v1/users/${id}/status`, headers, payload: { status: 'INACTIVE' } });
    expect(deactivate.statusCode).toBe(409);
    const remove = await app.inject({ method: 'DELETE', url: `/api/v1/users/${id}`, headers });
    expect(remove.statusCode).toBe(409);
  });

  it('forbids a non-admin from editing a user (403)', async () => {
    const { id } = await createSara();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${id}`,
      headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` },
      payload: { firstName: 'Nope' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Account lockout (admin view + unlock)', () => {
  it('shows the lock state in the user list and lets an admin unlock (audited)', async () => {
    const headers = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const { id } = (await app.inject({ method: 'POST', url: '/api/v1/users', headers, payload: newUser })).json().data;
    mem.lock(id, new Date(Date.now() + 15 * 60_000));

    const list = await app.inject({ method: 'GET', url: '/api/v1/users', headers });
    expect(list.json().data.find((u: { id: string }) => u.id === id).locked).toBe(true);

    const res = await app.inject({ method: 'POST', url: `/api/v1/users/${id}/unlock`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.locked).toBe(false);
    expect(audited).toContainEqual({ action: 'user.unlock', entityId: id });
  });

  it('forbids a non-admin from unlocking (403)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/users/u0/unlock', headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe('Password management', () => {
  async function createSara() {
    const headers = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers, payload: newUser });
    return res.json().data as { id: string };
  }

  it('lets an admin reset a user’s password (204)', async () => {
    const headers = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const { id } = await createSara();
    const res = await app.inject({ method: 'POST', url: `/api/v1/users/${id}/password`, headers, payload: { password: 'FreshPass1!' } });
    expect(res.statusCode).toBe(204);
  });

  it('forbids a non-admin from resetting another user’s password (403)', async () => {
    const { id } = await createSara();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${id}/password`,
      headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` },
      payload: { password: 'FreshPass1!' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an admin reset with a password that fails the policy (400)', async () => {
    const headers = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const { id } = await createSara();
    for (const password of ['123', '123456', 'aaaaaaaa']) {
      const res = await app.inject({ method: 'POST', url: `/api/v1/users/${id}/password`, headers, payload: { password } });
      expect(res.statusCode).toBe(400);
    }
  });

  it('changes your own password and returns a fresh session (200)', async () => {
    const { id } = await createSara();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/password',
      headers: { authorization: `Bearer ${await tokenFor(id, ['EMPLOYEE'])}` },
      payload: { currentPassword: 'Password1!', newPassword: 'NextPass1!' },
    });
    expect(res.statusCode).toBe(200);
    const { accessToken, refreshToken } = res.json().data;
    expect(typeof refreshToken).toBe('string');
    const claims = tokenService.verifyAccess(accessToken);
    expect(claims.sub).toBe(id);
    expect(claims.ver).toBe(mem.tokenVersion(id));
  });

  it('rejects a weak new password on self change (400 WEAK_PASSWORD)', async () => {
    const { id } = await createSara();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/password',
      headers: { authorization: `Bearer ${await tokenFor(id, ['EMPLOYEE'])}` },
      payload: { currentPassword: 'Password1!', newPassword: 'aaaaaa' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('WEAK_PASSWORD');
  });

  it('rejects a self password change when the current password is wrong (400)', async () => {
    const { id } = await createSara();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/password',
      headers: { authorization: `Bearer ${await tokenFor(id, ['EMPLOYEE'])}` },
      payload: { currentPassword: 'WRONG', newPassword: 'NextPass1!' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication to change own password (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/users/me/password', payload: { currentPassword: 'x', newPassword: 'NextPass1!' } });
    expect(res.statusCode).toBe(401);
  });
});
