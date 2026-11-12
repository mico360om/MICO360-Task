import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  blocksForWorkload,
  calendarTaskFacts,
  createPrismaCalendarStore,
  createPrismaReminderClaims,
  createPrismaReminderSweepStore,
  teamProjectIds,
} from '../../src/modules/calendar/prisma-calendar-store';
import { createReminderSweep } from '../../src/modules/calendar/reminder-sweep';
import { createCalendarExtras } from '../../src/modules/calendar/calendar-extras';
import { withWorkBlocks } from '../../src/modules/calendar/busy-blocks';
import { createPrismaMeetingRepository } from '../../src/modules/meetings/prisma-meeting-repository';
import { createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';
import { runBackfill } from './company-helpers';

// Calendar scheduling on a real database (TEST_DATABASE_URL, migrations applied): work blocks and personal
// reminders through the Prisma stores, the reminder sweep (once across two "servers", in step with a moved
// due date), the calendar's reads, Workload's and free times' reads, the Team view's projects, and that a
// task erased for good takes its blocks and reminders with it.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const store = createPrismaCalendarStore(prisma);
const sweepStore = createPrismaReminderSweepStore(prisma);
const claims = createPrismaReminderClaims(prisma);
const TZ = 'Asia/Muscat';
const at = (iso: string) => new Date(iso);
const day = (k: string) => new Date(`${k}T00:00:00.000Z`);

const ids: Record<string, string> = {};
async function cleanup() {
  const projects = await prisma.project.findMany({ where: { code: { in: ['CLS', 'CLX'] } }, select: { id: true } });
  const pids = projects.map((p) => p.id);
  await prisma.task.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.project.deleteMany({ where: { id: { in: pids } } });
  await prisma.reminderLog.deleteMany({ where: { dedupeKey: { startsWith: 'pr:' } } });
  await prisma.calendarPreference.deleteMany({ where: { userId: { in: [ids.boss ?? '-', ids.ali ?? '-'] } } });
  await prisma.user.deleteMany({ where: { email: { in: ['cls-boss@mico360.test', 'cls-ali@mico360.test', 'cls-mona@mico360.test'] } } });
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await cleanup();
  const user = (email: string, firstName: string) => prisma.user.create({ data: { email, username: email.split('@')[0]!, passwordHash: 'x', firstName, lastName: 'Test' } });
  ids.boss = (await user('cls-boss@mico360.test', 'Bader')).id;
  ids.ali = (await user('cls-ali@mico360.test', 'Ali')).id;
  ids.mona = (await user('cls-mona@mico360.test', 'Mona')).id;
  const project = await prisma.project.create({ data: { code: 'CLS', name: 'Calendar', createdById: ids.boss, ownerId: ids.boss, managerId: ids.boss, members: { create: [{ userId: ids.ali }, { userId: ids.mona }] } } });
  const other = await prisma.project.create({ data: { code: 'CLX', name: 'Other', createdById: ids.mona, ownerId: ids.mona, members: { create: [{ userId: ids.ali }] } } });
  ids.project = project.id;
  ids.other = other.id;
  await runBackfill(prisma);
  ids.todo = (await prisma.kanbanColumn.create({ data: { projectId: project.id, name: 'To do', category: 'TODO', position: 0 } })).id;
  ids.otherTodo = (await prisma.kanbanColumn.create({ data: { projectId: other.id, name: 'To do', category: 'TODO', position: 0 } })).id;
  const t1 = await prisma.task.create({
    data: { key: 'CLS-1', title: 'Pour the slab', projectId: project.id, columnId: ids.todo, createdById: ids.boss, startDate: day('2026-11-15'), dueDate: day('2026-11-20'), assignees: { create: [{ userId: ids.ali }, { userId: ids.mona }] } },
  });
  const t2 = await prisma.task.create({ data: { key: 'CLX-1', title: 'Other work', projectId: other.id, columnId: ids.otherTodo, createdById: ids.mona, dueDate: day('2026-11-20'), assignees: { create: [{ userId: ids.ali }] } } });
  ids.t1 = t1.id;
  ids.t2 = t2.id;
});

