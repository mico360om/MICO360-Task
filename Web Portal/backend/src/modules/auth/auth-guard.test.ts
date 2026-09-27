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
