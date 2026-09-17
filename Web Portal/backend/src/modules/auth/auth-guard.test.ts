import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createTokenService } from './token-service';
import { createAuthGuard } from './auth-guard';
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

async function makeApp(): Promise<{ app: FastifyInstance; tokenService: ReturnType<typeof makeTokenService> }> {
  const tokenService = makeTokenService();
  const guard = createAuthGuard(tokenService);
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
