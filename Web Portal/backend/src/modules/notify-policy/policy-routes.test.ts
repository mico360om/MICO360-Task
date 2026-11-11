import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp, type AppDeps } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createNotificationService } from '../notifications/notification-service';
import { createMemoryNotificationRepository } from '../notifications/notification-memory.fixture';
import { normalizePreferences, type NotificationPreferences } from '../notifications/notification-preferences';
import { createMemoryPolicyStore } from './policy-store';
import { createNotifyPolicyService } from './policy-service';
import { DEFAULT_POLICY } from './policy';
import type { NotifyPolicyRouteDeps } from './policy-routes';

const tokenService = createTokenService({
  accessSecret: 'np-access',
  refreshSecret: 'np-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const bearer = async (id: string, roles: string[]) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

const prefsStore = new Map<string, NotificationPreferences>();
const service = createNotifyPolicyService({
  store: createMemoryPolicyStore(['c1', 'c2']),
  companyHours: async () => ({ weekStart: 0, hours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' } }),
  timeZone: 'Asia/Muscat',
  cacheMs: 0,
});
const wiring = {
  companies: vi.fn(async () => [{ id: 'c1', name: 'Prolens' }, { id: 'c2', name: 'Second' }]),
  workingTimeOf: vi.fn(async () => ({ weekStart: 0 as const, workingHours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' }, own: false })),
  saveWorkingTime: vi.fn(async (_c: string, v: { weekStart: 0 | 1 | 6; workingHours: { days: number[]; start: string; end: string } }) => ({ ...v, own: true })),
  resetWorkingTime: vi.fn(async () => ({ weekStart: 0 as const, workingHours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' }, own: false })),
  people: vi.fn(async () => [{ id: 'u1', name: 'Sara', email: 's@x.co', admin: false }]),
  meetingReminders: vi.fn(async () => ({ enabled: true, times: [] })),
  preview: vi.fn(async (companyId: string, userId: string) => ({ companyId, person: { id: userId } })),
  personPolicy: vi.fn(async (userId: string) => ({ userId })),
  workingTime: vi.fn(async (viewer: { id: string }, target: object, range: object) => ({ viewer: viewer.id, target, range })),
  projectReminders: { get: vi.fn(async (_v: unknown, id: string) => ({ projectId: id })), set: vi.fn(async (_v: unknown, id: string, body: unknown) => ({ projectId: id, body })) },
  taskSchedule: { get: vi.fn(async (_v: unknown, id: string) => ({ taskId: id })), set: vi.fn(async (_v: unknown, id: string, scheduleId: string | null) => ({ taskId: id, scheduleId })) },
} satisfies Omit<NotifyPolicyRouteDeps, 'guard' | 'service' | 'pickOf' | 'timeZone'>;

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  const notificationService = createNotificationService({
    notifications: createMemoryNotificationRepository(),
    preferences: { get: async (u) => prefsStore.get(u) ?? normalizePreferences(null), set: async (u, p) => (prefsStore.set(u, p), p) },
  });
  app = await buildApp({
    authService,
    tokenService,
    notificationService,
    notifyPolicy: { service, timeZone: 'Asia/Muscat', ...wiring },
    notificationPolicyOf: async () => ({ ...DEFAULT_POLICY, channels: { ...DEFAULT_POLICY.channels, status: { bell: false, push: false, email: false } } }),
  } as unknown as AppDeps);
});
afterAll(() => app.close());

describe('the admin panel is for administrators only', () => {
  const routes: [string, string, object?][] = [
    ['GET', '/api/v1/notification-settings'],
    ['GET', '/api/v1/notification-settings/c1'],
    ['PUT', '/api/v1/notification-settings/c1/working-time', { weekStart: 0, workingHours: { days: [0], start: '08:00', end: '17:00' } }],
    ['DELETE', '/api/v1/notification-settings/c1/working-time'],
    ['PUT', '/api/v1/notification-settings/c1/policy', { required: ['overdue'] }],
    ['POST', '/api/v1/notification-settings/c1/holidays', { day: '2026-12-31', name: 'Year end' }],
    ['POST', '/api/v1/notification-settings/c1/holidays/starter', { year: 2027 }],
    ['PUT', '/api/v1/notification-settings/c1/holidays/h1', { name: 'X' }],
    ['DELETE', '/api/v1/notification-settings/c1/holidays/h1'],
    ['POST', '/api/v1/notification-settings/c1/schedules', { name: 'X', steps: { onDue: true } }],
    ['PUT', '/api/v1/notification-settings/c1/schedules/s1', { name: 'Y' }],
    ['DELETE', '/api/v1/notification-settings/c1/schedules/s1'],
    ['POST', '/api/v1/notification-settings/c1/schedules/s1/default'],
    ['GET', '/api/v1/notification-settings/c1/preview?userId=u1'],
  ];
  it.each(routes)('%s %s: 401 signed out, 403 for a project manager', async (method, url, payload) => {
    expect((await app.inject({ method: method as 'GET', url, ...(payload ? { payload } : {}) })).statusCode).toBe(401);
    const res = await app.inject({ method: method as 'GET', url, headers: await bearer('pm', ['PROJECT_MANAGER']), ...(payload ? { payload } : {}) });
    expect(res.statusCode).toBe(403);
  });

  it('an administrator reads a company’s panel: rules, defaults, holidays (seeded), schedules, people', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/notification-settings/c1', headers: await bearer('admin', ['ADMIN']) });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.policy).toEqual(DEFAULT_POLICY);
    expect(d.schedules.map((s: { name: string }) => s.name)).toEqual(['Standard', 'Critical']);
    expect(d.holidays.length).toBeGreaterThan(10);
    expect(d.people).toEqual([{ id: 'u1', name: 'Sara', email: 's@x.co', admin: false }]);
    expect(d.timeZone).toBe('Asia/Muscat');
  });

  it('per company: a change to one company never reaches another; an unknown company is 404', async () => {
    const h = await bearer('admin', ['ADMIN']);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/notification-settings/c1/policy', headers: h, payload: { escalation: { step1Days: 6, step2Days: 4 } } })).json().data.escalation).toMatchObject({ step1Days: 6, step2Days: 4 });
    const c2 = (await app.inject({ method: 'GET', url: '/api/v1/notification-settings/c2', headers: h })).json().data;
    expect(c2.policy.escalation).toMatchObject({ step1Days: 3, step2Days: 5 });
    expect((await app.inject({ method: 'PUT', url: '/api/v1/notification-settings/nope/policy', headers: h, payload: {} })).statusCode).toBe(404);
    // A holiday of c1 can't be changed through c2.
    const hol = (await app.inject({ method: 'POST', url: '/api/v1/notification-settings/c1/holidays', headers: h, payload: { day: '2026-12-30', name: 'Office closed' } })).json().data;
    expect((await app.inject({ method: 'PUT', url: `/api/v1/notification-settings/c2/holidays/${hol.id}`, headers: h, payload: { name: 'Taken' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/notification-settings/c2/holidays/${hol.id}`, headers: h })).statusCode).toBe(404);
  });

  it('working time: a day that ends before it starts is refused; a good one is saved by the company rule', async () => {
    const h = await bearer('admin', ['ADMIN']);
    const bad = await app.inject({ method: 'PUT', url: '/api/v1/notification-settings/c1/working-time', headers: h, payload: { weekStart: 0, workingHours: { days: [0, 1], start: '17:00', end: '08:00' } } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'PUT', url: '/api/v1/notification-settings/c1/working-time', headers: h, payload: { weekStart: 6, workingHours: { days: [6, 0, 1, 2, 3], start: '07:30', end: '16:30' } } });
    expect(ok.json().data).toEqual({ weekStart: 6, workingHours: { days: [6, 0, 1, 2, 3], start: '07:30', end: '16:30' }, own: true });
    expect(wiring.saveWorkingTime).toHaveBeenCalledWith('c1', expect.anything(), { id: 'admin', roles: ['ADMIN'] }, expect.anything());
  });

  it('preview asks for a person', async () => {
    const h = await bearer('admin', ['ADMIN']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/notification-settings/c1/preview', headers: h })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/notification-settings/c1/preview?userId=u1', headers: h })).json().data).toEqual({ companyId: 'c1', person: { id: 'u1' } });
  });
});

describe('a person’s own rules, working time, a project’s and a task’s reminders', () => {
  it('GET /notifications/policy answers for the caller only', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/notifications/policy' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/notifications/policy', headers: await bearer('u7', ['EMPLOYEE']) })).json().data).toEqual({ userId: 'u7' });
  });

  it('GET /working-time passes the asker and what they asked for; ranges are bounded', async () => {
    const h = await bearer('u7', ['EMPLOYEE']);
    const res = await app.inject({ method: 'GET', url: '/api/v1/working-time?projectId=p1&from=2026-11-01&to=2026-11-30', headers: h });
    expect(res.json().data).toEqual({ viewer: 'u7', target: { projectId: 'p1', companyId: null, pick: null }, range: { from: '2026-11-01', to: '2026-11-30' } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/working-time?from=2025-01-01&to=2027-12-31', headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/working-time?from=2026-01-01&to=2030-01-01', headers: h })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/working-time?from=2026-12-01&to=2026-11-01', headers: h })).statusCode).toBe(400);
  });

  it('project reminders and a task’s schedule go to their rules with the asker', async () => {
    const h = await bearer('u7', ['EMPLOYEE']);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/projects/p1/reminders', headers: h, payload: { scheduleId: 's2', escalationDays: { step1Days: 2, step2Days: 3 } } })).json().data).toEqual({ projectId: 'p1', body: { scheduleId: 's2', escalationDays: { step1Days: 2, step2Days: 3 } } });
    expect((await app.inject({ method: 'PUT', url: '/api/v1/projects/p1/reminders', headers: h, payload: { escalationDays: { step1Days: 0, step2Days: 3 } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/tasks/t1/reminder-schedule', headers: h, payload: { scheduleId: null } })).json().data).toEqual({ taskId: 't1', scheduleId: null });
    expect(wiring.taskSchedule.set).toHaveBeenCalledWith({ id: 'u7', roles: ['EMPLOYEE'] }, 't1', null, expect.anything());
  });
});

describe('preferences: older apps and the website side by side', () => {
  it('older apps read muted as every type whose bell is off (the company’s defaults too) and their save sets the bells', async () => {
    const h = await bearer('old', ['EMPLOYEE']);
    const got = (await app.inject({ method: 'GET', url: '/api/v1/notifications/preferences', headers: h })).json().data;
    // The company (here) defaults "Task moved" off: an older app shows it off.
    expect(got.muted).toEqual(['TASK_STATUS']);
    expect(got.dailyEmails).toBeDefined();
    // The older app turns "Task moved" on and comments off, with its lead time.
    const saved = (await app.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: h, payload: { muted: ['TASK_COMMENT'], reminderLeadMinutes: 1440 } })).json().data;
    expect(saved.muted).toEqual(['TASK_COMMENT']);
    expect(saved.reminderLeadMinutes).toBe(1440);
    expect(prefsStore.get('old')?.channels).toMatchObject({ status: { bell: true }, comments: { bell: false } });
  });

  it('the website’s channel choices keep muted in step; quiet hours, break-through and Pause are kept unless sent', async () => {
    const h = await bearer('web', ['EMPLOYEE']);
    await app.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: h, payload: { channels: { comments: { bell: false }, overdue: { email: true } }, quietHours: { mode: 'custom', start: '21:00', end: '06:30', daysOff: false }, breakThrough: { mentions: false } } });
    expect(prefsStore.get('web')).toMatchObject({ muted: ['TASK_COMMENT'], channels: { comments: { bell: false }, overdue: { email: true } }, quietHours: { mode: 'custom', start: '21:00', end: '06:30', daysOff: false }, breakThrough: { mentions: false } });
    // An older app's daily email save keeps them.
    await app.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: h, payload: { dailyEmails: { pending: true, completed: false, time: '07:00' } } });
    expect(prefsStore.get('web')).toMatchObject({ quietHours: { mode: 'custom' }, breakThrough: { mentions: false }, channels: { overdue: { email: true } } });
    // null clears.
    await app.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: h, payload: { quietHours: null, breakThrough: null } });
    expect(prefsStore.get('web')?.quietHours).toBeUndefined();
    expect(prefsStore.get('web')?.breakThrough).toBeUndefined();
  });

  it('review M6: “No extra reminder” clears the lead time alone (nothing else is touched)', async () => {
    const h = await bearer('lead', ['EMPLOYEE']);
    await app.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: h, payload: { muted: ['TASK_COMMENT'], reminderLeadMinutes: 1440 } });
    const cleared = (await app.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: h, payload: { reminderLeadMinutes: null } })).json().data;
    expect(cleared.reminderLeadMinutes).toBeUndefined();
    expect(prefsStore.get('lead')?.muted).toEqual(['TASK_COMMENT']);
  });

  it('Pause: up to two weeks; null resumes', async () => {
    const h = await bearer('pause', ['EMPLOYEE']);
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect((await app.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: h, payload: { pauseUntil: soon } })).json().data.pauseUntil).toBe(soon);
    const far = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    expect((await app.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: h, payload: { pauseUntil: far } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: h, payload: { pauseUntil: null } })).json().data.pauseUntil).toBeUndefined();
  });
});
