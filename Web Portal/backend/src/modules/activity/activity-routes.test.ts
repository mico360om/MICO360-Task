import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createActivityService } from './activity-service';
import type { ActivityRecord, ActivityRepository } from './activity-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

// Recent activity spans two projects; u1 belongs to p1 only.
const rows: ActivityRecord[] = [
  { id: 'a1', taskId: 't1', projectId: 'p1', userId: 'u1', action: 'CREATED', meta: null, createdAt: new Date() },
  { id: 'a2', taskId: 't2', projectId: 'p2', userId: 'u2', action: 'MOVED', meta: null, createdAt: new Date() },
];
const scopes: (string[] | null | undefined)[] = [];
const activities: ActivityRepository = {
  async create(data) { return { id: 'x', taskId: data.taskId ?? null, projectId: data.projectId ?? null, userId: data.userId, action: data.action, meta: data.meta ?? null, createdAt: new Date() }; },
  async listForTask(taskId) { return rows.filter((r) => r.taskId === taskId); },
  async listRecent(limit, projectIds) {
    scopes.push(projectIds);
    return rows.filter((r) => !projectIds || projectIds.includes(r.projectId ?? '')).slice(0, limit ?? 50);
  },
  async timesBetween() { return []; },
  async listBetween() { return []; },
};

const tokenService = createTokenService({
  accessSecret: 'act-access',
  refreshSecret: 'act-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

const membership: Record<string, string[]> = { p1: ['u1'] };
const projectAccess = {
  async canViewProject(userId: string, roles: string[], projectId: string) {
    return roles.includes('ADMIN') || (membership[projectId] ?? []).includes(userId);
  },
  async canViewTask() { return true; },
  async canViewColumn() { return true; },
  async accessibleProjectIds(userId: string, roles: string[]) {
    if (roles.includes('ADMIN')) return null;
    return Object.entries(membership).filter(([, u]) => u.includes(userId)).map(([p]) => p);
  },
};

async function makeApp() {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, activityService: createActivityService({ activities }), projectAccess });
}
const tokenFor = async (id: string, roles: string[]) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

describe('Activity routes — object-level scope', () => {
  it('scopes the global feed to the employee’s projects', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/activity', headers: await tokenFor('u1', ['EMPLOYEE']) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((r: { id: string }) => r.id)).toEqual(['a1']);
  });

  it('scopes the feed in the query (before the 50-row limit), not after it', async () => {
    const app = await makeApp();
    scopes.length = 0;
    await app.inject({ method: 'GET', url: '/api/v1/activity', headers: await tokenFor('u1', ['EMPLOYEE']) });
    await app.inject({ method: 'GET', url: '/api/v1/activity', headers: await tokenFor('admin', ['ADMIN']) });
    expect(scopes).toEqual([['p1'], null]);
  });

  it('returns an empty feed to a user with no projects without querying', async () => {
    const app = await makeApp();
    scopes.length = 0;
    const res = await app.inject({ method: 'GET', url: '/api/v1/activity', headers: await tokenFor('loner', ['EMPLOYEE']) });
    expect(res.json().data).toEqual([]);
    expect(scopes).toEqual([]);
  });

  it('shows an admin the whole feed', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/activity', headers: await tokenFor('admin', ['ADMIN']) });
    expect(res.json().data).toHaveLength(2);
  });

  it('rejects unauthenticated access (401)', async () => {
    const app = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/activity' })).statusCode).toBe(401);
  });
});

