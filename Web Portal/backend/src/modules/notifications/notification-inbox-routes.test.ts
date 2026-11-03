import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createNotificationService } from './notification-service';
import { createMemoryNotificationRepository } from './notification-memory.fixture';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

// The Notifications page's routes (1.22): GET /notifications?cursor=&limit=&unread=&kinds=,
// GET /notifications/counts, POST /notifications/:id/unread, DELETE /notifications/:id and
// POST /notifications/bulk — the caller's own notifications, in the companies scope as before.

const tokenService = createTokenService({
  accessSecret: 'ntf-inbox-access',
  refreshSecret: 'ntf-inbox-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const at = (min: number) => new Date(Date.UTC(2026, 10, 3, 8, 0) + min * 60_000);

let repo: ReturnType<typeof createMemoryNotificationRepository>;
let app: Awaited<ReturnType<typeof buildApp>>;
let scope: string[] | null;
async function auth(userId = 'u1') {
  return { authorization: `Bearer ${(await tokenService.issueTokens({ id: userId, roles: ['EMPLOYEE'] })).accessToken}` };
}
const get = async (url: string, userId = 'u1') => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: await auth(userId) });
const send = async (method: 'POST' | 'DELETE', url: string, payload?: object, userId = 'u1') =>
  app.inject({ method, url: `/api/v1${url}`, headers: await auth(userId), ...(payload ? { payload } : {}) });

beforeEach(async () => {
  repo = createMemoryNotificationRepository({ projects: [{ id: 'p1', name: 'Rig Inspection', color: '#0E7490', icon: null, imageUrl: null }] });
  scope = null;
  const projectAccess = { accessibleProjectIds: async () => scope, canViewTask: async () => true, canViewProject: async () => true };
  app = await buildApp({ authService, tokenService, notificationService: createNotificationService({ notifications: repo }), projectAccess } as never);
  const types = ['MENTION', 'TASK_COMMENT', 'TASK_OVERDUE', 'TASK_STATUS', 'CHAT_MENTION'];
  for (let i = 0; i < 5; i++) repo.seed({ userId: 'u1', type: types[i]!, title: `n${i}`, projectId: i === 1 ? 'p1' : i === 2 ? 'p2' : null, createdAt: at(i), readAt: i === 3 ? at(9) : null });
  repo.seed({ userId: 'u2', type: 'MENTION', title: 'u2’s', createdAt: at(0) });
});

describe('GET /notifications — pages, the Unread tab and the chips', () => {
  it('without a query: every one (up to 100), newest first, no cursor — as the bell, the phone app and the extension read it', async () => {
    const res = await get('/notifications');
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((n: { title: string }) => n.title)).toEqual(['n4', 'n3', 'n2', 'n1', 'n0']);
    expect(res.json().nextCursor).toBeNull();
  });

  it('limit + cursor: the next page starts after the last one shown', async () => {
    const one = (await get('/notifications?limit=2')).json();
    expect(one.data.map((n: { title: string }) => n.title)).toEqual(['n4', 'n3']);
    const two = (await get(`/notifications?limit=2&cursor=${one.nextCursor}`)).json();
    expect(two.data.map((n: { title: string }) => n.title)).toEqual(['n2', 'n1']);
    const three = (await get(`/notifications?limit=2&cursor=${two.nextCursor}`)).json();
    expect(three.data.map((n: { title: string }) => n.title)).toEqual(['n0']);
    expect(three.nextCursor).toBeNull();
  });

  it('unread=1 and kinds=… filter, and combine', async () => {
    expect((await get('/notifications?unread=1')).json().data.map((n: { title: string }) => n.title)).toEqual(['n4', 'n2', 'n1', 'n0']);
    expect((await get('/notifications?kinds=mentions')).json().data.map((n: { title: string }) => n.title)).toEqual(['n4', 'n0']);
    expect((await get('/notifications?kinds=comments,due&unread=1')).json().data.map((n: { title: string }) => n.title)).toEqual(['n2', 'n1']);
    expect((await get('/notifications?unread=0&kinds=')).json().data).toHaveLength(5);
  });

  it('each row carries its project (or none)', async () => {
    const rows = (await get('/notifications')).json().data as { title: string; projectId: string | null; project: unknown }[];
    expect(rows.find((n) => n.title === 'n1')).toMatchObject({ projectId: 'p1', project: { id: 'p1', name: 'Rig Inspection', color: '#0E7490' } });
    expect(rows.find((n) => n.title === 'n0')).toMatchObject({ projectId: null, project: null });
  });

  it('refuses a chip, a limit, a cursor or an unread flag it doesn’t know (400)', async () => {
    for (const q of ['kinds=bogus', 'kinds=mentions,bogus', 'limit=0', 'limit=101', 'limit=ten', 'cursor=garbage', 'unread=maybe']) {
      expect((await get(`/notifications?${q}`)).statusCode, q).toBe(400);
    }
  });

  it('only the caller’s; signed out is refused', async () => {
    expect((await get('/notifications', 'u2')).json().data.map((n: { title: string }) => n.title)).toEqual(['u2’s']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/notifications?limit=50' })).statusCode).toBe(401);
  });

  it('the companies scope applies, as before: a row about a project out of scope is hidden', async () => {
    scope = ['p1'];
    expect((await get('/notifications?limit=50')).json().data.map((n: { title: string }) => n.title)).toEqual(['n4', 'n3', 'n1', 'n0']);
  });
});