describe('work blocks and reminders in the database', () => {
  it('reads a task’s facts with its assignees; a deleted task is gone', async () => {
    const f = await calendarTaskFacts(prisma, ids.t1!);
    expect(f).toMatchObject({ key: 'CLS-1', projectId: ids.project, createdById: ids.boss });
    expect(f!.assigneeIds.sort()).toEqual([ids.ali, ids.mona].sort());
    await prisma.task.update({ where: { id: ids.t1 }, data: { deletedAt: new Date() } });
    expect(await calendarTaskFacts(prisma, ids.t1!)).toBeNull();
  });

  it('adds, moves, lists and removes blocks; the calendar reads a person’s, Workload and free times read open tasks’', async () => {
    const b = await store.addBlock({ taskId: ids.t1!, userId: ids.ali!, plannedById: ids.boss!, startAt: at('2026-11-15T05:00:00Z'), endAt: at('2026-11-15T06:00:00Z') });
    await store.addBlock({ taskId: ids.t2!, userId: ids.ali!, plannedById: ids.ali!, startAt: at('2026-11-16T05:00:00Z'), endAt: at('2026-11-16T06:00:00Z') });
    await store.addBlock({ taskId: ids.t1!, userId: ids.mona!, plannedById: ids.mona!, startAt: at('2026-11-15T07:00:00Z'), endAt: at('2026-11-15T08:00:00Z') });
    expect(await store.countBlocks(ids.t1!, ids.ali!)).toBe(1);
    const moved = await store.updateBlock(b.id, { startAt: at('2026-11-15T09:00:00Z'), endAt: at('2026-11-15T10:30:00Z') });
    expect(moved.endAt).toEqual(at('2026-11-15T10:30:00Z'));
    const window = { from: at('2026-11-14T00:00:00Z'), to: at('2026-11-18T00:00:00Z') };
    expect((await store.blocksBetween({ ...window, userId: ids.ali })).map((x) => x.task.key)).toEqual(['CLS-1', 'CLX-1']);
    expect((await store.blocksBetween({ ...window, projectIds: [ids.project!] })).map((x) => x.userId).sort()).toEqual([ids.ali, ids.mona].sort());
    expect(await blocksForWorkload(prisma, { userIds: [ids.ali!], projectIds: [ids.project!], ...window })).toHaveLength(1);
    // Free times: Ali's two blocks are busy, as "wb:" rows.
    const busy = withWorkBlocks(createPrismaMeetingRepository(prisma), (userIds, from, to) => blocksForWorkload(prisma, { userIds, from, to, projectIds: null }));
    expect((await busy.busyBetween([ids.ali!], window.from, window.to)).filter((r) => r.meetingId.startsWith('wb:'))).toHaveLength(2);
    // A done task's blocks are not busy any more, nor counted in Workload.
    await prisma.task.update({ where: { id: ids.t2 }, data: { completedAt: new Date() } });
    expect((await busy.busyBetween([ids.ali!], window.from, window.to)).filter((r) => r.meetingId.startsWith('wb:'))).toHaveLength(1);
    await store.removeBlock(b.id);
    expect(await store.blocksOfTask(ids.t1!)).toHaveLength(1);
  });

  it('the Team view: the projects a person runs; an administrator’s list as it is', async () => {
    expect(await teamProjectIds(prisma, { id: ids.boss!, roles: ['EMPLOYEE'] }, null)).toEqual([ids.project]);
    expect(await teamProjectIds(prisma, { id: ids.ali!, roles: ['EMPLOYEE'] }, null)).toEqual([]);
    expect(await teamProjectIds(prisma, { id: ids.ali!, roles: ['ADMIN'] }, [ids.other!])).toEqual([ids.other]);
  });

  it('the calendar reads a person’s reminders (set times in range, and every one before a start or due of an open task)', async () => {
    await store.addReminder({ taskId: ids.t1!, userId: ids.ali!, setById: ids.ali!, at: null, anchor: 'due', offsetMinutes: 1440, nextAt: at('2026-11-19T04:00:00Z') });
    await store.addReminder({ taskId: ids.t2!, userId: ids.ali!, setById: ids.mona!, at: at('2026-11-16T06:00:00Z'), anchor: null, offsetMinutes: null, nextAt: at('2026-11-16T06:00:00Z') });
    await store.addReminder({ taskId: ids.t2!, userId: ids.ali!, setById: ids.ali!, at: at('2026-12-16T06:00:00Z'), anchor: null, offsetMinutes: null, nextAt: at('2026-12-16T06:00:00Z') });
    const rows = await store.remindersForCalendar({ userId: ids.ali!, from: at('2026-11-14T00:00:00Z'), to: at('2026-11-23T00:00:00Z') });
    expect(rows.map((r) => r.task.key).sort()).toEqual(['CLS-1', 'CLX-1']);
    expect((await store.remindersOfTask(ids.t2!, ids.mona!)).map((r) => r.setById)).toEqual([ids.mona]);
    const extras = createCalendarExtras({ store, names: async (u) => new Map(u.map((x) => [x, x])), clock: async () => ({ timeZone: TZ, dayStart: '08:00' }), teamProjects: async () => [], now: () => at('2026-11-12T06:00:00Z') });
    const out = await extras({ viewer: { id: ids.ali!, roles: ['EMPLOYEE'] }, from: '2026-11-15', to: '2026-11-21', own: null, list: null, team: false });
    expect(out.reminders.map((r) => r.fireAt)).toEqual(['2026-11-16T06:00:00.000Z', '2026-11-19T04:00:00.000Z']);
  });

  it('the sweep sends a reminder once across two servers, and again only when its time moves with the due date', async () => {
    const r = await store.addReminder({ taskId: ids.t1!, userId: ids.ali!, setById: ids.boss!, at: null, anchor: 'due', offsetMinutes: 0, nextAt: at('2026-11-20T04:00:00Z') });
    const sent: { userId: string; title: string; body: string | null }[] = [];
    const sweepAt = (now: Date) =>
      createReminderSweep({
        store: sweepStore,
        keys: claims,
        notify: async (n) => { sent.push(n); },
        canView: async () => true,
        names: async (u) => new Map(u.map((x) => [x, x === ids.boss ? 'Bader Test' : x])),
        clock: async () => ({ timeZone: TZ, dayStart: '08:00' }),
        now: () => now,
      });
    await Promise.all([sweepAt(at('2026-11-20T04:00:30Z')).run(), sweepAt(at('2026-11-20T04:00:30Z')).run()]);
    expect(sent).toEqual([{ userId: ids.ali, type: 'TASK_REMINDER', title: 'Reminder: CLS-1 Pour the slab', body: 'Due Fri 20 Nov. Set by Bader Test.', entityType: 'task', entityId: ids.t1 }]);
    expect((await store.reminder(r.id))!.sentFor).toEqual(at('2026-11-20T04:00:00Z'));
    // The due date moves a week: a fresh sweep (first run reads every one) moves the reminder, then sends it then.
    await createPrismaTaskRepository(prisma).update(ids.t1!, { dueDate: day('2026-11-27') });
    await sweepAt(at('2026-11-21T04:00:00Z')).run();
    expect((await store.reminder(r.id))!.nextAt).toEqual(at('2026-11-27T04:00:00Z'));
    await sweepAt(at('2026-11-27T04:01:00Z')).run();
    expect(sent).toHaveLength(2);
  });

  it('a person’s Calendar choices are stored as given', async () => {
    expect(await store.prefs(ids.ali!)).toBeNull();
    await store.savePrefs(ids.ali!, { layout: 'full' });
    await store.savePrefs(ids.ali!, { layout: 'split', team: true });
    expect(await store.prefs(ids.ali!)).toEqual({ layout: 'split', team: true });
  });

  it('a task erased for good takes its blocks and reminders with it (kept while it is only deleted)', async () => {
    await store.addBlock({ taskId: ids.t1!, userId: ids.ali!, plannedById: ids.ali!, startAt: at('2026-11-15T05:00:00Z'), endAt: at('2026-11-15T06:00:00Z') });
    await store.addReminder({ taskId: ids.t1!, userId: ids.ali!, setById: ids.ali!, at: at('2026-11-16T06:00:00Z'), anchor: null, offsetMinutes: null, nextAt: at('2026-11-16T06:00:00Z') });
    await prisma.task.update({ where: { id: ids.t1 }, data: { deletedAt: new Date() } });
    expect(await prisma.taskWorkBlock.count({ where: { taskId: ids.t1 } })).toBe(1);
    expect(await prisma.taskReminder.count({ where: { taskId: ids.t1 } })).toBe(1);
    await prisma.task.delete({ where: { id: ids.t1 } });
    expect(await prisma.taskWorkBlock.count({ where: { taskId: ids.t1 } })).toBe(0);
    expect(await prisma.taskReminder.count({ where: { taskId: ids.t1 } })).toBe(0);
  });
});
