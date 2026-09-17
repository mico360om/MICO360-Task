import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createUserService } from './user-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { CreateUserData, UserRepository, UserSummary } from './user-repository';

function inMemory(): UserRepository {
  const rows = new Map<string, UserSummary>();
  const hashes: Record<string, string> = {};
  let seq = 0;
  return {
    async create(data: CreateUserData) {
      const u: UserSummary = {
        id: `u${seq++}`,
        email: data.email,
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
        avatarUrl: null,
        status: 'ACTIVE',
        departmentId: data.departmentId ?? null,
        roles: data.roleNames,
      };
      rows.set(u.id, u);
      hashes[u.id] = data.passwordHash;
      return u;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async findByEmailOrUsername(email, username) {
      return [...rows.values()].find((u) => u.email === email || u.username === username) ?? null;
    },
    async list() { return [...rows.values()]; },
    async update(id, patch) {
      const { roleNames, ...rest } = patch;
      const u = { ...rows.get(id)!, ...rest, ...(roleNames ? { roles: roleNames } : {}) };
      rows.set(id, u);
      return u;
    },
    async setStatus(id, status) { const u = { ...rows.get(id)!, status }; rows.set(id, u); return u; },
    async setAvatar(id, avatarUrl) { const u = { ...rows.get(id)!, avatarUrl }; rows.set(id, u); return u; },
    async setPassword(id, passwordHash) { hashes[id] = passwordHash; },
    async getPasswordHash(id) { return hashes[id] ?? null; },
    async softDelete(id) { rows.delete(id); },
  };
}

const tokenService = createTokenService({
  accessSecret: 'usr-access',
  refreshSecret: 'usr-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

async function makeApp() {
  const userService = createUserService({ users: inMemory() });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, userService });
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
});

describe('User profile & role editing', () => {
  async function createSara() {
    const headers = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers, payload: newUser });
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

  it('rejects an admin reset with too-short a password (400)', async () => {
    const headers = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const { id } = await createSara();
    const res = await app.inject({ method: 'POST', url: `/api/v1/users/${id}/password`, headers, payload: { password: '123' } });
    expect(res.statusCode).toBe(400);
  });

  it('lets a user change their own password with the correct current one (204)', async () => {
    const { id } = await createSara();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/password',
      headers: { authorization: `Bearer ${await tokenFor(id, ['EMPLOYEE'])}` },
      payload: { currentPassword: 'Password1!', newPassword: 'NextPass1!' },
    });
    expect(res.statusCode).toBe(204);
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
