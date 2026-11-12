import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp, type AppDeps } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createMemoryCalendarStore, type CalTaskBrief } from './calendar-store';
import type { CalendarTaskFacts } from './calendar-routes';
import { DEFAULT_CALENDAR_PREFS } from './calendar-prefs';

const tokenService = createTokenService({
  accessSecret: 'cal-access',
  refreshSecret: 'cal-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const bearer = async (id: string, roles: string[] = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

const NOW = new Date('2026-11-12T06:00:00.000Z'); // Thu 12 Nov, 10:00 in Muscat
const day = (k: string) => new Date(`${k}T00:00:00.000Z`);

// t1 in p1 (sara made it; ali and mona on it; boss runs p1); t2 in p2 (only zed may see it).
const FACTS: Record<string, CalendarTaskFacts> = {
  t1: { id: 't1', key: 'RIG-12', title: 'Pour the slab', projectId: 'p1', createdById: 'sara', assigneeIds: ['ali', 'mona'], startDate: day('2026-11-15'), dueDate: day('2026-11-20'), completedAt: null, deletedAt: null },
  t2: { id: 't2', key: 'OPS-3', title: 'Other', projectId: 'p2', createdById: 'zed', assigneeIds: ['zed'], startDate: null, dueDate: day('2026-11-20'), completedAt: null, deletedAt: null },
};
const SEES: Record<string, string[]> = { t1: ['sara', 'ali', 'mona', 'boss', 'kim'], t2: ['zed'] };

let app: Awaited<ReturnType<typeof buildApp>>;
let mem: ReturnType<typeof createMemoryCalendarStore>;
let facts: Record<string, CalendarTaskFacts>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  facts = structuredClone(FACTS);
  mem = createMemoryCalendarStore(new Map(Object.values(facts).map((t) => [t.id, t as CalTaskBrief])));
  app = await buildApp({
    authService,
    tokenService,
    calendarScheduling: {
      store: mem.store,
      task: async (id: string) => facts[id] ?? null,
      canViewTask: async (userId: string, _roles: string[], taskId: string) => (SEES[taskId] ?? []).includes(userId),
      runsProject: async (userId: string, roles: string[], projectId: string) => roles.includes('ADMIN') || (userId === 'boss' && projectId === 'p1'),
      names: async (ids: string[]) => new Map(ids.map((id) => [id, id === 'sara' ? 'Sara Ali' : id[0]!.toUpperCase() + id.slice(1)])),
      clock: async () => ({ timeZone: 'Asia/Muscat', dayStart: '08:00' }),
    },
  } as unknown as AppDeps);
});
afterEach(async () => {
  await app.close();
  vi.useRealTimers();
});

