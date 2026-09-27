import { describe, it, expect } from 'vitest';
import { buildApp } from './app';
import { createLogger } from './lib/logger';
import { createReportService } from './modules/reports/report-service';
import { createTokenService } from './modules/auth/token-service';
import { createAuthService } from './modules/auth/auth-service';

const tokenService = createTokenService({ accessSecret: 'app-a', refreshSecret: 'app-r', accessTtl: 900, refreshTtl: 1000, refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} } });
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

describe('health + metrics', () => {
  it('reports health with uptime and a timestamp', async () => {
    const app = await buildApp({ authService, tokenService });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.status).toBe('ok');
    expect(typeof d.uptimeSeconds).toBe('number');
    expect(Number.isNaN(Date.parse(d.timestamp))).toBe(false);
  });

  it('exposes process metrics to admins only', async () => {
    const app = await buildApp({ authService, tokenService });
    expect((await app.inject({ method: 'GET', url: '/api/v1/metrics' })).statusCode).toBe(401);
    const member = (await tokenService.issueTokens({ id: 'm1', roles: ['EMPLOYEE'] })).accessToken;
    expect((await app.inject({ method: 'GET', url: '/api/v1/metrics', headers: { authorization: `Bearer ${member}` } })).statusCode).toBe(403);
    const admin = (await tokenService.issueTokens({ id: 'a1', roles: ['ADMIN'] })).accessToken;
    const res = await app.inject({ method: 'GET', url: '/api/v1/metrics', headers: { authorization: `Bearer ${admin}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(typeof d.rssMb).toBe('number');
    expect(typeof d.uptimeSeconds).toBe('number');
    expect(d.nodeVersion).toBe(process.version);
  });
});

describe('public asset CORP headers', () => {
  it('relaxes Cross-Origin-Resource-Policy to cross-origin for /uploads/* so the SPA can embed them from another origin', async () => {
    const app = await buildApp({ authService, tokenService });
    const res = await app.inject({ method: 'GET', url: '/uploads/some-image.png' });
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('relaxes Cross-Origin-Resource-Policy to cross-origin for /email-assets/*', async () => {
    const app = await buildApp({ authService, tokenService });
    const res = await app.inject({ method: 'GET', url: '/email-assets/logo.png' });
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('keeps API responses locked to same-origin CORP', async () => {
    const app = await buildApp({ authService, tokenService });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  });
});

describe('structured error logging', () => {
  it('logs a JSON error entry on a 500 (not raw stack)', async () => {
    const lines: string[] = [];
    const logger = createLogger({ service: 'test', sink: (l) => lines.push(l) });
    // A report data source that throws forces a 500 from /reports/status.
    const reportService = createReportService({
      data: { async getTasks() { throw new Error('db down'); }, async getUsers() { return []; } },
    });
    const app = await buildApp({ authService, tokenService, reportService, logger });
    const token = (await tokenService.issueTokens({ id: 'admin', roles: ['ADMIN'] })).accessToken;

    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/status', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.message).toBe('Something went wrong.'); // no stack leaked to client

    const entry = JSON.parse(lines.at(-1)!);
    expect(entry.level).toBe('error');
    expect(entry.url).toBe('/api/v1/reports/status');
    expect(entry.status).toBe(500);
    expect(entry.err.message).toBe('db down');
  });

  it('forwards 500s to the error reporter (Sentry seam)', async () => {
    const captured: { err: unknown; ctx?: Record<string, unknown> }[] = [];
    const errorReporter = { captureException: (err: unknown, ctx?: Record<string, unknown>) => captured.push({ err, ctx }) };
    const reportService = createReportService({ data: { async getTasks() { throw new Error('nope'); }, async getUsers() { return []; } } });
    const app = await buildApp({ authService, tokenService, reportService, errorReporter });
    const token = (await tokenService.issueTokens({ id: 'admin', roles: ['ADMIN'] })).accessToken;
    await app.inject({ method: 'GET', url: '/api/v1/reports/status', headers: { authorization: `Bearer ${token}` } });
    expect(captured).toHaveLength(1);
    expect((captured[0]!.err as Error).message).toBe('nope');
    expect(captured[0]!.ctx?.url).toBe('/api/v1/reports/status');
  });
});

describe('rate limiting behind a proxy', () => {
  it('keys anonymous requests by the real client IP (X-Forwarded-For) when the proxy is trusted', async () => {
    const app = await buildApp({ authService, tokenService, trustProxy: 'loopback', rateLimitMax: 3 });
    const hit = (ip: string) => app.inject({ method: 'GET', url: '/api/v1/config', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': ip } });
    for (let i = 0; i < 3; i++) expect((await hit('203.0.113.1')).statusCode).toBe(200);
    const limited = await hit('203.0.113.1');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    // A different client behind the same proxy has its own budget.
    expect((await hit('203.0.113.2')).statusCode).toBe(200);
  });

  it('keys signed-in requests by user, so colleagues behind one office IP do not share a budget', async () => {
    const app = await buildApp({ authService, tokenService, trustProxy: 'loopback', rateLimitMax: 2 });
    const a = (await tokenService.issueTokens({ id: 'user-a', roles: [] })).accessToken;
    const b = (await tokenService.issueTokens({ id: 'user-b', roles: [] })).accessToken;
    const hit = (token: string) =>
      app.inject({ method: 'GET', url: '/api/v1/config', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.7', authorization: `Bearer ${token}` } });
    expect((await hit(a)).statusCode).toBe(200);
    expect((await hit(a)).statusCode).toBe(200);
    expect((await hit(a)).statusCode).toBe(429);
    expect((await hit(b)).statusCode).toBe(200);
  });

  it('never rate limits uploads, web-app files or the health check', async () => {
    const app = await buildApp({ authService, tokenService, rateLimitMax: 1 });
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/uploads/x.png' })).statusCode).not.toBe(429);
      expect((await app.inject({ method: 'GET', url: '/assets/index-abc.js' })).statusCode).not.toBe(429);
    }
    // The API itself is still limited.
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).statusCode).toBe(429);
  });

  it('applies a stricter per-IP limit to sign-in endpoints', async () => {
    const app = await buildApp({ authService, tokenService, trustProxy: 'loopback', authRateLimitMax: 2 });
    const login = () =>
      app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '192.0.2.9' }, payload: { identifier: 'x', password: 'y' } });
    expect((await login()).statusCode).toBe(401);
    expect((await login()).statusCode).toBe(401);
    expect((await login()).statusCode).toBe(429);
  });
});

describe('database error mapping', () => {
  it('turns Prisma input and race errors into clear 4xx responses instead of 500', async () => {
    const app = await buildApp({ authService, tokenService });
    const prismaError = (code: string) => Object.assign(new Error(`prisma ${code}`), { name: 'PrismaClientKnownRequestError', code });
    app.get('/t/:code', async (req) => {
      throw prismaError((req.params as { code: string }).code);
    });
    app.get('/t-validation', async () => {
      throw Object.assign(new Error('bad arg'), { name: 'PrismaClientValidationError' });
    });
    const status = async (url: string) => (await app.inject({ method: 'GET', url })).statusCode;
    expect(await status('/t/P2002')).toBe(409);
    expect(await status('/t/P2025')).toBe(404);
    expect(await status('/t/P2003')).toBe(409);
    expect(await status('/t/P2000')).toBe(400);
    expect(await status('/t-validation')).toBe(400);
    expect(await status('/t/P9999')).toBe(500);
  });
});
