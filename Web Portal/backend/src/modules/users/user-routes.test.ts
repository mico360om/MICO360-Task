import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../app';
import { createUserService } from './user-service';
import { createMemoryUserRepository } from './memory-user-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { AuditService } from '../audit/audit-service';
import type { CompanyAccess } from '../companies/company-access';
import { createCompanyMembership } from '../companies/company-membership';
import type { OnCompanyAccessChanged } from '../companies/company-service';

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

describe('People directory', () => {
  it('lists everyone (names stay readable in history) and says who is active, so pickers can leave the rest out', async () => {
    const admin = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const sara = (await app.inject({ method: 'POST', url: '/api/v1/users', headers: admin, payload: newUser })).json().data;
    const omar = (await app.inject({ method: 'POST', url: '/api/v1/users', headers: admin, payload: { ...newUser, email: 'omar@x.co', username: 'omar', firstName: 'Omar' } })).json().data;
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/users/${omar.id}/status`, headers: admin, payload: { status: 'INACTIVE' } })).statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/directory', headers: { authorization: `Bearer ${await tokenFor(sara.id, ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(200);
    const byName = Object.fromEntries(res.json().data.map((u: { username: string; active: boolean }) => [u.username, u.active]));
    expect(byName).toEqual({ sara: true, omar: false });
    // Still nothing sensitive: no email, phone, roles or status word.
    expect(Object.keys(res.json().data[0]).sort()).toEqual(['active', 'avatarUrl', 'colleague', 'firstName', 'id', 'lastActiveAt', 'lastName', 'username']);
    // One company (no companies module wired): everyone is a colleague, as before.
    expect(res.json().data.every((u: { colleague: boolean }) => u.colleague)).toBe(true);
  });
});

describe('People directory with companies', () => {
  async function appWith(known: (id: Record<string, string>) => Map<string, { colleague: boolean }> | 'everyone') {
    const users = createMemoryUserRepository();
    const userService = createUserService({ users: users.repo });
    const made = await Promise.all(
      ['ana', 'amy', 'ben', 'bob', 'adm'].map((n) =>
        userService.createUser({ email: `${n}@x.co`, username: n, password: 'Password1!', firstName: n, lastName: 'X', ...(n === 'adm' ? { roleNames: ['ADMIN'] } : {}) }),
      ),
    );
    const id = Object.fromEntries(made.map((u) => [u.username, u.id]));
    const companyAccess = { knownPeople: async () => known(id) } as unknown as NonNullable<Parameters<typeof buildApp>[0]['companyAccess']>;
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    return { app: await buildApp({ authService, tokenService, userService, companyAccess }), id };
  }
  const directoryOf = async (a: Awaited<ReturnType<typeof appWith>>['app'], userId: string, roles: string[]) =>
    Object.fromEntries(
      (await a.inject({ method: 'GET', url: '/api/v1/users/directory', headers: { authorization: `Bearer ${await tokenFor(userId, roles)}` } }))
        .json()
        .data.map((u: { username: string; colleague: boolean }) => [u.username, u.colleague]),
    );

  it('shows the people you know — colleagues marked, teammates and chat partners not — and administrators; never strangers', async () => {
    const { app: a, id } = await appWith((id) => new Map([[id.amy!, { colleague: true }], [id.ben!, { colleague: false }]]));
    expect(await directoryOf(a, id.ana!, ['EMPLOYEE'])).toEqual({ ana: true, amy: true, ben: false, adm: true });
  });

  it('administrators see everyone, all colleagues', async () => {
    const { app: a, id } = await appWith(() => 'everyone');
    expect(await directoryOf(a, id.adm!, ['ADMIN'])).toEqual({ ana: true, amy: true, ben: true, bob: true, adm: true });
  });
});

describe('Last sign-in in User Management', () => {
  it('the admin list says when each person last signed in (null: never) and when a welcome email went', async () => {
    const admin = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const sara = (await app.inject({ method: 'POST', url: '/api/v1/users', headers: admin, payload: newUser })).json().data;
    await app.inject({ method: 'POST', url: '/api/v1/users', headers: admin, payload: { ...newUser, email: 'omar@x.co', username: 'omar' } });
    mem.signedIn(sara.id, new Date('2026-10-24T05:12:00.000Z'));
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: admin });
    expect(res.statusCode).toBe(200);
    const byName = Object.fromEntries(res.json().data.map((u: { username: string; lastLoginAt: string | null; welcomeSentAt: string | null }) => [u.username, [u.lastLoginAt, u.welcomeSentAt]]));
    expect(byName).toEqual({ sara: ['2026-10-24T05:12:00.000Z', null], omar: [null, null] });
  });

  it('only administrators see it: the people directory leaves it out', async () => {
    const admin = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const sara = (await app.inject({ method: 'POST', url: '/api/v1/users', headers: admin, payload: newUser })).json().data;
    mem.signedIn(sara.id, new Date());
    const employee = { authorization: `Bearer ${await tokenFor(sara.id, ['EMPLOYEE'])}` };
    expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: employee })).statusCode).toBe(403);
    const dir = await app.inject({ method: 'GET', url: '/api/v1/users/directory', headers: employee });
    expect(dir.json().data[0]).not.toHaveProperty('lastLoginAt');
    expect(dir.json().data[0]).not.toHaveProperty('welcomeSentAt');
  });
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