const call = async (who: string, method: string, url: string, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/api/v1${url}`, headers: await bearer(who), ...(payload ? { payload } : {}) });

describe('work blocks on a task', () => {
  const slot = { startAt: '2026-11-15T05:00:00.000Z', endAt: '2026-11-15T06:30:00.000Z' };

  it('an assignee books their own; it lists with who and whether the asker may change it', async () => {
    const res = await call('ali', 'POST', '/tasks/t1/work-blocks', slot);
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ taskId: 't1', userId: 'ali', userName: 'Ali', plannedById: 'ali', startAt: slot.startAt, endAt: slot.endAt, canChange: true });
    const list = await call('kim', 'GET', '/tasks/t1/work-blocks');
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].canChange).toBe(false); // visible to whoever sees the task, changed by few
    // Who the asker may plan for: only themselves when on the task; its people too for its creator / whoever runs it.
    expect(list.json().meta).toEqual({ forPeople: [] });
    expect((await call('ali', 'GET', '/tasks/t1/work-blocks')).json().meta).toEqual({ forPeople: ['ali'] });
    expect((await call('boss', 'GET', '/tasks/t1/work-blocks')).json().meta).toEqual({ forPeople: ['ali', 'mona'] });
    expect((await call('kim', 'GET', '/tasks/t1/reminders')).json().meta).toEqual({ forPeople: ['kim'] });
    expect((await call('sara', 'GET', '/tasks/t1/reminders')).json().meta).toEqual({ forPeople: ['sara', 'ali', 'mona'] });
  });

  it('the creator or whoever runs the project plans time for an assignee ("planned by Sara"); nobody else, and never for someone not on it', async () => {
    const byCreator = await call('sara', 'POST', '/tasks/t1/work-blocks', { ...slot, userId: 'mona' });
    expect(byCreator.statusCode).toBe(201);
    expect(byCreator.json().data).toMatchObject({ userId: 'mona', plannedById: 'sara', plannedByName: 'Sara Ali' });
    expect((await call('ali', 'POST', '/tasks/t1/work-blocks', { ...slot, userId: 'mona' })).statusCode).toBe(403);
    expect((await call('boss', 'POST', '/tasks/t1/work-blocks', { ...slot, userId: 'kim' })).statusCode).toBe(403);
    expect((await call('kim', 'POST', '/tasks/t1/work-blocks', slot)).statusCode).toBe(403);
  });

  it('moved or resized by its person, whoever planned it or runs the project; removed the same', async () => {
    const id = (await call('sara', 'POST', '/tasks/t1/work-blocks', { ...slot, userId: 'mona' })).json().data.id;
    const later = { startAt: '2026-11-16T05:00:00.000Z', endAt: '2026-11-16T07:00:00.000Z' };
    expect((await call('ali', 'PUT', `/tasks/t1/work-blocks/${id}`, later)).statusCode).toBe(403);
    const moved = await call('mona', 'PUT', `/tasks/t1/work-blocks/${id}`, later);
    expect(moved.statusCode).toBe(200);
    expect(moved.json().data).toMatchObject(later);
    expect((await call('kim', 'DELETE', `/tasks/t1/work-blocks/${id}`)).statusCode).toBe(403);
    expect((await call('boss', 'DELETE', `/tasks/t1/work-blocks/${id}`)).statusCode).toBe(204);
    expect(mem.blocks.size).toBe(0);
  });

  it('refuses bad times, a done task, and anything about a task the person can’t open (404, nothing told)', async () => {
    expect((await call('ali', 'POST', '/tasks/t1/work-blocks', { startAt: slot.endAt, endAt: slot.startAt })).statusCode).toBe(400);
    expect((await call('ali', 'POST', '/tasks/t2/work-blocks', slot)).statusCode).toBe(404);
    expect((await call('ali', 'GET', '/tasks/t2/work-blocks')).statusCode).toBe(404);
    const id = (await call('ali', 'POST', '/tasks/t1/work-blocks', slot)).json().data.id;
    // A block is reached through its own task only.
    expect((await call('zed', 'DELETE', `/tasks/t2/work-blocks/${id}`)).statusCode).toBe(404);
    facts.t1!.completedAt = NOW;
    const done = await call('ali', 'POST', '/tasks/t1/work-blocks', slot);
    expect(done.statusCode).toBe(409);
    expect(done.json().error.message).toMatch(/done/);
    // A done task's planned time isn't moved either (it would vanish from the calendar).
    expect((await call('ali', 'PUT', `/tasks/t1/work-blocks/${id}`, slot)).statusCode).toBe(409);
  });
});

describe('personal reminders on a task', () => {
  it('anyone who can see the task adds their own — before the due date, or at a set time', async () => {
    const res = await call('kim', 'POST', '/tasks/t1/reminders', { anchor: 'due', offsetMinutes: 24 * 60 });
    expect(res.statusCode).toBe(201);
    // Due Fri 20 Nov (a day): the day before at the working day's start, 08:00 Muscat.
    expect(res.json().data).toMatchObject({ userId: 'kim', setById: 'kim', fireAt: '2026-11-19T04:00:00.000Z', state: 'wait', canChange: true, canMute: false });
    const at = await call('kim', 'POST', '/tasks/t1/reminders', { at: '2026-11-13T10:00:00.000Z' });
    expect(at.statusCode).toBe(201);
    expect(mem.reminders.size).toBe(2);
    expect([...mem.reminders.values()].map((r) => r.nextAt?.toISOString()).sort()).toEqual(['2026-11-13T10:00:00.000Z', '2026-11-19T04:00:00.000Z']);
  });

  it('refuses a time already passed, a date the task doesn’t have, and nonsense', async () => {
    expect((await call('kim', 'POST', '/tasks/t1/reminders', { at: '2026-11-12T05:00:00.000Z' })).json().error.message).toMatch(/already passed/);
    expect((await call('zed', 'POST', '/tasks/t2/reminders', { anchor: 'start', offsetMinutes: 0 })).json().error.message).toMatch(/no start date/);
    // An automatic start (when the task was made) is no start date anyone chose.
    facts.t2!.startDate = new Date('2026-11-10T07:12:33.000Z');
    expect((await call('zed', 'POST', '/tasks/t2/reminders', { anchor: 'start', offsetMinutes: 0 })).json().error.message).toMatch(/no start date/);
    expect((await call('kim', 'POST', '/tasks/t1/reminders', {})).statusCode).toBe(400);
    expect((await call('kim', 'POST', '/tasks/t1/reminders', { anchor: 'due', offsetMinutes: 99_999_999 })).statusCode).toBe(400);
  });

  it('the creator or whoever runs the project sets one for an assignee; nobody else; never for someone not on it', async () => {
    const res = await call('sara', 'POST', '/tasks/t1/reminders', { userId: 'ali', anchor: 'due', offsetMinutes: 0 });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ userId: 'ali', userName: 'Ali', setById: 'sara', setByName: 'Sara Ali' });
    expect((await call('mona', 'POST', '/tasks/t1/reminders', { userId: 'ali', anchor: 'due', offsetMinutes: 0 })).statusCode).toBe(403);
    expect((await call('boss', 'POST', '/tasks/t1/reminders', { userId: 'kim', anchor: 'due', offsetMinutes: 0 })).statusCode).toBe(403);
    expect((await call('boss', 'POST', '/tasks/t1/reminders', { userId: 'mona', anchor: 'due', offsetMinutes: 0 })).statusCode).toBe(201);
  });

  it('each person sees only their own and the ones they set', async () => {
    await call('kim', 'POST', '/tasks/t1/reminders', { anchor: 'due', offsetMinutes: 0 });
    await call('sara', 'POST', '/tasks/t1/reminders', { userId: 'ali', anchor: 'due', offsetMinutes: 60 });
    const of = async (who: string) => (await call(who, 'GET', '/tasks/t1/reminders')).json().data.map((r: { userId: string; setById: string }) => `${r.setById}>${r.userId}`);
    expect(await of('kim')).toEqual(['kim>kim']);
    expect(await of('ali')).toEqual(['sara>ali']);
    expect(await of('sara')).toEqual(['sara>ali']);
    expect(await of('mona')).toEqual([]);
  });

  it('only the setter changes or removes it; its person mutes or snoozes one set for them (the setter sees “muted by Ali”)', async () => {
    const id = (await call('sara', 'POST', '/tasks/t1/reminders', { userId: 'ali', anchor: 'due', offsetMinutes: 0 })).json().data.id;
    expect((await call('ali', 'PUT', `/tasks/t1/reminders/${id}`, { anchor: 'due', offsetMinutes: 60 })).statusCode).toBe(403);
    expect((await call('ali', 'DELETE', `/tasks/t1/reminders/${id}`)).statusCode).toBe(403);
    const muted = await call('ali', 'POST', `/tasks/t1/reminders/${id}/mute`, { muted: true });
    expect(muted.statusCode).toBe(200);
    expect(muted.json().data).toMatchObject({ muted: true, state: 'muted', canMute: true, canChange: false });
    expect((await call('sara', 'POST', `/tasks/t1/reminders/${id}/mute`, { muted: true })).statusCode).toBe(403);
    const seen = (await call('sara', 'GET', '/tasks/t1/reminders')).json().data[0];
    expect(seen).toMatchObject({ muted: true, userName: 'Ali' });
    // Snooze is for a reminder that has gone: one still to come is changed (by its setter) or muted instead.
    const early = await call('ali', 'POST', `/tasks/t1/reminders/${id}/snooze`, { minutes: 60 });
    expect(early.statusCode).toBe(400);
    expect(early.json().error.message).toMatch(/hasn’t gone yet/);
    vi.setSystemTime(new Date('2026-11-20T05:00:00.000Z')); // after its time (the 20th, 08:00 Muscat)
    const snoozed = await call('ali', 'POST', `/tasks/t1/reminders/${id}/snooze`, { minutes: 60 });
    expect(snoozed.statusCode).toBe(200);
    expect(snoozed.json().data.snoozedUntil).toBe('2026-11-20T06:00:00.000Z');
    vi.setSystemTime(NOW);
    const changed = await call('sara', 'PUT', `/tasks/t1/reminders/${id}`, { anchor: 'due', offsetMinutes: 120 });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().data.snoozedUntil).toBeNull();
    expect((await call('sara', 'DELETE', `/tasks/t1/reminders/${id}`)).statusCode).toBe(204);
  });

  it('a reminder of another task, or of someone else, is not found', async () => {
    const id = (await call('kim', 'POST', '/tasks/t1/reminders', { anchor: 'due', offsetMinutes: 0 })).json().data.id;
    expect((await call('mona', 'DELETE', `/tasks/t1/reminders/${id}`)).statusCode).toBe(404);
    expect((await call('zed', 'DELETE', `/tasks/t2/reminders/${id}`)).statusCode).toBe(404);
  });
});

describe('a person’s own Calendar choices', () => {
  it('start as Split, everything shown, Team off — and are saved cleaned', async () => {
    expect((await call('ali', 'GET', '/calendar/preferences')).json().data).toEqual(DEFAULT_CALENDAR_PREFS);
    expect(DEFAULT_CALENDAR_PREFS).toEqual({ layout: 'split', show: { tasks: true, meetings: true, blocks: true, reminders: true }, team: false });
    const saved = await call('ali', 'PUT', '/calendar/preferences', { layout: 'full', show: { blocks: false }, team: true, junk: 1 });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toEqual({ layout: 'full', show: { tasks: true, meetings: true, blocks: false, reminders: true }, team: true });
    expect((await call('ali', 'GET', '/calendar/preferences')).json().data.layout).toBe('full');
    expect((await call('mona', 'GET', '/calendar/preferences')).json().data.layout).toBe('split');
  });
});

describe('an archived task (Release B x task archive)', () => {
  const slot = { startAt: '2026-11-15T05:00:00.000Z', endAt: '2026-11-15T06:30:00.000Z' };

  it('is read-only: its planned time and reminders still list, nobody may add or change one (409 TASK_ARCHIVED), a reminder set for you can still be muted, and planned time removed', async () => {
    const block = await call('ali', 'POST', '/tasks/t1/work-blocks', slot);
    const set = await call('boss', 'POST', '/tasks/t1/reminders', { userId: 'ali', at: '2026-11-14T05:00:00.000Z' });
    expect(set.statusCode).toBe(201);
    facts.t1!.archivedAt = new Date('2026-11-12T05:00:00.000Z');

    const blocks = await call('ali', 'GET', '/tasks/t1/work-blocks');
    expect(blocks.json().data).toHaveLength(1);
    expect(blocks.json().data[0].canChange).toBe(false);
    expect(blocks.json().meta).toEqual({ forPeople: [] });
    const reminders = await call('boss', 'GET', '/tasks/t1/reminders');
    expect(reminders.json().data[0].canChange).toBe(false);
    expect(reminders.json().meta).toEqual({ forPeople: [] });

    for (const [who, method, url, body] of [
      ['ali', 'POST', '/tasks/t1/work-blocks', slot],
      ['ali', 'PUT', `/tasks/t1/work-blocks/${block.json().data.id}`, slot],
      ['ali', 'POST', '/tasks/t1/reminders', { at: '2026-11-14T06:00:00.000Z' }],
      ['boss', 'PUT', `/tasks/t1/reminders/${set.json().data.id}`, { at: '2026-11-14T07:00:00.000Z' }],
    ] as const) {
      const res = await call(who, method, url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(409);
      expect(res.json().error.code).toBe('TASK_ARCHIVED');
    }
    expect((await call('ali', 'POST', `/tasks/t1/reminders/${set.json().data.id}/mute`, { muted: true })).statusCode).toBe(200);
    expect((await call('ali', 'DELETE', `/tasks/t1/work-blocks/${block.json().data.id}`)).statusCode).toBe(204);
  });
});