describe('Activity routes — a blocker is named only to someone who can open it', () => {
  // t1 (in p1) got two blockers: OPS-2, which u1 can open, and FIN-12, in a project u1 isn't on.
  const blockerRows: ActivityRecord[] = [
    { id: 'b1', taskId: 't1', projectId: 'p1', userId: 'u2', action: 'BLOCKER_ADDED', meta: { dependsOnTaskId: 'open-task', key: 'OPS-2', title: 'Order the parts' }, createdAt: new Date() },
    { id: 'b2', taskId: 't1', projectId: 'p1', userId: 'u2', action: 'BLOCKER_ADDED', meta: { dependsOnTaskId: 'hidden-task', key: 'FIN-12', title: 'Q4 payroll cuts' }, createdAt: new Date() },
    { id: 'b3', taskId: 't1', projectId: 'p1', userId: 'u2', action: 'BLOCKER_REMOVED', meta: { dependsOnTaskId: 'hidden-task', key: 'FIN-12', title: 'Q4 payroll cuts' }, createdAt: new Date() },
  ];
  const blockerApp = () =>
    buildApp({
      authService: createAuthService({
        users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
        maxAttempts: 5,
      }),
      tokenService,
      activityService: createActivityService({
        activities: { ...activities, async listForTask(taskId) { return blockerRows.filter((r) => r.taskId === taskId); }, async listRecent() { return blockerRows; } },
      }),
      projectAccess: { ...projectAccess, async canViewTask(userId: string, roles: string[], taskId: string) { return roles.includes('ADMIN') || taskId !== 'hidden-task'; } },
    });
  const names = (data: Array<{ id: string; meta: Record<string, unknown> | null }>) => data.map((r) => [r.id, r.meta?.key ?? null, r.meta?.title ?? null]);

  it('on a task’s timeline', async () => {
    const res = await (await blockerApp()).inject({ method: 'GET', url: '/api/v1/tasks/t1/activity', headers: await tokenFor('u1', ['EMPLOYEE']) });
    expect(res.statusCode).toBe(200);
    expect(names(res.json().data)).toEqual([['b1', 'OPS-2', 'Order the parts'], ['b2', null, null], ['b3', null, null]]);
    expect(JSON.stringify(res.json().data)).not.toContain('hidden-task');
  });

  it('in the activity feed', async () => {
    const res = await (await blockerApp()).inject({ method: 'GET', url: '/api/v1/activity', headers: await tokenFor('u1', ['EMPLOYEE']) });
    expect(names(res.json().data)).toEqual([['b1', 'OPS-2', 'Order the parts'], ['b2', null, null], ['b3', null, null]]);
  });

  it('an admin, who can open every task, sees every name', async () => {
    const res = await (await blockerApp()).inject({ method: 'GET', url: '/api/v1/tasks/t1/activity', headers: await tokenFor('admin', ['ADMIN']) });
    expect(names(res.json().data)).toEqual([['b1', 'OPS-2', 'Order the parts'], ['b2', 'FIN-12', 'Q4 payroll cuts'], ['b3', 'FIN-12', 'Q4 payroll cuts']]);
  });
});

describe('Activity routes — Duplicate Task: the other task’s number only for someone who can open it', () => {
  // t1 was duplicated as OPS-9 (u1 can open it) and as FIN-40 (a project u1 isn't on); t2 is a copy of FIN-3 (hidden).
  const rows: ActivityRecord[] = [
    { id: 'd1', taskId: 't1', projectId: 'p1', userId: 'u2', action: 'DUPLICATED', meta: { copyTaskId: 'open-task', copyKey: 'OPS-9' }, createdAt: new Date() },
    { id: 'd2', taskId: 't1', projectId: 'p1', userId: 'u2', action: 'DUPLICATED', meta: { copyTaskId: 'hidden-task', copyKey: 'FIN-40' }, createdAt: new Date() },
    { id: 'd3', taskId: 't2', projectId: 'p1', userId: 'u2', action: 'DUPLICATED_FROM', meta: { fromTaskId: 'hidden-task', fromKey: 'FIN-3' }, createdAt: new Date() },
    { id: 'd4', taskId: 't2', projectId: 'p1', userId: 'u2', action: 'DUPLICATED_FROM', meta: { fromTaskId: 'open-task', fromKey: 'OPS-1' }, createdAt: new Date() },
  ];
  const dupApp = () =>
    buildApp({
      authService: createAuthService({
        users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
        maxAttempts: 5,
      }),
      tokenService,
      activityService: createActivityService({
        activities: { ...activities, async listForTask(taskId) { return rows.filter((r) => r.taskId === taskId); }, async listRecent() { return rows; } },
      }),
      projectAccess: { ...projectAccess, async canViewTask(userId: string, roles: string[], taskId: string) { return roles.includes('ADMIN') || taskId !== 'hidden-task'; } },
    });
  const keys = (data: Array<{ id: string; meta: Record<string, unknown> | null }>) => data.map((r) => [r.id, r.meta?.copyKey ?? r.meta?.fromKey ?? null]);

  it('on the original’s and the copy’s timelines', async () => {
    const app = await dupApp();
    const t1 = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/activity', headers: await tokenFor('u1', ['EMPLOYEE']) });
    expect(keys(t1.json().data)).toEqual([['d1', 'OPS-9'], ['d2', null]]);
    const t2 = await app.inject({ method: 'GET', url: '/api/v1/tasks/t2/activity', headers: await tokenFor('u1', ['EMPLOYEE']) });
    expect(keys(t2.json().data)).toEqual([['d3', null], ['d4', 'OPS-1']]);
    expect(t1.body + t2.body).not.toMatch(/hidden-task|FIN-40|FIN-3/);
  });

  it('in the activity feed; an admin sees every number', async () => {
    const app = await dupApp();
    const feed = await app.inject({ method: 'GET', url: '/api/v1/activity', headers: await tokenFor('u1', ['EMPLOYEE']) });
    expect(keys(feed.json().data)).toEqual([['d1', 'OPS-9'], ['d2', null], ['d3', null], ['d4', 'OPS-1']]);
    const admin = await app.inject({ method: 'GET', url: '/api/v1/activity', headers: await tokenFor('admin', ['ADMIN']) });
    expect(keys(admin.json().data)).toEqual([['d1', 'OPS-9'], ['d2', 'FIN-40'], ['d3', 'FIN-3'], ['d4', 'OPS-1']]);
  });
});