describe('Download my data (GET /users/me/export)', () => {
  function exportApp(exported: { calls: string[] }) {
    const auditService = {
      async record(d: { action: string; entityId?: string | null }) {
        audited.push({ action: d.action, entityId: d.entityId ?? null });
        return {} as never;
      },
      async list() { return []; },
    } as unknown as AuditService;
    audited = [];
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    const userService = createUserService({ users: createMemoryUserRepository().repo, issueSession: (user) => tokenService.issueTokens(user) });
    return buildApp({
      authService,
      tokenService,
      userService,
      auditService,
      dataExporter: async (userId) => {
        exported.calls.push(userId);
        if (userId === 'gone') return null;
        return {
          exportedAt: '2026-09-28T22:30:00.000Z', // already 29 September in Muscat
          profile: { id: userId, firstName: 'سارة' },
          projects: [], tasksAssignedToMe: [], tasksICreated: [], comments: [], attachments: [],
          chatMessages: [], meetingNotes: [], actionItems: [], activity: [], accountEvents: [], micoAiChats: [],
        };
      },
    });
  }

  it('sends the signed-in person their own data as a JSON download and records it', async () => {
    const exported = { calls: [] as string[] };
    const app = await exportApp(exported);
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/me/export', headers: { authorization: `Bearer ${await tokenFor('u7', ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="mico360-my-data-2026-09-29.json"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json().profile).toEqual({ id: 'u7', firstName: 'سارة' });
    expect(exported.calls).toEqual(['u7']);
    expect(audited).toContainEqual({ action: 'user.data_exported', entityId: 'u7' });
  });

  it('needs a signed-in user', async () => {
    const app = await exportApp({ calls: [] });
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/export' })).statusCode).toBe(401);
  });

  it('answers 404 for an account that no longer exists', async () => {
    const app = await exportApp({ calls: [] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/me/export', headers: { authorization: `Bearer ${await tokenFor('gone', ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(404);
  });
});

describe('People’s companies (User Management)', () => {
  /** A site with these companies (active unless said), people in them, and the membership rules wired. */
  async function companiesApp(companies: { id: string; name: string; status?: 'ACTIVE' | 'ARCHIVED' }[]) {
    const m = createMemoryUserRepository();
    for (const c of companies) m.addCompany({ id: c.id, name: c.name, code: c.id.toUpperCase(), status: c.status });
    const onAccess = vi.fn<OnCompanyAccessChanged>();
    const records: { module: string; action: string; entityId: string | null; newValue?: unknown }[] = [];
    const auditService = {
      async record(d: { module: string; action: string; entityId?: string | null; newValue?: unknown }) {
        records.push({ module: d.module, action: d.action, entityId: d.entityId ?? null, newValue: d.newValue });
        return {} as never;
      },
      async list() {
        return [];
      },
    } as unknown as AuditService;
    const userService = createUserService({ users: m.repo });
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    // The picked company is checked by the access module; here every pick is usable.
    const companyAccess = { checkPick: async (_v: unknown, pick: string | null) => pick } as unknown as CompanyAccess;
    const companyMembership = createCompanyMembership({ store: m.membershipStore, onAccessChanged: onAccess, audit: auditService });
    const built = await buildApp({ authService, tokenService, userService, auditService, companyAccess, companyMembership });
    const person = async (firstName: string, lastName: string, companyIds: string[], roleNames = ['EMPLOYEE']) =>
      (await m.repo.create({ email: `${firstName}@x.co`, username: firstName.toLowerCase(), passwordHash: 'x', firstName, lastName, roleNames, companyIds, primaryCompanyId: companyIds[0] ?? null })).id;
    return { app: built, mem: m, onAccess, records, person };
  }
  const adminHeaders = async (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${await token(['ADMIN'])}`, ...extra });
  const newEmployee = { email: 'nia@x.co', username: 'nia', password: 'Password1!', firstName: 'Nia', lastName: 'New' };
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
  const TWO = [{ id: 'A', name: 'Alpha Co' }, { id: 'B', name: 'Beta Co' }];

  it('a new employee needs a company when the site has several; the picked company is the default', async () => {
    const { app: a } = await companiesApp(TWO);
    const refused = await a.inject({ method: 'POST', url: '/api/v1/users', headers: await adminHeaders(), payload: newEmployee });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toBe('Choose at least one company.');
    expect((await a.inject({ method: 'GET', url: '/api/v1/users', headers: await adminHeaders() })).json().data).toEqual([]); // no account was made
    const made = (await a.inject({ method: 'POST', url: '/api/v1/users', headers: await adminHeaders({ 'x-company-id': 'B' }), payload: newEmployee })).json().data;
    expect(made.companies.map((c: { id: string }) => c.id)).toEqual(['B']);
    expect(made.primaryCompanyId).toBe('B');
  });

  it('with one active company a new person goes into it', async () => {
    const { app: a } = await companiesApp([{ id: 'prolens', name: 'Prolens Projects LLC' }, { id: 'old', name: 'Old Co', status: 'ARCHIVED' }]);
    const made = (await a.inject({ method: 'POST', url: '/api/v1/users', headers: await adminHeaders(), payload: newEmployee })).json().data;
    expect(made).toMatchObject({ companies: [{ id: 'prolens', name: 'Prolens Projects LLC', code: 'PROLENS' }], primaryCompanyId: 'prolens' });
  });

  it('companies and a primary company on create; the primary must be one of them', async () => {
    const { app: a } = await companiesApp(TWO);
    const made = (await a.inject({ method: 'POST', url: '/api/v1/users', headers: await adminHeaders(), payload: { ...newEmployee, companyIds: ['A', 'B'], primaryCompanyId: 'B' } })).json().data;
    expect(made).toMatchObject({ companies: [{ id: 'A' }, { id: 'B' }], primaryCompanyId: 'B' });
    const wrong = await a.inject({ method: 'POST', url: '/api/v1/users', headers: await adminHeaders(), payload: { ...newEmployee, email: 'z@x.co', username: 'z', companyIds: ['A'], primaryCompanyId: 'B' } });
    expect(wrong.json().error.message).toBe('The primary company must be one of this person’s companies.');
    const admin = (await a.inject({ method: 'POST', url: '/api/v1/users', headers: await adminHeaders(), payload: { ...newEmployee, email: 'ad@x.co', username: 'ad', roleNames: ['ADMIN'] } })).json().data;
    expect(admin).toMatchObject({ companies: [], primaryCompanyId: null }); // administrators may have none
  });

  it('the primary company must be one of theirs; a change takes effect at once', async () => {
    const { app: a, person, onAccess, records } = await companiesApp(TWO);
    const ana = await person('Ana', 'Alpha', ['A']);
    expect((await a.inject({ method: 'PUT', url: `/api/v1/users/${ana}`, headers: await adminHeaders(), payload: { primaryCompanyId: 'B' } })).json().error.message).toBe('The primary company must be one of this person’s companies.');
    const both = (await a.inject({ method: 'PUT', url: `/api/v1/users/${ana}`, headers: await adminHeaders(), payload: { companyIds: ['A', 'B'], primaryCompanyId: 'B' } })).json().data;
    expect(both).toMatchObject({ companies: [{ id: 'A' }, { id: 'B' }], primaryCompanyId: 'B' });
    expect(onAccess).toHaveBeenLastCalledWith([ana]);
    expect(records.at(-1)).toMatchObject({ module: 'users', action: 'user.update', entityId: ana });
    expect(records.some((r) => r.action === 'user.companies' && r.entityId === ana)).toBe(true);
  });

  it('an employee keeps at least one company, and a refused change saves nothing', async () => {
    const { app: a, person, mem: m } = await companiesApp(TWO);
    const ana = await person('Ana', 'Alpha', ['A']);
    const refused = await a.inject({ method: 'PUT', url: `/api/v1/users/${ana}`, headers: await adminHeaders(), payload: { firstName: 'Anna', companyIds: [] } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toEqual({ code: 'LAST_COMPANY', message: 'Ana Alpha must keep at least one company. Add another company first.' });
    expect((await m.repo.findById(ana))!.firstName).toBe('Ana');
  });

  it('filters people by company, or those with none', async () => {
    const { app: a, person } = await companiesApp(TWO);
    const [ana, amy, cat, ben] = [await person('Ana', 'A', ['A']), await person('Amy', 'A', ['A']), await person('Cat', 'AB', ['A', 'B']), await person('Ben', 'B', ['B'])];
    const adminId = await person('Root', 'Admin', [], ['ADMIN']);
    expect(ids((await a.inject({ method: 'GET', url: '/api/v1/users?companyId=A', headers: await adminHeaders() })).json().data)).toEqual([ana, amy, cat].sort());
    expect(ids((await a.inject({ method: 'GET', url: '/api/v1/users?companyId=B', headers: await adminHeaders() })).json().data)).toEqual([cat, ben].sort());
    expect(ids((await a.inject({ method: 'GET', url: '/api/v1/users?companyId=none', headers: await adminHeaders() })).json().data)).toEqual([adminId]);
    expect((await a.inject({ method: 'GET', url: '/api/v1/users', headers: await adminHeaders() })).json().data).toHaveLength(5);
  });

  it('bulk: adds and removes, and says who it couldn’t change', async () => {
    const { app: a, person, records } = await companiesApp(TWO);
    const ana = await person('Ana', 'Alpha', ['A']);
    const bob = await person('Bob', 'Betaonly', ['B']);
    const r = (await a.inject({ method: 'POST', url: '/api/v1/users/companies', headers: await adminHeaders(), payload: { userIds: [ana, bob], removeCompanyIds: ['A'] } })).json().data;
    expect(r).toEqual({ changed: 0, refused: [{ userId: ana, name: 'Ana Alpha', reason: 'Ana Alpha must keep at least one company. Add another company first.' }] }); // bob isn't in A: nothing to change
    const added = (await a.inject({ method: 'POST', url: '/api/v1/users/companies', headers: await adminHeaders(), payload: { userIds: [ana, bob], addCompanyIds: ['A', 'B'] } })).json().data;
    expect(added).toEqual({ changed: 2, refused: [] });
    expect(records.at(-1)).toMatchObject({ module: 'users', action: 'user.companies.bulk', newValue: { userIds: [ana, bob], addCompanyIds: ['A', 'B'], removeCompanyIds: [] } });
    expect((await a.inject({ method: 'POST', url: '/api/v1/users/companies', headers: await adminHeaders(), payload: { userIds: Array(201).fill(ana) } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'POST', url: '/api/v1/users/companies', headers: await adminHeaders(), payload: { userIds: [ana] } })).statusCode).toBe(400); // nothing to add or remove
    const employee = { authorization: `Bearer ${await tokenFor(ana, ['EMPLOYEE'])}` };
    expect((await a.inject({ method: 'POST', url: '/api/v1/users/companies', headers: employee, payload: { userIds: [ana], addCompanyIds: ['B'] } })).statusCode).toBe(403);
  });
});

// 1.23 Client accounts: made with the client form (POST /clients); never mixed with staff roles.
describe('User Management and client accounts', () => {
  const admin = async () => ({ authorization: `Bearer ${await token(['ADMIN'])}` });
  const makeClient = async () => (await mem.repo.create({ email: 'cliff@client.co', username: 'cliff', passwordHash: 'x', firstName: 'Cliff', lastName: 'Client', roleNames: ['CLIENT'] })).id;

  it('POST /users refuses the Client role: client accounts are made with the client form', async () => {
    for (const roleNames of [['CLIENT'], ['CLIENT', 'EMPLOYEE']]) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: await admin(), payload: { ...newUser, roleNames } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('USE_CLIENT_FORM');
    }
  });

  it('PUT /users/:id can’t turn staff into a client or a client into staff (409 ROLE_CHANGE_NOT_OFFERED)', async () => {
    const sara = (await app.inject({ method: 'POST', url: '/api/v1/users', headers: await admin(), payload: newUser })).json().data;
    const toClient = await app.inject({ method: 'PUT', url: `/api/v1/users/${sara.id}`, headers: await admin(), payload: { roleNames: ['CLIENT'] } });
    expect(toClient.statusCode).toBe(409);
    expect(toClient.json().error.code).toBe('ROLE_CHANGE_NOT_OFFERED');
    const cliff = await makeClient();
    for (const roleNames of [['ADMIN'], ['EMPLOYEE'], ['CLIENT', 'ADMIN']]) {
      const res = await app.inject({ method: 'PUT', url: `/api/v1/users/${cliff}`, headers: await admin(), payload: { roleNames } });
      expect(res.statusCode, roleNames.join()).toBeGreaterThanOrEqual(400);
      expect((await mem.repo.findById(cliff))!.roles).toEqual(['CLIENT']);
    }
    // Their name and email can still be changed here.
    const renamed = await app.inject({ method: 'PUT', url: `/api/v1/users/${cliff}`, headers: await admin(), payload: { firstName: 'Clifford', roleNames: ['CLIENT'] } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().data.firstName).toBe('Clifford');
  });

  it('the list shows client accounts with their Client role (the page badges them)', async () => {
    const cliff = await makeClient();
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: await admin() });
    expect(res.json().data.find((u: { id: string }) => u.id === cliff)).toMatchObject({ roles: ['CLIENT'] });
  });

  it('the people directory never lists a client account, not even for an administrator', async () => {
    const cliff = await makeClient();
    await app.inject({ method: 'POST', url: '/api/v1/users', headers: await admin(), payload: newUser });
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/directory', headers: await admin() });
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(cliff);
    expect(res.json().data.map((u: { username: string }) => u.username)).toContain('sara');
  });

  it('a client account’s session is refused on every User Management route', async () => {
    const cliff = await makeClient();
    const headers = { authorization: `Bearer ${await tokenFor(cliff, ['CLIENT'])}` };
    for (const [method, url] of [['GET', '/api/v1/users'], ['GET', '/api/v1/users/directory'], ['GET', `/api/v1/users/${cliff}`], ['POST', '/api/v1/users/me/avatar']] as const) {
      const res = await app.inject({ method, url, headers });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code, url).toBe('CLIENT_NOT_ALLOWED');
    }
  });
});
