import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../app';
import { createNotificationService } from './notification-service';
import { normalizePreferences } from './notification-preferences';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { NotificationRepository } from './notification-repository';
import { createMemoryNotificationRepository } from './notification-memory.fixture';

/** The shared in-memory repository (the database's rules), a fresh one per call. */
const inMemory = (): NotificationRepository => createMemoryNotificationRepository();

const tokenService = createTokenService({
  accessSecret: 'ntf-access',
  refreshSecret: 'ntf-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

async function makeApp() {
  const notificationService = createNotificationService({ notifications: inMemory() });
  await notificationService.notify({ userId: 'u1', type: 'TASK_ASSIGNED', title: 'hello' });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, notificationService });
}
async function token() {
  return (await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'] })).accessToken;
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});

describe('Notification routes', () => {
  it('lists the current user’s notifications (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: { authorization: `Bearer ${await token()}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it('reports the unread count (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications/unread-count', headers: { authorization: `Bearer ${await token()}` } });
    expect(res.json().data.count).toBe(1);
  });

  it('rejects unauthenticated access (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications' });
    expect(res.statusCode).toBe(401);
  });
});

describe('Notification preferences: daily task emails', () => {
  async function appWithStore() {
    const stored = new Map<string, unknown>();
    const notificationService = createNotificationService({
      notifications: inMemory(),
      preferences: {
        async get(userId) { return normalizePreferences(stored.get(userId) ?? null); },
        async set(userId, prefs) { stored.set(userId, prefs); return prefs; },
      },
    });
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    return buildApp({ authService, tokenService, notificationService });
  }

  it('reads the daily email settings, on at 06:00 by default', async () => {
    const a = await appWithStore();
    const res = await a.inject({ method: 'GET', url: '/api/v1/notifications/preferences', headers: { authorization: `Bearer ${await token()}` } });
    expect(res.json().data.dailyEmails).toEqual({ pending: true, completed: true, time: '06:00', schedule: true, urgent: true, managed: true, glance: true, week: true, priority: true, comingUp: true, projects: true });
  });

  it('1.22: saves each part of the one daily email', async () => {
    const a = await appWithStore();
    const auth = { authorization: `Bearer ${await token()}` };
    const saved = await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { dailyEmails: { schedule: false, urgent: true, pending: false, managed: false, completed: true, time: '07:00', glance: true, week: false, priority: true, comingUp: false, projects: true } } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.dailyEmails).toEqual({ pending: false, completed: true, time: '07:00', schedule: false, urgent: true, managed: false, glance: true, week: false, priority: true, comingUp: false, projects: true });
    expect((await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { dailyEmails: { glance: 'no' } } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { dailyEmails: { managed: 'no' } } })).statusCode).toBe(400);
  });

  it('1.22: an older app that knows only the two old switches keeps their meaning', async () => {
    const a = await appWithStore();
    const auth = { authorization: `Bearer ${await token()}` };
    const put = async (dailyEmails: Record<string, unknown>) =>
      (await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { dailyEmails } })).json().data.dailyEmails;
    // Its "Pending tasks" switch is the task list: both task parts follow it.
    expect(await put({ pending: false, completed: true, time: '06:00' })).toMatchObject({ pending: false, urgent: false, completed: true, schedule: true, managed: true });
    // Both old emails off: no email at all.
    expect(await put({ pending: false, completed: false, time: '06:00' })).toEqual({ pending: false, completed: false, time: '06:00', schedule: false, urgent: false, managed: false, glance: false, week: false, priority: false, comingUp: false, projects: false });
    // Turning "Pending tasks" back on brings both task parts back.
    expect(await put({ pending: true, completed: false, time: '06:00' })).toMatchObject({ pending: true, urgent: true, completed: false });
  });

  it('1.22 review: an older app always sends both old switches — a save that changes neither keeps the parts chosen on the website', async () => {
    const a = await appWithStore();
    const auth = { authorization: `Bearer ${await token()}` };
    const put = async (dailyEmails: Record<string, unknown>) =>
      (await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { dailyEmails } })).json().data.dailyEmails;
    // On the website: only the schedule and Overdue & urgent.
    await put({ schedule: true, urgent: true, pending: false, managed: false, completed: false, time: '06:00', glance: false, week: false, priority: false, comingUp: false, projects: false });
    // The extension changes only the time (it sends the two old switches as they are).
    expect(await put({ pending: false, completed: false, time: '07:00' })).toEqual({ pending: false, completed: false, time: '07:00', schedule: true, urgent: true, managed: false, glance: false, week: false, priority: false, comingUp: false, projects: false });
    // It turns "Completed yesterday" on: Overdue & urgent stays as chosen; This week (its match) comes on.
    expect(await put({ pending: false, completed: true, time: '07:00' })).toEqual({ pending: false, completed: true, time: '07:00', schedule: true, urgent: true, managed: false, glance: false, week: true, priority: false, comingUp: false, projects: false });
  });

  it('1.22 review: an older app turning the email off and on again brings every part back, not just the task list', async () => {
    const a = await appWithStore();
    const auth = { authorization: `Bearer ${await token()}` };
    const put = async (dailyEmails: Record<string, unknown>) =>
      (await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { dailyEmails } })).json().data.dailyEmails;
    expect(await put({ pending: true, completed: true, time: '06:00' })).toEqual({ pending: true, completed: true, time: '06:00', schedule: true, urgent: true, managed: true, glance: true, week: true, priority: true, comingUp: true, projects: true });
    // Both old emails off: no email at all.
    expect(await put({ pending: false, completed: false, time: '06:00' })).toEqual({ pending: false, completed: false, time: '06:00', schedule: false, urgent: false, managed: false, glance: false, week: false, priority: false, comingUp: false, projects: false });
    // Both on again: the email is as it was — Today's meetings, the managers' parts and the new parts too.
    expect(await put({ pending: true, completed: true, time: '06:00' })).toEqual({ pending: true, completed: true, time: '06:00', schedule: true, urgent: true, managed: true, glance: true, week: true, priority: true, comingUp: true, projects: true });
    // Off again, then only "Completed yesterday" on: the parts beside the task list come back; the task parts stay off.
    await put({ pending: false, completed: false, time: '06:00' });
    const back = { pending: false, completed: true, schedule: true, urgent: false, managed: true, glance: false, week: true, priority: false, comingUp: false, projects: true };
    expect(await put({ pending: false, completed: true, time: '06:00' })).toEqual({ ...back, time: '06:00' });
    // The time alone still changes nothing else (lane E's rule).
    expect(await put({ pending: false, completed: true, time: '08:30' })).toEqual({ ...back, time: '08:30' });
  });

  it('redesign: an older app turning "Pending tasks" off and on takes the parts about open tasks with it', async () => {
    const a = await appWithStore();
    const auth = { authorization: `Bearer ${await token()}` };
    const put = async (dailyEmails: Record<string, unknown>) =>
      (await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { dailyEmails } })).json().data.dailyEmails;
    // The Android app sends one switch at a time.
    expect(await put({ pending: false })).toMatchObject({ pending: false, urgent: false, glance: false, priority: false, comingUp: false, week: true, projects: true, schedule: true });
    expect(await put({ pending: true })).toMatchObject({ pending: true, urgent: true, glance: true, priority: true, comingUp: true });
    expect(await put({ completed: false })).toMatchObject({ completed: false, week: false, glance: true });
  });

  it('redesign: a 1.22 website (it knows five parts) turning every one of them off sends no email; back on brings the new parts back', async () => {
    const a = await appWithStore();
    const auth = { authorization: `Bearer ${await token()}` };
    const put = async (dailyEmails: Record<string, unknown>) =>
      (await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { dailyEmails } })).json().data.dailyEmails;
    const five = (on: boolean) => ({ schedule: on, urgent: on, pending: on, managed: on, completed: on, time: '06:00' });
    expect(await put(five(false))).toEqual({ ...five(false), glance: false, week: false, priority: false, comingUp: false, projects: false });
    expect(await put(five(true))).toEqual({ ...five(true), glance: true, week: true, priority: true, comingUp: true, projects: true });
    // Its "In your projects" switch takes Your projects with it; the other new parts stay.
    expect(await put({ ...five(true), managed: false })).toMatchObject({ managed: false, projects: false, glance: true, week: true });
    // The new website's own switches are saved as they are.
    expect(await put({ ...five(true), glance: false, projects: true })).toMatchObject({ glance: false, projects: true, managed: true });
  });

  it('redesign: a save that changes no old part leaves the new parts alone (a summary-only email stays)', async () => {
    const a = await appWithStore();
    const auth = { authorization: `Bearer ${await token()}` };
    const put = async (dailyEmails: Record<string, unknown>) =>
      (await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { dailyEmails } })).json().data.dailyEmails;
    const glanceOnly = { pending: false, completed: false, schedule: false, urgent: false, managed: false, glance: true, week: false, priority: false, comingUp: false, projects: false };
    await put({ ...glanceOnly, time: '06:00' });
    // An older app changes only the time (sending the two old switches as they are).
    expect(await put({ pending: false, completed: false, time: '07:00' })).toEqual({ ...glanceOnly, time: '07:00' });
  });

  it('saves them without losing other settings, and an app that doesn’t know them keeps them', async () => {
    const a = await appWithStore();
    const auth = { authorization: `Bearer ${await token()}` };
    await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { muted: ['TASK_COMMENT'], reminderLeadMinutes: 120 } });
    const saved = await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { dailyEmails: { completed: false, time: '07:15' } } });
    expect(saved.json().data).toMatchObject({ muted: ['TASK_COMMENT'], reminderLeadMinutes: 120, dailyEmails: { pending: true, completed: false, time: '07:15', schedule: true, urgent: true, managed: true, glance: true, week: false, priority: true, comingUp: true, projects: true } });
    // The phone app (before this release) saves the muted types with the reminder time, and leaves the
    // reminder time out to go back to the default — that still works, and the daily emails stay.
    await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { muted: [] } });
    const after = (await a.inject({ method: 'GET', url: '/api/v1/notifications/preferences', headers: auth })).json().data;
    expect(after).toMatchObject({ muted: [], dailyEmails: { pending: true, completed: false, time: '07:15' } });
    expect(after.reminderLeadMinutes).toBeUndefined();
  });

  it('saves the weekly management summary switch, and saves that leave it out keep it', async () => {
    const a = await appWithStore();
    const auth = { authorization: `Bearer ${await token()}` };
    expect((await a.inject({ method: 'GET', url: '/api/v1/notifications/preferences', headers: auth })).json().data.weeklySummary).toBe(true);
    const off = await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { weeklySummary: false } });
    expect(off.statusCode).toBe(200);
    expect(off.json().data.weeklySummary).toBe(false);
    // The daily email settings and an older app's save (muted types only) leave it as it is.
    await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { dailyEmails: { time: '07:00' } } });
    await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { muted: ['TASK_COMMENT'] } });
    expect((await a.inject({ method: 'GET', url: '/api/v1/notifications/preferences', headers: auth })).json().data).toMatchObject({ weeklySummary: false, muted: ['TASK_COMMENT'] });
    expect((await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { weeklySummary: 'off' } })).statusCode).toBe(400);
  });

  it('refuses a time that isn’t HH:MM', async () => {
    const a = await appWithStore();
    const res = await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: { authorization: `Bearer ${await token()}` }, payload: { dailyEmails: { time: '6pm' } } });
    expect(res.statusCode).toBe(400);
  });
});

