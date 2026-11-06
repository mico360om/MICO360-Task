import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createAuditService } from '../audit/audit-service';
import type { AuditRepository } from '../audit/audit-repository';
import { createMemoryDashboardLayoutStore } from './dashboard-layout-store';
import { BUILT_IN_DEFAULTS } from './dashboard-layout';
import type { PrioritiesAnswer } from './priorities-service';
import type { ApprovalSource } from '../tasks/task-approval-routes';

// 1.23.4 — the Smarter Dashboard's routes: "My Priorities Today", each person's widget arrangement, and the
// administrators' two defaults (staff only; administrators only for the defaults; every default audited).
const tokenService = createTokenService({
  accessSecret: 'dash-access',
  refreshSecret: 'dash-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

const ANSWER: PrioritiesAnswer = { today: '2026-11-06', timeZone: 'Asia/Muscat', manager: false, items: [], total: 0, counts: { all: 0, overdue: 0, today: 0, approvals: 0, blocked: 0, upcoming: 0, team: 0 }, watch: [] };

async function setup(opts: { approvers?: string[] } = {}) {
  const get = vi.fn(async () => ANSWER);
  const layouts = createMemoryDashboardLayoutStore();
  const audits: unknown[] = [];
  const repo = { async create(d: unknown) { audits.push(d); return { id: 'a', createdAt: new Date(), ...(d as object) }; } } as unknown as AuditRepository;
  const approvalSource: ApprovalSource = { async list() { return []; }, async canApproveAny(v) { return (opts.approvers ?? []).includes(v.id); } };
  const app = await buildApp({ authService, tokenService, dashboardPriorities: { get }, dashboardLayouts: layouts, approvalSource, auditService: createAuditService({ audit: repo }) });
  const as = async (id: string, roles: string[] = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });
  return { app, as, get, layouts, audits };
}
const ids = (l: { widgets: { id: string }[] }) => l.widgets.map((w) => w.id);

describe('GET /dashboard/priorities', () => {
  it('answers the signed-in person’s list (asked fresh after their own action)', async () => {
    const { app, as, get } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/dashboard/priorities', headers: await as('u1') });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(ANSWER);
    expect(get).toHaveBeenLastCalledWith({ id: 'u1', roles: ['EMPLOYEE'] }, null, { fresh: false });
    await app.inject({ method: 'GET', url: '/api/v1/dashboard/priorities?fresh=1', headers: await as('u1') });
    expect(get).toHaveBeenLastCalledWith({ id: 'u1', roles: ['EMPLOYEE'] }, null, { fresh: true });
  });

  it('needs a signed-in staff member: no session 401, a client account 403', async () => {
    const { app, as } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/v1/dashboard/priorities' })).statusCode).toBe(401);
    const client = await app.inject({ method: 'GET', url: '/api/v1/dashboard/priorities', headers: await as('c1', ['CLIENT']) });
    expect(client.statusCode).toBe(403);
    expect(client.json().error.code).toBe('CLIENT_NOT_ALLOWED');
  });
});

describe('GET/PUT /users/me/dashboard-layout — each person’s own arrangement', () => {
  it('starts at their group’s default, only with the widgets they may see', async () => {
    const { app, as } = await setup({ approvers: ['boss'] });
    const emp = (await app.inject({ method: 'GET', url: '/api/v1/users/me/dashboard-layout', headers: await as('e1') })).json().data;
    expect(emp).toMatchObject({ customized: false, group: 'everyone' });
    expect(ids(emp.layout)).toEqual(['priorities', 'stats', 'open-tasks', 'due-soon', 'activity']);
    expect(emp.widgets).toEqual(['priorities', 'stats', 'open-tasks', 'due-soon', 'activity']);
    const boss = (await app.inject({ method: 'GET', url: '/api/v1/users/me/dashboard-layout', headers: await as('boss') })).json().data;
    expect(ids(boss.layout)).toEqual(['priorities', 'stats', 'open-tasks', 'approvals', 'due-soon', 'activity']);
    const admin = (await app.inject({ method: 'GET', url: '/api/v1/users/me/dashboard-layout', headers: await as('a1', ['ADMIN']) })).json().data;
    expect(admin.group).toBe('admins');
    expect(admin.layout).toEqual(BUILT_IN_DEFAULTS.admins);
  });

  it('saves it to the account, reads it back on any computer, and Reset to default (null) returns to the default', async () => {
    const { app, as } = await setup();
    const mine = { widgets: [{ id: 'activity', hidden: false, size: 'wide' }, { id: 'priorities', hidden: false, size: 'small' }, { id: 'stats', hidden: true, size: 'wide' }, { id: 'open-tasks', hidden: false, size: 'small' }, { id: 'due-soon', hidden: false, size: 'small' }] };
    const put = await app.inject({ method: 'PUT', url: '/api/v1/users/me/dashboard-layout', headers: await as('e1'), payload: { layout: mine } });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toMatchObject({ customized: true, layout: mine });
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/dashboard-layout', headers: await as('e1') })).json().data.layout).toEqual(mine);
    // Another person still has the default.
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/dashboard-layout', headers: await as('e2') })).json().data.customized).toBe(false);
    const reset = await app.inject({ method: 'PUT', url: '/api/v1/users/me/dashboard-layout', headers: await as('e1'), payload: { layout: null } });
    expect(reset.json().data).toMatchObject({ customized: false });
    expect(ids(reset.json().data.layout)).toEqual(['priorities', 'stats', 'open-tasks', 'due-soon', 'activity']);
  });

  it('refuses a widget the person may not see, an unknown one, a repeat, or a bad size', async () => {
    const { app, as } = await setup();
    const h = await as('e1');
    for (const layout of [
      { widgets: [{ id: 'status-chart', hidden: false, size: 'small' }] },
      { widgets: [{ id: 'approvals', hidden: false, size: 'small' }] },
      { widgets: [{ id: 'weather', hidden: false, size: 'small' }] },
      { widgets: [{ id: 'stats', hidden: false, size: 'wide' }, { id: 'stats', hidden: false, size: 'wide' }] },
      { widgets: [{ id: 'stats', hidden: false, size: 'giant' }] },
    ]) {
      const res = await app.inject({ method: 'PUT', url: '/api/v1/users/me/dashboard-layout', headers: h, payload: { layout } });
      expect(res.statusCode, JSON.stringify(layout)).toBe(400);
    }
    expect((await app.inject({ method: 'PUT', url: '/api/v1/users/me/dashboard-layout', headers: h, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/dashboard-layout', headers: h })).json().data.customized).toBe(false);
  });

  it('a widget added later (or newly allowed) comes in at the default’s place in a saved arrangement', async () => {
    const { app, as, layouts } = await setup({ approvers: ['m1'] });
    // Saved before they ran a project: no Approvals.
    await layouts.setOwn('m1', { widgets: [{ id: 'activity', hidden: false, size: 'small' }, { id: 'priorities', hidden: false, size: 'wide' }, { id: 'stats', hidden: false, size: 'wide' }, { id: 'open-tasks', hidden: false, size: 'small' }, { id: 'due-soon', hidden: true, size: 'small' }] });
    const data = (await app.inject({ method: 'GET', url: '/api/v1/users/me/dashboard-layout', headers: await as('m1') })).json().data;
    expect(ids(data.layout)).toEqual(['activity', 'priorities', 'stats', 'open-tasks', 'approvals', 'due-soon']);
    expect(data.layout.widgets[5]).toEqual({ id: 'due-soon', hidden: true, size: 'small' });
  });

  it('a client account is refused', async () => {
    const { app, as } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/dashboard-layout', headers: await as('c1', ['CLIENT']) })).statusCode).toBe(403);
  });
});

describe('GET/PUT /settings/dashboard-default — the administrators’ two defaults', () => {
  const adminLayout = { widgets: [{ id: 'status-chart', hidden: false, size: 'wide' }, { id: 'priorities', hidden: false, size: 'wide' }, { id: 'stats', hidden: false, size: 'wide' }, { id: 'completion', hidden: true, size: 'small' }, { id: 'approvals', hidden: false, size: 'small' }, { id: 'due-soon', hidden: false, size: 'small' }, { id: 'activity', hidden: false, size: 'small' }, { id: 'open-tasks', hidden: true, size: 'small' }] };
  const everyoneLayout = { widgets: [{ id: 'priorities', hidden: false, size: 'wide' }, { id: 'due-soon', hidden: false, size: 'wide' }, { id: 'stats', hidden: false, size: 'wide' }, { id: 'open-tasks', hidden: false, size: 'small' }, { id: 'approvals', hidden: false, size: 'small' }, { id: 'activity', hidden: true, size: 'small' }] };

  it('administrators only (an employee 403, nobody 401)', async () => {
    const { app, as } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/v1/settings/dashboard-default', headers: await as('e1') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/settings/dashboard-default', headers: await as('e1'), payload: { group: 'everyone', layout: everyoneLayout } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/settings/dashboard-default' })).statusCode).toBe(401);
  });

  it('people who never customized follow their group’s default; the ones who did keep theirs; every save is audited', async () => {
    const { app, as, audits } = await setup({ approvers: ['m1'] });
    const admin = await as('a1', ['ADMIN']);
    // e2 customized before the default changed.
    const own = { widgets: [{ id: 'activity', hidden: false, size: 'small' }, { id: 'priorities', hidden: false, size: 'wide' }, { id: 'stats', hidden: false, size: 'wide' }, { id: 'open-tasks', hidden: false, size: 'small' }, { id: 'due-soon', hidden: false, size: 'small' }] };
    await app.inject({ method: 'PUT', url: '/api/v1/users/me/dashboard-layout', headers: await as('e2'), payload: { layout: own } });

    const a = await app.inject({ method: 'PUT', url: '/api/v1/settings/dashboard-default', headers: admin, payload: { group: 'admins', layout: adminLayout } });
    expect(a.statusCode).toBe(200);
    const e = await app.inject({ method: 'PUT', url: '/api/v1/settings/dashboard-default', headers: admin, payload: { group: 'everyone', layout: everyoneLayout } });
    expect(e.json().data.everyone).toEqual(everyoneLayout);
    expect(e.json().data.admins).toEqual(adminLayout);

    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/dashboard-layout', headers: await as('a2', ['ADMIN']) })).json().data.layout).toEqual(adminLayout);
    // The "everyone else" default as each one may see it: no Approvals for someone who can't approve.
    expect(ids((await app.inject({ method: 'GET', url: '/api/v1/users/me/dashboard-layout', headers: await as('e1') })).json().data.layout)).toEqual(['priorities', 'due-soon', 'stats', 'open-tasks', 'activity']);
    expect(ids((await app.inject({ method: 'GET', url: '/api/v1/users/me/dashboard-layout', headers: await as('m1') })).json().data.layout)).toEqual(['priorities', 'due-soon', 'stats', 'open-tasks', 'approvals', 'activity']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/dashboard-layout', headers: await as('e2') })).json().data.layout).toEqual(own);
    // Reset to default goes to the new default.
    const reset = await app.inject({ method: 'PUT', url: '/api/v1/users/me/dashboard-layout', headers: await as('e2'), payload: { layout: null } });
    expect(ids(reset.json().data.layout)).toEqual(['priorities', 'due-soon', 'stats', 'open-tasks', 'activity']);

    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ userId: 'a1', module: 'settings', action: 'dashboard.default.update', entityId: 'admins', oldValue: BUILT_IN_DEFAULTS.admins, newValue: adminLayout });
    expect(audits[1]).toMatchObject({ entityId: 'everyone', newValue: everyoneLayout });
  });

  it('“everyone else” can’t hold the administrators’ charts; back to the built-in default with null', async () => {
    const { app, as, audits } = await setup();
    const admin = await as('a1', ['ADMIN']);
    const bad = await app.inject({ method: 'PUT', url: '/api/v1/settings/dashboard-default', headers: admin, payload: { group: 'everyone', layout: { widgets: [{ id: 'completion', hidden: false, size: 'small' }] } } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/settings/dashboard-default', headers: admin, payload: { group: 'staff', layout: null } })).statusCode).toBe(400);
    await app.inject({ method: 'PUT', url: '/api/v1/settings/dashboard-default', headers: admin, payload: { group: 'everyone', layout: everyoneLayout } });
    const back = await app.inject({ method: 'PUT', url: '/api/v1/settings/dashboard-default', headers: admin, payload: { group: 'everyone', layout: null } });
    expect(back.json().data.everyone).toEqual(BUILT_IN_DEFAULTS.everyone);
    expect(audits).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: '/api/v1/settings/dashboard-default', headers: admin })).json().data).toEqual({ admins: BUILT_IN_DEFAULTS.admins, everyone: BUILT_IN_DEFAULTS.everyone, groups: ['admins', 'everyone'] });
  });
});
