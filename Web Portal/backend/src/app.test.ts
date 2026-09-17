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

  it('exposes liveness metrics', async () => {
    const app = await buildApp({ authService, tokenService });
    const res = await app.inject({ method: 'GET', url: '/api/v1/metrics' });
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