describe('Activity routes — the calendar: changes per day, and one day’s changes (1.22)', () => {
  // Site time zone Asia/Muscat (UTC+4). u1 is on p1 only.
  const at = (iso: string) => new Date(iso);
  const cal: ActivityRecord[] = [
    { id: 'c1', taskId: 't1', projectId: 'p1', userId: 'u1', action: 'CREATED', meta: null, createdAt: at('2026-10-31T19:00:00Z') }, // 31 Oct 23:00
    { id: 'c2', taskId: 't1', projectId: 'p1', userId: 'u1', action: 'COMPLETED', meta: null, createdAt: at('2026-10-31T21:30:00Z') }, // 1 Nov 01:30
    { id: 'c3', taskId: 't1', projectId: 'p1', userId: 'u1', action: 'REOPENED', meta: null, createdAt: at('2026-11-01T08:00:00Z') }, // 1 Nov
    { id: 'c4', taskId: 't2', projectId: 'p2', userId: 'u2', action: 'MOVED', meta: null, createdAt: at('2026-11-01T09:00:00Z') }, // 1 Nov, p2
    { id: 'c5', taskId: 't1', projectId: 'p1', userId: 'u1', action: 'BLOCKER_ADDED', meta: { dependsOnTaskId: 'hidden-task', key: 'FIN-12', title: 'Q4 payroll cuts' }, createdAt: at('2026-11-01T10:00:00Z') },
  ];
  type Asked = { from: string; to: string; projectIds: string[] | null; actions: string[] | null; before?: string | null; limit?: number };
  const asked: Asked[] = [];
  const inScope = (r: ActivityRecord, from: Date, to: Date, s: { projectIds: string[] | null; actions?: string[] | null }) =>
    r.createdAt >= from && r.createdAt < to && (!s.projectIds || s.projectIds.includes(r.projectId ?? '')) && (!s.actions || s.actions.includes(r.action));
  const newestFirst = (a: ActivityRecord, b: ActivityRecord) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);
  let calendarRows = cal;
  const calendarRepo: ActivityRepository = {
    ...activities,
    async timesBetween(from, to, scope) {
      asked.push({ from: from.toISOString(), to: to.toISOString(), projectIds: scope.projectIds, actions: scope.actions ?? null });
      return calendarRows.filter((r) => inScope(r, from, to, scope)).map((r) => r.createdAt);
    },
    async listBetween(from, to, scope, page) {
      asked.push({ from: from.toISOString(), to: to.toISOString(), projectIds: scope.projectIds, actions: scope.actions ?? null, before: page.before ?? null, limit: page.limit });
      const sorted = calendarRows.filter((r) => inScope(r, from, to, scope)).sort(newestFirst);
      const start = page.before ? sorted.findIndex((r) => r.id === page.before) + 1 : 0;
      return sorted.slice(start, start + page.limit);
    },
  };
  const calendarApp = () =>
    buildApp({
      authService: createAuthService({
        users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
        maxAttempts: 5,
      }),
      tokenService,
      activityService: createActivityService({ activities: calendarRepo }),
      projectAccess: { ...projectAccess, async canViewTask(_u: string, roles: string[], taskId: string) { return roles.includes('ADMIN') || taskId !== 'hidden-task'; } },
      appConfig: { timeZone: 'Asia/Muscat', productName: 'MICO360 Tasks', companyName: 'MICO360' } as never,
    });
  const get = async (url: string, who: [string, string[]] = ['u1', ['EMPLOYEE']]) =>
    (await calendarApp()).inject({ method: 'GET', url: `/api/v1${url}`, headers: await tokenFor(...who) });

  it('counts each day’s changes in the site’s time zone, only in the person’s projects', async () => {
    asked.length = 0;
    const res = await get('/activity?from=2026-10-31&to=2026-11-02');
    expect(res.statusCode).toBe(200);
    // 21:30 UTC on 31 Oct is 1 Nov in Muscat; p2's move is not u1's to see.
    expect(res.json()).toEqual({ data: [{ day: '2026-10-31', count: 1 }, { day: '2026-11-01', count: 3 }] });
    // The scope and the site’s days go into the question (31 Oct 00:00 to 3 Nov 00:00, Muscat).
    expect(asked).toEqual([{ from: '2026-10-30T20:00:00.000Z', to: '2026-11-02T20:00:00.000Z', projectIds: ['p1'], actions: null }]);
  });

  it('an administrator counts every project’s changes', async () => {
    const res = await get('/activity?from=2026-11-01&to=2026-11-01', ['admin', ['ADMIN']]);
    expect(res.json().data).toEqual([{ day: '2026-11-01', count: 4 }]);
  });

  it('follows the filter: Completed takes in reopenings and approvals', async () => {
    asked.length = 0;
    const res = await get('/activity?from=2026-10-31&to=2026-11-02&kind=COMPLETED');
    expect(res.json().data).toEqual([{ day: '2026-11-01', count: 2 }]);
    expect(asked[0]!.actions).toEqual(['COMPLETED', 'REOPENED', 'APPROVED']);
  });

  it('lists one day’s changes, newest first, as the list’s rows (a hidden blocker unnamed)', async () => {
    asked.length = 0;
    const res = await get('/activity?day=2026-11-01');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string; meta: Record<string, unknown> | null }>; next: string | null };
    expect(body.data.map((r) => r.id)).toEqual(['c5', 'c3', 'c2']);
    expect(body.data[0]!.meta).toEqual({});
    expect(body.next).toBeNull();
    expect(asked).toEqual([{ from: '2026-10-31T20:00:00.000Z', to: '2026-11-01T20:00:00.000Z', projectIds: ['p1'], actions: null, before: null, limit: 101 }]);
  });

  it('pages a busy day 100 at a time: `next` says where to carry on, `before` carries on', async () => {
    const busy: ActivityRecord[] = Array.from({ length: 130 }, (_, i) => ({
      id: `b${String(i).padStart(3, '0')}`,
      taskId: 't1',
      projectId: 'p1',
      userId: 'u1',
      action: 'MOVED',
      meta: null,
      createdAt: new Date(Date.UTC(2026, 10, 3, 6, 0, i)),
    }));
    calendarRows = busy;
    try {
      const first = (await get('/activity?day=2026-11-03')).json() as { data: { id: string }[]; next: string | null };
      expect(first.data).toHaveLength(100);
      expect(first.data[0]!.id).toBe('b129');
      expect(first.next).toBe('b030');
      const second = (await get(`/activity?day=2026-11-03&before=${first.next}`)).json() as { data: { id: string }[]; next: string | null };
      expect(second.data.map((r) => r.id)).toEqual(busy.slice(0, 30).map((r) => r.id).reverse());
      expect(second.next).toBeNull();
    } finally {
      calendarRows = cal;
    }
  });

  it('someone on no project gets nothing, without asking the database', async () => {
    asked.length = 0;
    expect((await get('/activity?from=2026-11-01&to=2026-11-01', ['loner', ['EMPLOYEE']])).json()).toEqual({ data: [] });
    expect((await get('/activity?day=2026-11-01', ['loner', ['EMPLOYEE']])).json()).toEqual({ data: [], next: null });
    expect(asked).toEqual([]);
  });

  it('refuses a question it can’t answer (400): no real day, the wrong way round, too long, or both kinds at once', async () => {
    for (const url of [
      '/activity?day=2026-02-30',
      '/activity?from=2026-11-05&to=2026-11-01',
      '/activity?from=2026-01-01&to=2026-12-31',
      '/activity?from=2026-11-01',
      '/activity?day=2026-11-01&from=2026-11-01&to=2026-11-02',
      '/activity?day=2026-11-01&kind=EVERYTHING',
    ]) {
      expect((await get(url)).statusCode, url).toBe(400);
    }
  });

  it('the plain feed (no days asked) is the newest 50, as before', async () => {
    const res = await get('/activity');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
    expect(res.json().next).toBeUndefined();
  });

  it('rejects unauthenticated access (401)', async () => {
    const app = await calendarApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/activity?from=2026-11-01&to=2026-11-01' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/activity?day=2026-11-01' })).statusCode).toBe(401);
  });
});
