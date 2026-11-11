import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaNotificationRepository } from '../../src/modules/notifications/prisma-notification-repository';
import { createNotificationService } from '../../src/modules/notifications/notification-service';

// The Notifications page (1.22) on the database: pages by a cursor (rows of the same moment too), the
// Unread tab and the type chips, the companies scope, counts per type, Mark unread, Remove and the
// same for several at once — the caller's own only; 1.22.3: each task notice's current number. Requires
// TEST_DATABASE_URL with migrations applied. Only this file's people (@ninbox.test), projects (code
// NIB…) and their tasks are made and removed.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaNotificationRepository(prisma);
const svc = createNotificationService({ notifications: repo });
const DOMAIN = '@ninbox.test';
const base = Date.UTC(2026, 10, 3, 6, 0);

let ada: string;
let bo: string;
let rig: string;
let fin: string;

async function clean() {
  const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  // 1.22.3: this file's tasks first (one moves to the other project, keeping its first column).
  await prisma.task.deleteMany({ where: { project: { code: { startsWith: 'NIB' } } } });
  await prisma.project.deleteMany({ where: { code: { startsWith: 'NIB' } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await clean();
  const person = (name: string) => prisma.user.create({ data: { email: `${name}${DOMAIN}`, username: `nib-${name}`, passwordHash: 'x', firstName: name, lastName: 'T' } });
  ada = (await person('ada')).id;
  bo = (await person('bo')).id;
  rig = (await prisma.project.create({ data: { code: 'NIBRIG', name: 'Rig Inspection', color: '#0E7490', icon: 'wrench', createdById: ada } })).id;
  fin = (await prisma.project.create({ data: { code: 'NIBFIN', name: 'Finance', imageUrl: '/uploads/fin.png', createdById: ada } })).id;
});
beforeEach(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: [ada, bo] } } });
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe('pages of 50 by a cursor', () => {
  it('120 rows, three to a second (ties at page breaks): 50 + 50 + 20, each once, newest first', async () => {
    await prisma.notification.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({ userId: ada, type: 'TASK_COMMENT', title: `n${String(i).padStart(3, '0')}`, createdAt: new Date(base + Math.floor(i / 3) * 1000) })),
    });
    const pages = [];
    let cursor: string | undefined;
    do {
      const page = await svc.listPage(ada, undefined, { limit: 50, ...(cursor ? { cursor } : {}) });
      pages.push(page.data);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && pages.length < 5);
    expect(pages.map((p) => p.length)).toEqual([50, 50, 20]);
    const rows = pages.flat();
    expect(new Set(rows.map((n) => n.id)).size).toBe(120);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(rows[i]!.createdAt.getTime());
    expect(rows[0]!.title).toMatch(/^n11[789]$/);
  });

  it('without a limit: the newest 100, as the bell has always had', async () => {
    await prisma.notification.createMany({ data: Array.from({ length: 105 }, (_, i) => ({ userId: ada, type: 'TASK_COMMENT', title: `n${i}`, createdAt: new Date(base + i * 1000) })) });
    const page = await svc.listPage(ada);
    expect(page.data).toHaveLength(100);
    expect(page.data[0]!.title).toBe('n104');
    expect(page.nextCursor).not.toBeNull();
  });
});