describe('Mark all read up to the newest shown (5c review)', () => {
  async function appWithSpy() {
    const notificationService = createNotificationService({ notifications: inMemory() });
    const markAllRead = vi.spyOn(notificationService, 'markAllRead');
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    return { app: await buildApp({ authService, tokenService, notificationService }), markAllRead };
  }
  const post = async (a: Awaited<ReturnType<typeof appWithSpy>>['app'], body?: unknown) =>
    a.inject({ method: 'POST', url: '/api/v1/notifications/read-all', headers: { authorization: `Bearer ${await token()}` }, ...(body !== undefined ? { payload: body as object } : {}) });

  it('reads only what came in up to the time given: a newer one stays unread', async () => {
    const { app: a, markAllRead } = await appWithSpy();
    const res = await post(a, { upTo: '2026-10-21T10:00:00.000Z' });
    expect(res.statusCode).toBe(200);
    // (the third argument is the companies scope: none without the company module wired)
    expect(markAllRead).toHaveBeenCalledWith('u1', new Date('2026-10-21T10:00:00.000Z'), undefined);
  });

  it('without a time, reads everything, as before (older apps and pages)', async () => {
    const { app: a, markAllRead } = await appWithSpy();
    expect((await post(a)).statusCode).toBe(200);
    expect(markAllRead).toHaveBeenCalledWith('u1', undefined, undefined);
    expect((await post(a, {})).statusCode).toBe(200);
    expect(markAllRead).toHaveBeenLastCalledWith('u1', undefined, undefined);
  });

  it('refuses a time that isn’t one', async () => {
    const { app: a, markAllRead } = await appWithSpy();
    expect((await post(a, { upTo: 'yesterday' })).statusCode).toBe(400);
    expect(markAllRead).not.toHaveBeenCalled();
  });
});
