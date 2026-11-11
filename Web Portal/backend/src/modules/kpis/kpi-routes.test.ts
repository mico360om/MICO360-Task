import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { done, setup } from './kpi-service.fixture';
import { parsePeriod } from './kpi-routes';

// Project KPIs and User KPIs over HTTP: who may read and change what; a client account is refused by the
// route table; files come as attachments.
const tokenService = createTokenService({
  accessSecret: 'kpi-access',
  refreshSecret: 'kpi-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

// Who may see p1: its team (ann, bob, mgr) and administrators; p2: ann, other.
const SEES: Record<string, string[]> = { ann: ['p1', 'p2'], bob: ['p1'], mgr: ['p1'], other: ['p2'] };

async function app() {
  const s = setup({ tasks: [done('2026-11-03', '2026-11-04'), done('2026-11-04', '2026-11-02', { projectId: 'p2' })] });
  const a = await buildApp({
    authService,
    tokenService,
    kpis: { service: s.service, userName: async () => 'Omar Said' },
    projectAccess: {
      canViewProject: async (u: string, roles: string[], p: string) => roles.includes('ADMIN') || (SEES[u] ?? []).includes(p),
      canViewTask: async () => true,
      canViewColumn: async () => true,
      accessibleProjectIds: async () => [],
    } as never,
  });
  const as = async (id: string, roles: string[] = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });
  return { a, as, s };
}

describe('GET /kpis/projects/:id', () => {
  it('anyone who may see the project reads its KPIs; anyone else gets a 404, never data', async () => {
    const { a, as } = await app();
    const ok = await a.inject({ method: 'GET', url: '/api/v1/kpis/projects/p1?period=month', headers: await as('bob') });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.tiles.map((t: { metric: string }) => t.metric)).toContain('onTime');
    expect(ok.json().data.can.manage).toBe(false);
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/projects/p1', headers: await as('other') })).statusCode).toBe(404);
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/projects/p1', headers: await as('mgr') })).json().data.can.manage).toBe(true);
  });

  it('a client account is refused by the route table (403), signed-out callers 401', async () => {
    const { a, as } = await app();
    const client = await a.inject({ method: 'GET', url: '/api/v1/kpis/projects/p1', headers: await as('cl', ['CLIENT']) });
    expect(client.statusCode).toBe(403);
    expect(client.json().error?.code ?? client.json().code).toBe('CLIENT_NOT_ALLOWED');
    for (const url of ['/api/v1/kpis/people/me', '/api/v1/kpis/people/ann', '/api/v1/kpis/management']) expect((await a.inject({ method: 'GET', url, headers: await as('cl', ['CLIENT']) })).statusCode).toBe(403);
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/projects/p1' })).statusCode).toBe(401);
  });

  it('a bad period is a 400 with plain words', async () => {
    const { a, as } = await app();
    const bad = await a.inject({ method: 'GET', url: '/api/v1/kpis/projects/p1?period=year', headers: await as('bob') });
    expect(bad.statusCode).toBe(400);
    const back = await a.inject({ method: 'GET', url: '/api/v1/kpis/projects/p1?period=custom&from=2026-10-30&to=2026-10-01', headers: await as('bob') });
    expect(back.statusCode).toBe(400);
  });

  it('the list behind a number', async () => {
    const { a, as } = await app();
    const r = await a.inject({ method: 'GET', url: '/api/v1/kpis/projects/p1/items?metric=onTime', headers: await as('bob') });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.total).toBe(1);
  });

  it('PDF and Excel, as attachments named after the project and the day', async () => {
    const { a, as } = await app();
    const pdf = await a.inject({ method: 'GET', url: '/api/v1/kpis/projects/p1/export.pdf', headers: await as('bob') });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toBe('attachment; filename="project-kpis-p1-2026-11-11.pdf"');
    const xlsx = await a.inject({ method: 'GET', url: '/api/v1/kpis/projects/p1/export.xlsx', headers: await as('bob') });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-disposition']).toContain('.xlsx');
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/projects/p1/export.pdf', headers: await as('other') })).statusCode).toBe(404);
  });
});