describe('GET /notifications/counts — unread per chip', () => {
  it('per chip and in all, in the scope', async () => {
    expect((await get('/notifications/counts')).json().data).toEqual({ unread: 4, kinds: { mentions: 2, assigned: 0, due: 1, comments: 1, approvals: 0, meetings: 0 } });
    scope = ['p1'];
    expect((await get('/notifications/counts')).json().data).toEqual({ unread: 3, kinds: { mentions: 2, assigned: 0, due: 0, comments: 1, approvals: 0, meetings: 0 } });
    expect((await get('/notifications/unread-count')).json().data).toEqual({ count: 3 });
  });
});

describe('Mark unread and Remove', () => {
  const idOf = async (title: string) => (await repo.list('u1')).find((n) => n.title === title)!.id;

  it('POST /notifications/:id/unread marks a read one unread', async () => {
    const res = await send('POST', `/notifications/${await idOf('n3')}/unread`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.readAt).toBeNull();
    expect((await get('/notifications/unread-count')).json().data.count).toBe(5);
  });

  it('DELETE /notifications/:id removes it', async () => {
    const res = await send('DELETE', `/notifications/${await idOf('n0')}`);
    expect(res.statusCode).toBe(200);
    expect((await get('/notifications')).json().data.map((n: { title: string }) => n.title)).not.toContain('n0');
  });

  it('someone else’s, or one that isn’t there: 404, and nothing changes', async () => {
    const id = await idOf('n3');
    expect((await send('POST', `/notifications/${id}/unread`, undefined, 'u2')).statusCode).toBe(404);
    expect((await send('DELETE', `/notifications/${id}`, undefined, 'u2')).statusCode).toBe(404);
    expect((await send('DELETE', '/notifications/nope')).statusCode).toBe(404);
    expect((await get('/notifications')).json().data).toHaveLength(5);
  });
});

describe('POST /notifications/bulk — several at once', () => {
  it('read, unread and remove; another person’s ids are skipped', async () => {
    const mine = (await repo.list('u1')).map((n) => n.id);
    const theirs = (await repo.list('u2')).map((n) => n.id);
    expect((await send('POST', '/notifications/bulk', { ids: [...mine, ...theirs], action: 'read' })).json().data).toEqual({ count: 4 });
    expect((await get('/notifications/unread-count', 'u2')).json().data.count).toBe(1);
    expect((await send('POST', '/notifications/bulk', { ids: mine.slice(0, 2), action: 'unread' })).json().data).toEqual({ count: 2 });
    expect((await send('POST', '/notifications/bulk', { ids: [...mine, ...theirs], action: 'remove' })).json().data).toEqual({ count: 5 });
    expect((await get('/notifications', 'u2')).json().data).toHaveLength(1);
  });

  it('refuses none, more than 200, or an action it doesn’t know (400)', async () => {
    expect((await send('POST', '/notifications/bulk', { ids: [], action: 'read' })).statusCode).toBe(400);
    expect((await send('POST', '/notifications/bulk', { ids: Array.from({ length: 201 }, (_, i) => `x${i}`), action: 'read' })).statusCode).toBe(400);
    expect((await send('POST', '/notifications/bulk', { ids: ['x'], action: 'archive' })).statusCode).toBe(400);
    expect((await send('POST', '/notifications/bulk', { action: 'read' })).statusCode).toBe(400);
    expect((await send('POST', '/notifications/bulk', { ids: Array.from({ length: 200 }, (_, i) => `x${i}`), action: 'remove' })).json().data).toEqual({ count: 0 });
  });
});

describe('POST /notifications/read-all follows the chips', () => {
  it('kinds given: only those are read; an unknown chip is refused', async () => {
    expect((await send('POST', '/notifications/read-all', { kinds: ['mentions'] })).statusCode).toBe(200);
    expect((await get('/notifications?unread=1')).json().data.map((n: { title: string }) => n.title)).toEqual(['n2', 'n1']);
    expect((await send('POST', '/notifications/read-all', { kinds: ['bogus'] })).statusCode).toBe(400);
    expect((await send('POST', '/notifications/read-all', {})).statusCode).toBe(200);
    expect((await get('/notifications/unread-count')).json().data.count).toBe(0);
  });
});