describe('Unread, chips, scope and counts', () => {
  beforeEach(async () => {
    const rows: [string, string | null, boolean][] = [
      ['MENTION', rig, false],
      ['CHAT_MENTION', null, false],
      ['TASK_OVERDUE', fin, false],
      ['TASK_ESCALATION', rig, true],
      ['TASK_STATUS', fin, false],
      ['MEETING_REMINDER', null, true],
    ];
    await prisma.notification.createMany({
      data: rows.map(([type, projectId, read], i) => ({ userId: ada, type, title: type, projectId, readAt: read ? new Date(base) : null, createdAt: new Date(base + i * 1000) })),
    });
    await prisma.notification.create({ data: { userId: bo, type: 'MENTION', title: 'bo’s', createdAt: new Date(base) } });
  });

  it('the Unread tab and the chips filter on the server, and combine', async () => {
    const types = async (q: Parameters<typeof svc.listPage>[2]) => (await svc.listPage(ada, undefined, q)).data.map((n) => n.type);
    expect(await types({ unread: true })).toEqual(['TASK_STATUS', 'TASK_OVERDUE', 'CHAT_MENTION', 'MENTION']);
    expect(await types({ kinds: ['mentions'] })).toEqual(['CHAT_MENTION', 'MENTION']);
    expect(await types({ kinds: ['due'] })).toEqual(['TASK_ESCALATION', 'TASK_OVERDUE']);
    expect(await types({ kinds: ['due'], unread: true })).toEqual(['TASK_OVERDUE']);
    expect(await types({ kinds: ['due', 'meetings'] })).toEqual(['MEETING_REMINDER', 'TASK_ESCALATION', 'TASK_OVERDUE']);
  });

  it('the companies scope still applies: a row about a project out of scope is hidden from the page and the counts', async () => {
    const scope = { projectIds: [rig], pick: null };
    expect((await svc.listPage(ada, scope)).data.map((n) => n.type)).toEqual(['MEETING_REMINDER', 'TASK_ESCALATION', 'CHAT_MENTION', 'MENTION']);
    expect(await svc.counts(ada, scope)).toEqual({ unread: 2, kinds: { mentions: 2, assigned: 0, due: 0, comments: 0, approvals: 0, meetings: 0, training: 0 } });
    expect(await svc.counts(ada)).toEqual({ unread: 4, kinds: { mentions: 2, assigned: 0, due: 1, comments: 0, approvals: 0, meetings: 0, training: 0 } });
    expect((await svc.counts(ada)).unread).toBe(await svc.unreadCount(ada));
  });

  it('each row names its project (name, colour, icon, picture); none for a notice about no project', async () => {
    const rows = (await svc.listPage(ada)).data;
    expect(rows.find((n) => n.type === 'MENTION')).toMatchObject({ projectId: rig, project: { id: rig, name: 'Rig Inspection', color: '#0E7490', icon: 'wrench', imageUrl: null } });
    expect(rows.find((n) => n.type === 'TASK_OVERDUE')).toMatchObject({ projectId: fin, project: { id: fin, name: 'Finance', imageUrl: '/uploads/fin.png' } });
    expect(rows.find((n) => n.type === 'CHAT_MENTION')).toMatchObject({ projectId: null, project: null });
  });

  it('the scope, a cursor, the Unread tab and chips in one query (the AND / OR rules together)', async () => {
    await prisma.notification.createMany({
      data: Array.from({ length: 9 }, (_, i) => ({ userId: ada, type: i % 2 ? 'MENTION' : 'TASK_OVERDUE', title: `more${i}`, projectId: [rig, fin, null][i % 3], readAt: i % 4 === 3 ? new Date(base) : null, createdAt: new Date(base + 60_000 + Math.floor(i / 2) * 1000) })),
    });
    const scope = { projectIds: [rig], pick: null };
    const q = { unread: true, kinds: ['mentions', 'due'] as ('mentions' | 'due')[] };
    const want = (await prisma.notification.findMany({
      where: { userId: ada, readAt: null, type: { in: ['MENTION', 'CHAT_MENTION', 'TASK_DUE_SOON', 'TASK_OVERDUE', 'TASK_ESCALATION'] }, OR: [{ projectId: null }, { projectId: rig }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })).map((n) => n.id);
    const got: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await svc.listPage(ada, scope, { ...q, limit: 2, ...(cursor ? { cursor } : {}) });
      got.push(...page.data.map((n) => n.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor && got.length < 50);
    expect(want.length).toBeGreaterThan(4);
    expect(got).toEqual(want);
  });

  it('a notice about a project in the trash names no project', async () => {
    const gone = await prisma.project.create({ data: { code: 'NIBGONE', name: 'Old works', createdById: ada, deletedAt: new Date(base) } });
    await prisma.notification.create({ data: { userId: ada, type: 'TASK_COMMENT', title: 'about the trash', projectId: gone.id, createdAt: new Date(base + 99_000) } });
    expect((await svc.listPage(ada)).data[0]).toMatchObject({ title: 'about the trash', projectId: gone.id, project: null });
  });

  it('Mark all read follows the chips (and the time shown)', async () => {
    await svc.markAllRead(ada, new Date(base + 10_000), undefined, ['mentions']);
    expect((await svc.listPage(ada, undefined, { unread: true })).data.map((n) => n.type)).toEqual(['TASK_STATUS', 'TASK_OVERDUE']);
    expect(await svc.unreadCount(bo)).toBe(1);
  });
});

describe('Mark unread, Remove, several at once — the caller’s own only', () => {
  it('one at a time', async () => {
    const n = await prisma.notification.create({ data: { userId: ada, type: 'MENTION', title: 'm', readAt: new Date(base) } });
    expect((await svc.markUnread(n.id, ada)).readAt).toBeNull();
    await expect(svc.markUnread(n.id, bo)).rejects.toMatchObject({ status: 404 });
    await expect(svc.remove(n.id, bo)).rejects.toMatchObject({ status: 404 });
    await svc.remove(n.id, ada);
    expect(await prisma.notification.findUnique({ where: { id: n.id } })).toBeNull();
  });

  it('several: only ada’s change; read keeps an earlier read time; the counts say how many changed', async () => {
    const earlier = new Date(base);
    const read = await prisma.notification.create({ data: { userId: ada, type: 'MENTION', title: 'r', readAt: earlier } });
    const fresh = await prisma.notification.create({ data: { userId: ada, type: 'MENTION', title: 'f' } });
    const theirs = await prisma.notification.create({ data: { userId: bo, type: 'MENTION', title: 't' } });
    const ids = [read.id, fresh.id, theirs.id];
    expect(await svc.bulk(ada, ids, 'read')).toEqual({ count: 1 });
    expect((await prisma.notification.findUnique({ where: { id: read.id } }))!.readAt).toEqual(earlier);
    expect((await prisma.notification.findUnique({ where: { id: theirs.id } }))!.readAt).toBeNull();
    expect(await svc.bulk(ada, ids, 'unread')).toEqual({ count: 2 });
    expect(await svc.unreadCount(ada)).toBe(2);
    expect(await svc.bulk(ada, ids, 'remove')).toEqual({ count: 2 });
    expect(await prisma.notification.count({ where: { id: { in: ids } } })).toBe(1);
  });
});

describe('1.22.3: each task notice names the task’s current number (taskKey)', () => {
  it('the number the task has now — also after a move; none for a task in the trash or for another notice', async () => {
    const col = await prisma.kanbanColumn.create({ data: { projectId: rig, name: 'To do', category: 'TODO', position: 0 } });
    const live = await prisma.task.create({ data: { key: 'NIBRIG-7', title: 'Pump', projectId: rig, columnId: col.id, createdById: ada } });
    const trashed = await prisma.task.create({ data: { key: 'NIBRIG-8', title: 'Old', projectId: rig, columnId: col.id, createdById: ada, deletedAt: new Date() } });
    await prisma.notification.createMany({
      data: [
        { userId: ada, type: 'TASK_OVERDUE', title: 'A task is overdue', body: 'NIBRIG-7 · Pump', entityType: 'task', entityId: live.id, projectId: rig, createdAt: new Date(base + 3000) },
        { userId: ada, type: 'TASK_COMMENT', title: 'trashed', entityType: 'task', entityId: trashed.id, projectId: rig, createdAt: new Date(base + 2000) },
        { userId: ada, type: 'CHAT_MENTION', title: 'chat', entityType: 'conversation', entityId: live.id, createdAt: new Date(base + 1000) },
      ],
    });
    const rows = (await svc.listPage(ada)).data;
    expect(rows.map((n) => [n.title, n.taskKey])).toEqual([
      ['A task is overdue', 'NIBRIG-7'],
      ['trashed', null],
      ['chat', null],
    ]);
    // Moved to Finance (a new number): the notice shows the new one, its stored words unchanged.
    await prisma.task.update({ where: { id: live.id }, data: { key: 'NIBFIN-1', projectId: fin } });
    const [moved] = (await svc.listPage(ada)).data;
    expect(moved).toMatchObject({ taskKey: 'NIBFIN-1', body: 'NIBRIG-7 · Pump' });
    // …but not to someone who no longer sees the project it is in now.
    const [scoped] = (await svc.listPage(ada, { projectIds: [rig], pick: null })).data;
    expect(scoped).toMatchObject({ title: 'A task is overdue', taskKey: null });
  });
});
