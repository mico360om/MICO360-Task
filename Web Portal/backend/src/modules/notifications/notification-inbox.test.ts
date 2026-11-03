import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createNotificationService } from './notification-service';
import { createMemoryNotificationRepository } from './notification-memory.fixture';
import { NotFoundError, ValidationError } from '../../lib/http-errors';

// The Notifications page (1.22): pages of the list by a cursor, the Unread tab and the type chips,
// unread counts per chip, Mark unread, Remove, and the same for several at once — the caller's own only.

const at = (min: number) => new Date(Date.UTC(2026, 10, 3, 8, 0) + min * 60_000);

let repo: ReturnType<typeof createMemoryNotificationRepository>;
let svc: ReturnType<typeof createNotificationService>;
beforeEach(() => {
  repo = createMemoryNotificationRepository({
    projects: [
      { id: 'p1', name: 'Rig Inspection', color: '#0E7490', icon: 'wrench', imageUrl: null },
      { id: 'p2', name: 'Finance', color: '#7C3AED', icon: null, imageUrl: '/uploads/fin.png' },
    ],
  });
  svc = createNotificationService({ notifications: repo });
});

async function seed(n: number, userId = 'u1', make: (i: number) => Partial<{ type: string; projectId: string | null; read: boolean }> = () => ({})) {
  for (let i = 0; i < n; i++) {
    const m = make(i);
    repo.seed({ userId, type: m.type ?? 'TASK_COMMENT', title: `n${i}`, projectId: m.projectId ?? null, createdAt: at(i), readAt: m.read ? at(i + 1) : null });
  }
}

