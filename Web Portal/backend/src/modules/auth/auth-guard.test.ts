import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createTokenService } from './token-service';
import { createAuthGuard, type AuthGuardOptions, type UserState } from './auth-guard';
import { AuthError } from './errors';

function makeTokenService() {
  return createTokenService({
    accessSecret: 'guard-access-secret',
    refreshSecret: 'guard-refresh-secret',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
  });
}

async function makeApp(opts?: AuthGuardOptions): Promise<{ app: FastifyInstance; tokenService: ReturnType<typeof makeTokenService> }> {
  const tokenService = makeTokenService();
  const guard = createAuthGuard(tokenService, opts);
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    const status = err instanceof AuthError ? err.status : 500;
    const code = err instanceof AuthError ? err.code : 'INTERNAL';
    reply.status(status).send({ error: { code } });
  });
  app.get('/me', { preHandler: guard.authenticate }, async (req) => ({ data: req.user }));
  app.get('/admin', { preHandler: guard.requireRoles('ADMIN') }, async () => ({ data: 'ok' }));
  return { app, tokenService };
}

describe('auth guard', () => {
  it('rejects a request with no bearer token (401)', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    await app.close();
  });

  it('rejects a malformed/invalid token (401)', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer not-a-jwt' } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('accepts a valid token and exposes the user', async () => {
    const { app, tokenService } = await makeApp();
    const { accessToken } = await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'] });
    const res = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe('u1');
    expect(res.json().data.roles).toEqual(['EMPLOYEE']);
    await app.close();
  });

  it('forbids a non-admin from an admin-only route (403)', async () => {
    const { app, tokenService } = await makeApp();
    const { accessToken } = await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'] });
    const res = await app.inject({ method: 'GET', url: '/admin', headers: { authorization: `Bearer ${accessToken}` } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    await app.close();
  });

  it('allows an admin through an admin-only route (200)', async () => {
    const { app, tokenService } = await makeApp();
    const { accessToken } = await tokenService.issueTokens({ id: 'admin1', roles: ['ADMIN'] });
    const res = await app.inject({ method: 'GET', url: '/admin', headers: { authorization: `Bearer ${accessToken}` } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('auth guard with live user state (token version, status, current roles)', () => {
  function stateStore(initial: Record<string, UserState>) {
    const states = new Map(Object.entries(initial));
    let lookups = 0;
    let clock = 0;
    return {
      set: (id: string, s: UserState) => states.set(id, s),
      get lookups() { return lookups; },
      advance: (ms: number) => (clock += ms),
      opts: {
        userState: async (id: string) => { lookups++; return states.get(id) ?? null; },
        now: () => clock,
      } satisfies AuthGuardOptions,
    };
  }
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  it('rejects a token whose version was bumped (revoked sessions) once the cache expires', async () => {
    const s = stateStore({ u1: { tokenVersion: 0, active: true, roles: ['EMPLOYEE'] } });
    const { app, tokenService } = await makeApp(s.opts);
    const { accessToken } = await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'], tokenVersion: 0 });
    expect((await app.inject({ method: 'GET', url: '/me', headers: bearer(accessToken) })).statusCode).toBe(200);
    s.set('u1', { tokenVersion: 1, active: true, roles: ['EMPLOYEE'] });
    s.advance(10_001);
    const res = await app.inject({ method: 'GET', url: '/me', headers: bearer(accessToken) });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    await app.close();
  });

  it('rejects the tokens of a suspended or deleted user', async () => {
    const s = stateStore({ u1: { tokenVersion: 0, active: false, roles: ['EMPLOYEE'] } });
    const { app, tokenService } = await makeApp(s.opts);
    const suspended = await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'] });
    const deleted = await tokenService.issueTokens({ id: 'gone', roles: ['EMPLOYEE'] });
    expect((await app.inject({ method: 'GET', url: '/me', headers: bearer(suspended.accessToken) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/me', headers: bearer(deleted.accessToken) })).statusCode).toBe(401);
    await app.close();
  });

  it('uses the CURRENT roles, so a demoted admin loses admin routes at once', async () => {
    const s = stateStore({ u1: { tokenVersion: 0, active: true, roles: ['EMPLOYEE'] } });
    const { app, tokenService } = await makeApp(s.opts);
    const { accessToken } = await tokenService.issueTokens({ id: 'u1', roles: ['ADMIN'] }); // stale claim
    expect((await app.inject({ method: 'GET', url: '/admin', headers: bearer(accessToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/me', headers: bearer(accessToken) })).json().data.roles).toEqual(['EMPLOYEE']);
    await app.close();
  });

  it('caches lookups for ~10 seconds', async () => {
    const s = stateStore({ u1: { tokenVersion: 0, active: true, roles: ['EMPLOYEE'] } });
    const { app, tokenService } = await makeApp(s.opts);
    const { accessToken } = await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'] });
    for (let i = 0; i < 3; i++) await app.inject({ method: 'GET', url: '/me', headers: bearer(accessToken) });
    expect(s.lookups).toBe(1);
    s.advance(10_001);
    await app.inject({ method: 'GET', url: '/me', headers: bearer(accessToken) });
    expect(s.lookups).toBe(2);
    await app.close();
  });

  // 1.23.29 private file links: a link is signed with the person's session version, and the file route
  // reads the account through the guard's own short cache.
  it('puts the session version on the request (what file links are signed with)', async () => {
    const s = stateStore({ u1: { tokenVersion: 4, active: true, roles: ['EMPLOYEE'] } });
    const { app, tokenService } = await makeApp(s.opts);
    const { accessToken } = await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'], tokenVersion: 4 });
    const res = await app.inject({ method: 'GET', url: '/me', headers: bearer(accessToken) });
    expect(res.json().data).toMatchObject({ id: 'u1', ver: 4 });
    await app.close();
  });

  it('accountState reads the account through the same 10-second cache (fresh on request)', async () => {
    const s = stateStore({ u1: { tokenVersion: 2, active: true, roles: ['EMPLOYEE'] } });
    const guard = createAuthGuard(makeTokenService(), s.opts);
    expect(await guard.accountState('u1')).toMatchObject({ tokenVersion: 2, active: true });
    s.set('u1', { tokenVersion: 3, active: false, roles: ['EMPLOYEE'] });
    expect((await guard.accountState('u1'))?.tokenVersion).toBe(2); // cached
    expect(s.lookups).toBe(1);
    expect(await guard.accountState('u1', { fresh: true })).toMatchObject({ tokenVersion: 3, active: false });
    s.advance(10_001);
    expect((await guard.accountState('u1'))?.active).toBe(false);
    expect(await guard.accountState('nobody')).toBeNull();
  });

  // Review (1.23.29): a file link can name any person; made-up ones must not crowd real sessions out.
  it('accountState never remembers an unknown person (made-up ids in file links can’t fill the shared cache)', async () => {
    const s = stateStore({ u1: { tokenVersion: 0, active: true, roles: ['EMPLOYEE'] } });
    const guard = createAuthGuard(makeTokenService(), { ...s.opts, cacheMaxEntries: 3 });
    expect(await guard.accountState('u1')).not.toBeNull(); // u1 remembered
    for (let i = 0; i < 10; i++) expect(await guard.accountState(`made-up-${i}`)).toBeNull();
    const before = s.lookups;
    expect(await guard.accountState('u1')).not.toBeNull();
    expect(s.lookups).toBe(before); // still remembered: the made-up ids took no place
  });

  it('accountState: a burst of pictures for one account not yet remembered reads it once', async () => {
    const s = stateStore({ u1: { tokenVersion: 0, active: true, roles: ['EMPLOYEE'] } });
    const guard = createAuthGuard(makeTokenService(), s.opts);
    const all = await Promise.all(Array.from({ length: 5 }, () => guard.accountState('u1')));
    expect(all.every((x) => x?.active)).toBe(true);
    expect(s.lookups).toBe(1);
    await Promise.all(Array.from({ length: 5 }, () => guard.accountState('nobody')));
    expect(await guard.accountState('nobody')).toBeNull(); // still never remembered
    expect(s.lookups).toBe(3); // the burst shared one read; the later call read again
  });

  it('a full cache lets its oldest entry go, never everyone’s at once', async () => {
    const s = stateStore({ a: { tokenVersion: 0, active: true, roles: [] }, b: { tokenVersion: 0, active: true, roles: [] }, c: { tokenVersion: 0, active: true, roles: [] } });
    const guard = createAuthGuard(makeTokenService(), { ...s.opts, cacheMaxEntries: 2 });
    await guard.accountState('a');
    await guard.accountState('b');
    await guard.accountState('c'); // a goes
    const before = s.lookups;
    await guard.accountState('b');
    await guard.accountState('c');
    expect(s.lookups).toBe(before);
    await guard.accountState('a');
    expect(s.lookups).toBe(before + 1);
  });

  it('accountState is null without live account state (a link can never be checked, so it is refused)', async () => {
    const guard = createAuthGuard(makeTokenService());
    expect(await guard.accountState('u1')).toBeNull();
  });

  it('accepts a newer token straight away even while an older state is cached', async () => {
    const s = stateStore({ u1: { tokenVersion: 0, active: true, roles: ['EMPLOYEE'] } });
    const { app, tokenService } = await makeApp(s.opts);
    const old = await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'], tokenVersion: 0 });
    await app.inject({ method: 'GET', url: '/me', headers: bearer(old.accessToken) }); // caches version 0
    s.set('u1', { tokenVersion: 1, active: true, roles: ['EMPLOYEE'] }); // e.g. password changed
    const fresh = await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'], tokenVersion: 1 });
    expect((await app.inject({ method: 'GET', url: '/me', headers: bearer(fresh.accessToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/me', headers: bearer(old.accessToken) })).statusCode).toBe(401);
    await app.close();
  });
});

// 1.23 Client accounts: one deny-by-default check in the guard (modules/clients/client-route-table.ts).
describe('auth guard — client accounts', () => {
  async function clientApp(state?: Record<string, UserState>) {
    const tokenService = makeTokenService();
    const guard = createAuthGuard(tokenService, state ? { userState: async (id) => state[id] ?? null } : {});
    const app = Fastify();
    app.setErrorHandler((err, _req, reply) => {
      const status = err instanceof AuthError || (err as { status?: number }).status ? ((err as { status: number }).status ?? 500) : 500;
      reply.status(status).send({ error: { code: (err as { code?: string }).code ?? 'INTERNAL' } });
    });
    app.get('/projects', { preHandler: guard.authenticate }, async () => ({ data: 'staff' }));
    app.get('/portal/me', { preHandler: guard.authenticate }, async (req) => ({ data: req.user }));
    app.post('/users/me/password', { preHandler: guard.authenticate }, async () => ({ data: 'both' }));
    app.get('/users', { preHandler: guard.requireRoles('ADMIN') }, async () => ({ data: 'admin' }));
    app.get('/made-up/:id', { preHandler: guard.authenticate }, async () => ({ data: 'unknown' }));
    return { app, tokenService };
  }
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  it('refuses a client on a staff route (403 CLIENT_NOT_ALLOWED), with no data', async () => {
    const { app, tokenService } = await clientApp();
    const { accessToken } = await tokenService.issueTokens({ id: 'c1', roles: ['CLIENT'] });
    for (const url of ['/projects', '/users', '/made-up/x']) {
      const res = await app.inject({ method: 'GET', url, headers: bearer(accessToken) });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code, url).toBe('CLIENT_NOT_ALLOWED');
      expect(res.body).not.toContain('staff');
    }
    await app.close();
  });

  it('lets a client call the portal and the reviewed routes', async () => {
    const { app, tokenService } = await clientApp();
    const { accessToken } = await tokenService.issueTokens({ id: 'c1', roles: ['CLIENT'] });
    expect((await app.inject({ method: 'GET', url: '/portal/me', headers: bearer(accessToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/users/me/password', headers: bearer(accessToken) })).statusCode).toBe(200);
    await app.close();
  });

  it('refuses staff on a portal route (403 CLIENTS_ONLY)', async () => {
    const { app, tokenService } = await clientApp();
    for (const roles of [['ADMIN'], ['EMPLOYEE']]) {
      const { accessToken } = await tokenService.issueTokens({ id: 'u1', roles });
      const res = await app.inject({ method: 'GET', url: '/portal/me', headers: bearer(accessToken) });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('CLIENTS_ONLY');
      expect((await app.inject({ method: 'GET', url: '/projects', headers: bearer(accessToken) })).statusCode).toBe(200);
    }
    await app.close();
  });

  it('decides by the CURRENT roles, not the token’s (a token minted as staff for a client account is refused)', async () => {
    const { app, tokenService } = await clientApp({ c1: { tokenVersion: 0, active: true, roles: ['CLIENT'] } });
    const { accessToken } = await tokenService.issueTokens({ id: 'c1', roles: ['ADMIN'] });
    const res = await app.inject({ method: 'GET', url: '/projects', headers: bearer(accessToken) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CLIENT_NOT_ALLOWED');
    await app.close();
  });

  it('a client role mixed with a staff role still counts as a client (never widens)', async () => {
    const { app, tokenService } = await clientApp();
    const { accessToken } = await tokenService.issueTokens({ id: 'c1', roles: ['CLIENT', 'ADMIN'] });
    expect((await app.inject({ method: 'GET', url: '/users', headers: bearer(accessToken) })).statusCode).toBe(403);
    await app.close();
  });
});
