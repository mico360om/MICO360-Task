import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createAuditService } from './audit-service';
import { createMemoryAuditRepository } from './audit-repository';

const tokenService = createTokenService({
  accessSecret: 'aud-access',
  refreshSecret: 'aud-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

/** Entries at fixed instants; Muscat is UTC+4, so 21:00Z on the 25th is already the 26th locally. */
async function makeApp() {
  let at = new Date(0);
  const repo = createMemoryAuditRepository(() => at);
  const auditService = createAuditService({ audit: repo });
  const add = async (iso: string, module: string, userId: string, newValue?: unknown) => {
    at = new Date(iso);
    await auditService.record({ userId, ip: '10.0.0.9', module, action: `${module}.change`, entityId: 'e', newValue });
  };
  await add('2026-09-25T19:00:00Z', 'users', 'admin1'); // 25th 23:00 Muscat
  await add('2026-09-25T21:00:00Z', 'projects', 'admin2'); // 26th 01:00 Muscat
  await add('2026-09-26T10:00:00Z', 'users', 'admin1', { apiKey: 'sk-live-XYZ', name: 'OpenAI' }); // 26th 14:00
  await add('2026-09-26T20:30:00Z', 'settings', 'admin1'); // 27th 00:30 Muscat
  const app = await buildApp({ authService, tokenService, auditService });
  const admin = { authorization: `Bearer ${(await tokenService.issueTokens({ id: 'admin1', roles: ['ADMIN'] })).accessToken}` };
  return { app, admin };
}

type Row = { createdAt: string; module: string; userId: string; ip: string; newValue: unknown };

describe('GET /audit-logs', () => {
  it('returns newest first with actor, IP and change details', async () => {
    const { app, admin } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit-logs', headers: admin });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Row[];
    expect(rows.map((r) => r.module)).toEqual(['settings', 'users', 'projects', 'users']);
    expect(rows[1]).toMatchObject({ userId: 'admin1', ip: '10.0.0.9', newValue: { apiKey: '[redacted]', name: 'OpenAI' } });
    expect(res.body).not.toContain('sk-live-XYZ');
    await app.close();
  });

  it('pages with limit + before (exclusive cursor)', async () => {
    const { app, admin } = await makeApp();
    const first = (await app.inject({ method: 'GET', url: '/api/v1/audit-logs?limit=2', headers: admin })).json().data as Row[];
    expect(first).toHaveLength(2);
    const before = encodeURIComponent(first[1]!.createdAt);
    const next = (await app.inject({ method: 'GET', url: `/api/v1/audit-logs?limit=2&before=${before}`, headers: admin })).json().data as Row[];
    expect(next.map((r) => r.module)).toEqual(['projects', 'users']);
    await app.close();
  });

  it('filters by module and user', async () => {
    const { app, admin } = await makeApp();
    const byModule = (await app.inject({ method: 'GET', url: '/api/v1/audit-logs?module=users', headers: admin })).json().data as Row[];
    expect(byModule).toHaveLength(2);
    const byUser = (await app.inject({ method: 'GET', url: '/api/v1/audit-logs?userId=admin2', headers: admin })).json().data as Row[];
    expect(byUser.map((r) => r.module)).toEqual(['projects']);
    await app.close();
  });

  it('treats from/to as inclusive company-local days (Asia/Muscat)', async () => {
    const { app, admin } = await makeApp();
    const day = (await app.inject({ method: 'GET', url: '/api/v1/audit-logs?from=2026-09-26&to=2026-09-26', headers: admin })).json().data as Row[];
    expect(day.map((r) => r.createdAt)).toEqual(['2026-09-26T10:00:00.000Z', '2026-09-25T21:00:00.000Z']);
    const fromOnly = (await app.inject({ method: 'GET', url: '/api/v1/audit-logs?from=2026-09-27', headers: admin })).json().data as Row[];
    expect(fromOnly.map((r) => r.module)).toEqual(['settings']);
    await app.close();
  });

  it('rejects bad parameters with 400', async () => {
    const { app, admin } = await makeApp();
    for (const qs of ['limit=0', 'limit=500', 'limit=abc', 'before=yesterday', 'from=2026-02-30', 'from=26-09-2026', 'from=2026-09-27&to=2026-09-26', 'module=']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/audit-logs?${qs}`, headers: admin });
      expect(res.statusCode, qs).toBe(400);
    }
    await app.close();
  });

  it('is admin-only', async () => {
    const { app } = await makeApp();
    const employee = { authorization: `Bearer ${(await tokenService.issueTokens({ id: 'e1', roles: ['EMPLOYEE'] })).accessToken}` };
    expect((await app.inject({ method: 'GET', url: '/api/v1/audit-logs', headers: employee })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/audit-logs' })).statusCode).toBe(401);
    await app.close();
  });
});
