import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createLogger } from '../../lib/logger';
import { withErrorLog } from '../../lib/error-log-logger';
import { createReportService } from '../reports/report-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createErrorLogService } from './error-log-service';
import { createMemoryErrorLogRepository } from './error-log-repository';
import { createMapStore } from './stack';

const tokenService = createTokenService({ accessSecret: 'ela-a', refreshSecret: 'ela-r', accessTtl: 900, refreshTtl: 1000, refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} } });
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

function world(collecting = true) {
  const repo = createMemoryErrorLogRepository();
  const lines: Record<string, unknown>[] = [];
  const base = createLogger({ service: 'test', sink: (l) => lines.push(JSON.parse(l) as Record<string, unknown>) });
  const errorLog = createErrorLogService({
    repo,
    maps: createMapStore({ webRoot: null }),
    timeZone: 'Asia/Muscat',
    serverVersion: () => '1.22.4',
    collecting: async () => collecting,
    warn: (m) => base.warn(m),
  });
  const logger = withErrorLog(base, (msg, ctx) => errorLog.recordServer(msg, ctx));
  return { repo, lines, errorLog, logger };
}

describe('the Error log in the app (1.22.4)', () => {
  it('a failed request (500) is in the Error log as Server, by its route pattern — the address and its query never are', async () => {
    const { repo, lines, errorLog, logger } = world();
    const reportService = createReportService({ data: { async getTasks() { throw new Error('db down'); }, async getUsers() { return []; } } });
    const app = await buildApp({ authService, tokenService, reportService, logger, errorLog });
    const token = (await tokenService.issueTokens({ id: 'admin1', roles: ['ADMIN'] })).accessToken;
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/status?secret=abc', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(500);
    await errorLog.settled();
    // The log line is as before (with the route and person added).
    expect(lines.at(-1)).toMatchObject({ level: 'error', msg: 'request failed', url: '/api/v1/reports/status?secret=abc', route: '/api/v1/reports/status', status: 500, userId: 'admin1' });
    expect(repo.groups).toHaveLength(1);
    expect(repo.groups[0]).toMatchObject({ kind: 'SERVER', title: 'db down', lastVersion: '1.22.4' });
    expect(repo.eventRows[0]).toMatchObject({ page: 'GET /api/v1/reports/status', userId: 'admin1', detail: 'request' });
    expect(JSON.stringify(repo.eventRows)).not.toContain('secret');
  });

  it('/config tells the page whether to send, and the endpoints are on the API', async () => {
    for (const collecting of [true, false]) {
      const { errorLog } = world(collecting);
      const app = await buildApp({ authService, tokenService, errorLog });
      expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).json().data.collectBrowserErrors).toBe(collecting);
      const r = await app.inject({ method: 'POST', url: '/api/v1/client-errors', headers: { 'content-type': 'text/plain' }, payload: JSON.stringify({ reports: [] }) });
      expect(r.statusCode).toBe(204);
    }
    // Without an Error log (a test server), the page is told not to send.
    const app = await buildApp({ authService, tokenService });
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).json().data.collectBrowserErrors).toBe(false);
  });

  it('the report endpoints are never rate limited into an error the page would see', async () => {
    const { errorLog } = world();
    const app = await buildApp({ authService, tokenService, errorLog, rateLimitMax: 2 });
    for (let i = 0; i < 6; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/v1/client-errors', headers: { 'content-type': 'text/plain' }, payload: '{"reports":[]}' });
      expect(r.statusCode).toBe(204);
    }
    const csp = await app.inject({ method: 'POST', url: '/api/v1/client-errors/csp', headers: { 'content-type': 'application/csp-report' }, payload: '{}' });
    expect(csp.statusCode).toBe(204);
  });
});

describe('1.23 integration: a client account’s browser and the Error log', () => {
  const report = { kind: 'ERROR', detail: 'error', message: 'TypeError: boom', page: '/portal/projects/:id', version: '1.23.0' };

  it('a client’s session can report what goes wrong on their portal pages, and it says it was them', async () => {
    const { repo, errorLog } = world();
    const app = await buildApp({ authService, tokenService, errorLog });
    const token = (await tokenService.issueTokens({ id: 'client1', roles: ['CLIENT'] })).accessToken;
    const r = await app.inject({ method: 'POST', url: '/api/v1/client-errors', headers: { 'content-type': 'text/plain', authorization: `Bearer ${token}` }, payload: JSON.stringify({ reports: [report] }) });
    expect(r.statusCode).toBe(204);
    const csp = await app.inject({ method: 'POST', url: '/api/v1/client-errors/csp', headers: { 'content-type': 'application/csp-report', authorization: `Bearer ${token}` }, payload: '{}' });
    expect(csp.statusCode).toBe(204);
    await errorLog.settled();
    expect(repo.eventRows.at(-1)).toMatchObject({ userId: 'client1' });
  });

  it('…and still can’t read the Error log (System Settings is staff, administrators only)', async () => {
    const { errorLog } = world();
    const app = await buildApp({ authService, tokenService, errorLog });
    const token = (await tokenService.issueTokens({ id: 'client1', roles: ['CLIENT'] })).accessToken;
    for (const [method, url] of [['GET', '/api/v1/error-log'], ['GET', '/api/v1/error-log/g1'], ['POST', '/api/v1/error-log/g1/fixed'], ['DELETE', '/api/v1/error-log/g1/fixed'], ['POST', '/api/v1/error-log/visit']] as const) {
      const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().error.code, `${method} ${url}`).toBe('CLIENT_NOT_ALLOWED');
    }
  });
});