describe('pages of the list, newest first, by a cursor', () => {
  it('120 notifications: 50, 50, then 20 and no cursor — every one once, newest first', async () => {
    await seed(120);
    const one = await svc.listPage('u1', undefined, { limit: 50 });
    expect(one.data).toHaveLength(50);
    expect(one.data[0]!.title).toBe('n119');
    expect(one.nextCursor).toEqual(expect.any(String));
    const two = await svc.listPage('u1', undefined, { limit: 50, cursor: one.nextCursor! });
    const three = await svc.listPage('u1', undefined, { limit: 50, cursor: two.nextCursor! });
    expect(two.data).toHaveLength(50);
    expect(three.data).toHaveLength(20);
    expect(three.nextCursor).toBeNull();
    const titles = [...one.data, ...two.data, ...three.data].map((n) => n.title);
    expect(new Set(titles).size).toBe(120);
    expect(titles.at(-1)).toBe('n0');
  });

  it('rows of the same moment are neither skipped nor repeated across a page break', async () => {
    for (let i = 0; i < 7; i++) repo.seed({ userId: 'u1', type: 'TASK_COMMENT', title: `same${i}`, createdAt: at(0) });
    const one = await svc.listPage('u1', undefined, { limit: 3 });
    const two = await svc.listPage('u1', undefined, { limit: 3, cursor: one.nextCursor! });
    const three = await svc.listPage('u1', undefined, { limit: 3, cursor: two.nextCursor! });
    expect([...one.data, ...two.data, ...three.data].map((n) => n.title).sort()).toEqual(['same0', 'same1', 'same2', 'same3', 'same4', 'same5', 'same6']);
    expect(three.nextCursor).toBeNull();
  });

  it('without a limit, the newest 100 (the bell, the phone app and the extension, as before)', async () => {
    await seed(130);
    const page = await svc.listPage('u1');
    expect(page.data).toHaveLength(100);
    expect(page.nextCursor).toEqual(expect.any(String));
  });

  it('exactly a page’s worth: no cursor (nothing older to ask for)', async () => {
    await seed(50);
    expect((await svc.listPage('u1', undefined, { limit: 50 })).nextCursor).toBeNull();
  });

  it('a cursor that isn’t ours is refused', async () => {
    await expect(svc.listPage('u1', undefined, { cursor: 'garbage' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('only the caller’s notifications', async () => {
    await seed(3, 'u1');
    await seed(4, 'u2');
    expect((await svc.listPage('u1')).data.map((n) => n.title)).toEqual(['n2', 'n1', 'n0']);
  });
});

describe('the Unread tab and the type chips', () => {
  beforeEach(async () => {
    await seed(12, 'u1', (i) => ({
      type: ['MENTION', 'CHAT_MENTION', 'TASK_ASSIGNED', 'TASK_OVERDUE', 'TASK_STATUS', 'MEETING_REMINDER'][i % 6],
      read: i % 2 === 1,
    }));
  });

  it('Unread: only unread ones', async () => {
    const page = await svc.listPage('u1', undefined, { unread: true });
    expect(page.data.every((n) => n.readAt === null)).toBe(true);
    expect(page.data).toHaveLength(6);
  });

  it('chips: only their types (Mentions = task and chat mentions); chips and Unread combine', async () => {
    expect((await svc.listPage('u1', undefined, { kinds: ['mentions'] })).data.map((n) => n.type).sort()).toEqual(['CHAT_MENTION', 'CHAT_MENTION', 'MENTION', 'MENTION']);
    const unreadMentions = await svc.listPage('u1', undefined, { kinds: ['mentions'], unread: true });
    expect(unreadMentions.data.map((n) => n.type)).toEqual(['MENTION', 'MENTION']);
    expect((await svc.listPage('u1', undefined, { kinds: ['assigned', 'meetings'] })).data.map((n) => n.type).sort()).toEqual(['MEETING_REMINDER', 'MEETING_REMINDER', 'TASK_ASSIGNED', 'TASK_ASSIGNED']);
  });

  it('unread counts per chip, and the total unread (every type, as the badge)', async () => {
    // unread: i = 0 MENTION, 2 TASK_ASSIGNED, 4 TASK_STATUS, 6 MENTION, 8 TASK_ASSIGNED, 10 TASK_STATUS
    expect(await svc.counts('u1')).toEqual({ unread: 6, kinds: { mentions: 2, assigned: 2, due: 0, comments: 0, approvals: 0, meetings: 0 } });
    expect((await svc.counts('u1')).unread).toBe(await svc.unreadCount('u1'));
  });
});

describe('the project each is about', () => {
  it('carries the project’s id, name, colour, icon and picture; none for a notice about no project', async () => {
    repo.seed({ userId: 'u1', type: 'TASK_COMMENT', title: 'rig', projectId: 'p1', createdAt: at(2) });
    repo.seed({ userId: 'u1', type: 'TASK_DIGEST', title: 'digest', projectId: null, createdAt: at(1) });
    repo.seed({ userId: 'u1', type: 'TASK_COMMENT', title: 'gone', projectId: 'p-deleted', createdAt: at(0) });
    const [rig, digest, gone] = (await svc.listPage('u1')).data;
    expect(rig).toMatchObject({ projectId: 'p1', project: { id: 'p1', name: 'Rig Inspection', color: '#0E7490', icon: 'wrench', imageUrl: null } });
    expect(digest).toMatchObject({ projectId: null, project: null });
    expect(gone).toMatchObject({ projectId: 'p-deleted', project: null });
  });

  it('asks for each page’s projects once', async () => {
    const looks = vi.spyOn(repo, 'projectLooks');
    await seed(5, 'u1', (i) => ({ projectId: i % 2 ? 'p1' : 'p2' }));
    await svc.listPage('u1');
    expect(looks).toHaveBeenCalledTimes(1);
    expect([...(looks.mock.calls[0]![0] as string[])].sort()).toEqual(['p1', 'p2']);
  });
});

describe('the companies scope reaches every list and count (unchanged rule)', () => {
  it('passes the scope’s projects to the page, the counts and read-all', async () => {
    const list = vi.spyOn(repo, 'list');
    const byType = vi.spyOn(repo, 'unreadByType');
    const readAll = vi.spyOn(repo, 'markAllRead');
    const scope = { projectIds: ['p1'], pick: 'A' };
    await svc.listPage('u1', scope, { limit: 50, unread: true, kinds: ['due'] });
    expect(list).toHaveBeenLastCalledWith('u1', ['p1'], { limit: 51, unreadOnly: true, types: ['TASK_DUE_SOON', 'TASK_OVERDUE', 'TASK_ESCALATION'] });
    await svc.counts('u1', scope);
    expect(byType).toHaveBeenLastCalledWith('u1', ['p1']);
    await svc.markAllRead('u1', undefined, scope, ['comments']);
    expect(readAll).toHaveBeenLastCalledWith('u1', undefined, ['p1'], ['TASK_COMMENT']);
  });

  it('hides rows about a project outside the scope (and keeps rows about no project)', async () => {
    await seed(1, 'u1', () => ({ projectId: 'p1' }));
    await seed(1, 'u1', () => ({ projectId: 'p2' }));
    await seed(1, 'u1', () => ({ projectId: null }));
    const page = await svc.listPage('u1', { projectIds: ['p1'], pick: null });
    expect(page.data.map((n) => n.projectId)).toEqual(expect.arrayContaining(['p1', null]));
    expect(page.data).toHaveLength(2);
  });
});

describe('Mark all read follows the chips', () => {
  it('reads only the chips’ unread ones; without chips, all', async () => {
    repo.seed({ userId: 'u1', type: 'MENTION', title: 'm', createdAt: at(0) });
    repo.seed({ userId: 'u1', type: 'TASK_COMMENT', title: 'c', createdAt: at(1) });
    await svc.markAllRead('u1', undefined, undefined, ['mentions']);
    expect((await svc.listPage('u1', undefined, { unread: true })).data.map((n) => n.title)).toEqual(['c']);
    await svc.markAllRead('u1');
    expect(await svc.unreadCount('u1')).toBe(0);
  });
});

describe('Mark unread and Remove (own notifications only)', () => {
  it('marks a read one unread again', async () => {
    const n = repo.seed({ userId: 'u1', type: 'MENTION', title: 'm', createdAt: at(0), readAt: at(1) });
    expect((await svc.markUnread(n.id, 'u1')).readAt).toBeNull();
    expect(await svc.unreadCount('u1')).toBe(1);
  });

  it('removes one: gone from the list and the counts', async () => {
    const n = repo.seed({ userId: 'u1', type: 'MENTION', title: 'm', createdAt: at(0) });
    await svc.remove(n.id, 'u1');
    expect((await svc.listPage('u1')).data).toEqual([]);
    expect(await svc.unreadCount('u1')).toBe(0);
  });

  it('someone else’s, or one that isn’t there: not found, and left alone', async () => {
    const theirs = repo.seed({ userId: 'u2', type: 'MENTION', title: 'theirs', createdAt: at(0), readAt: at(1) });
    await expect(svc.markUnread(theirs.id, 'u1')).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.remove(theirs.id, 'u1')).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.remove('missing', 'u1')).rejects.toBeInstanceOf(NotFoundError);
    expect((await svc.listPage('u2')).data[0]).toMatchObject({ title: 'theirs', readAt: at(1) });
  });
});

describe('several at once (read, unread, remove)', () => {
  it('acts on the caller’s ones among the ids and says how many; someone else’s are skipped', async () => {
    const mine = [0, 1, 2].map((i) => repo.seed({ userId: 'u1', type: 'MENTION', title: `m${i}`, createdAt: at(i) }));
    const theirs = repo.seed({ userId: 'u2', type: 'MENTION', title: 'theirs', createdAt: at(9) });
    const ids = [...mine.map((n) => n.id), theirs.id];

    expect(await svc.bulk('u1', ids, 'read')).toEqual({ count: 3 });
    expect(await svc.unreadCount('u1')).toBe(0);
    expect(await svc.unreadCount('u2')).toBe(1);

    expect(await svc.bulk('u1', [mine[0]!.id, mine[1]!.id], 'unread')).toEqual({ count: 2 });
    expect(await svc.unreadCount('u1')).toBe(2);

    expect(await svc.bulk('u1', ids, 'remove')).toEqual({ count: 3 });
    expect((await svc.listPage('u1')).data).toEqual([]);
    expect((await svc.listPage('u2')).data).toHaveLength(1);
  });

  it('read keeps the time an already-read one was read; ids twice count once', async () => {
    const read = repo.seed({ userId: 'u1', type: 'MENTION', title: 'r', createdAt: at(0), readAt: at(1) });
    const fresh = repo.seed({ userId: 'u1', type: 'MENTION', title: 'f', createdAt: at(2) });
    expect(await svc.bulk('u1', [read.id, fresh.id, fresh.id], 'read')).toEqual({ count: 1 });
    expect((await repo.findById(read.id))!.readAt).toEqual(at(1));
  });

  it('at most 200 at a time; none is nothing to do', async () => {
    await expect(svc.bulk('u1', Array.from({ length: 201 }, (_, i) => `id${i}`), 'read')).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.bulk('u1', [], 'remove')).rejects.toBeInstanceOf(ValidationError);
    expect(await svc.bulk('u1', Array.from({ length: 200 }, (_, i) => `id${i}`), 'read')).toEqual({ count: 0 });
  });
});