describe('changing a project’s targets and its own KPIs', () => {
  it('whoever runs it may; a team member is refused', async () => {
    const { a, as } = await app();
    const put = await a.inject({ method: 'PUT', url: '/api/v1/kpis/projects/p1/targets', headers: await as('mgr'), payload: { targets: [{ metric: 'onTime', target: 90 }] } });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.metrics.find((m: { metric: string }) => m.metric === 'onTime')).toMatchObject({ target: 90, source: 'project' });
    expect((await a.inject({ method: 'PUT', url: '/api/v1/kpis/projects/p1/targets', headers: await as('bob'), payload: { targets: [] } })).statusCode).toBe(403);
    const add = await a.inject({ method: 'POST', url: '/api/v1/kpis/projects/p1/custom', headers: await as('mgr'), payload: { name: 'Budget used', unit: '%', direction: 'LOWER', target: 80 } });
    expect(add.statusCode).toBe(201);
    const id = add.json().data[0].id;
    expect((await a.inject({ method: 'PUT', url: `/api/v1/kpis/projects/p1/custom/${id}/values/2026-10`, headers: await as('mgr'), payload: { value: 65 } })).statusCode).toBe(200);
    expect((await a.inject({ method: 'PUT', url: `/api/v1/kpis/projects/p1/custom/${id}/values/2026-10`, headers: await as('bob'), payload: { value: 1 } })).statusCode).toBe(403);
    expect((await a.inject({ method: 'PUT', url: `/api/v1/kpis/projects/p1/custom/${id}/values/october`, headers: await as('mgr'), payload: { value: 1 } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'DELETE', url: `/api/v1/kpis/projects/p1/custom/${id}`, headers: await as('mgr') })).statusCode).toBe(200);
  });
});

describe('a person’s KPIs (owner 2)', () => {
  it('themselves, a manager of their project, an administrator; a colleague is refused', async () => {
    const { a, as } = await app();
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/people/me', headers: await as('ann') })).json().data.scope).toBe('self');
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/people/ann', headers: await as('mgr') })).json().data).toMatchObject({ scope: 'manager', projects: [{ id: 'p1' }] });
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/people/ann', headers: await as('boss', ['ADMIN']) })).json().data.scope).toBe('admin');
    const colleague = await a.inject({ method: 'GET', url: '/api/v1/kpis/people/ann', headers: await as('bob') });
    expect(colleague.statusCode).toBe(403);
    expect(JSON.stringify(colleague.json())).not.toContain('tiles');
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/people/ann/items?metric=completed', headers: await as('bob') })).statusCode).toBe(403);
  });
});

describe('the Management KPI table and the company targets', () => {
  it('administrators and whoever runs a project; the table’s Excel and PDF', async () => {
    const { a, as } = await app();
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/management', headers: await as('boss', ['ADMIN']) })).json().data.rows).toHaveLength(2);
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/management', headers: await as('mgr') })).json().data.rows).toHaveLength(1);
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/management', headers: await as('bob') })).statusCode).toBe(403);
    const x = await a.inject({ method: 'GET', url: '/api/v1/kpis/management.xlsx', headers: await as('boss', ['ADMIN']) });
    expect(x.headers['content-disposition']).toBe('attachment; filename="management-kpis-2026-11-11.xlsx"');
    const pdf = await a.inject({ method: 'GET', url: '/api/v1/kpis/management.pdf', headers: await as('boss', ['ADMIN']) });
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('company targets: administrators only', async () => {
    const { a, as } = await app();
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/targets', headers: await as('mgr') })).statusCode).toBe(403);
    const get = await a.inject({ method: 'GET', url: '/api/v1/kpis/targets', headers: await as('boss', ['ADMIN']) });
    expect(get.json().data).toMatchObject({ companyId: 'c1', companies: [{ id: 'c1' }] });
    const put = await a.inject({ method: 'PUT', url: '/api/v1/kpis/targets', headers: await as('boss', ['ADMIN']), payload: { companyId: 'c1', targets: [{ metric: 'daysLate', target: 3 }] } });
    expect(put.json().data.metrics.find((m: { metric: string }) => m.metric === 'daysLate')).toMatchObject({ target: 3, source: 'company' });
  });
});

describe('parsePeriod', () => {
  it('this month by default; the four kinds', () => {
    expect(parsePeriod({})).toEqual({ kind: 'month' });
    expect(parsePeriod({ period: 'week' })).toEqual({ kind: 'week' });
    expect(parsePeriod({ period: 'custom', from: '2026-09-01', to: '2026-09-30' })).toEqual({ kind: 'custom', from: '2026-09-01', to: '2026-09-30' });
    expect(() => parsePeriod({ period: 'decade' })).toThrow();
  });
});
