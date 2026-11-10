import { describe, it, expect } from 'vitest';
import { assignedNoticeTitle, createStartDayReminders, planStartDayReminders, startingWindow, type StartingTaskRow } from './start-day-reminders';
import type { ReminderLogStore } from '../notifications/reminder-dispatch';
import type { CreateNotificationData } from '../notifications/notification-repository';

const TZ = 'Asia/Muscat';
// 08:00 on 20 Nov 2026 in Muscat.
const NOW = new Date('2026-11-20T04:00:00Z');
const anchor = (key: string) => new Date(`${key}T12:00:00.000Z`);
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

const row = (o: Partial<StartingTaskRow> = {}): StartingTaskRow => ({
  id: 't1',
  key: 'MICO-7',
  title: 'Pour the slab',
  startDate: day('2026-11-20'),
  boardDate: anchor('2026-11-20'),
  createdAt: new Date('2026-11-10T06:00:00Z'),
  columnCategory: 'TODO',
  completedAt: null,
  approvalRequestedAt: null,
  assigneeIds: ['sara', 'omar'],
  ...o,
});

describe('the start-day reminder (tasks scheduled for the future)', () => {
  it('tells each person on a task that starts today, once, in the bell as an assignment notice', () => {
    const planned = planStartDayReminders([row()], { timeZone: TZ, now: NOW });
    expect(planned).toEqual([
      { userId: 'sara', type: 'TASK_ASSIGNED', title: 'A task starts today', body: 'MICO-7 · Pour the slab', entityType: 'task', entityId: 't1', dedupeId: 'starts:t1' },
      { userId: 'omar', type: 'TASK_ASSIGNED', title: 'A task starts today', body: 'MICO-7 · Pour the slab', entityType: 'task', entityId: 't1', dedupeId: 'starts:t1' },
    ]);
  });

  it('a start given as an instant counts on the company’s day', () => {
    // 21:00 UTC on 19 Nov = 01:00 on 20 Nov in Muscat.
    expect(planStartDayReminders([row({ startDate: new Date('2026-11-19T21:00:00Z') })], { timeZone: TZ, now: NOW })).toHaveLength(2);
  });

  it('nothing for a task that doesn’t start today, was made today, or isn’t waiting to be started any more', () => {
    const none = [
      row({ startDate: day('2026-11-21'), boardDate: anchor('2026-11-21') }), // starts tomorrow (moved: then on the new day)
      row({ startDate: day('2026-11-19') }), // started yesterday
      row({ createdAt: new Date('2026-11-20T03:00:00Z') }), // made this morning: its assignment notice said so
      row({ completedAt: NOW }),
      row({ columnCategory: 'DONE' }),
      row({ columnCategory: 'IN_PROGRESS' }),
      row({ columnCategory: 'BLOCKED' }),
      row({ approvalRequestedAt: NOW }),
      row({ boardDate: anchor('2026-11-24') }), // put on a later day's board: it still waits
      row({ assigneeIds: [] }),
    ];
    expect(planStartDayReminders(none, { timeZone: TZ, now: NOW })).toEqual([]);
  });

  it('a Backlog task counts as not started', () => {
    expect(planStartDayReminders([row({ columnCategory: 'BACKLOG' })], { timeZone: TZ, now: NOW })).toHaveLength(2);
  });

  it('the database window: starts a day either side of today (the plan decides exactly), made before today, not waiting', () => {
    expect(startingWindow(TZ, NOW)).toEqual({
      today: '2026-11-20',
      startFrom: new Date('2026-11-19T00:00:00.000Z'),
      startBefore: new Date('2026-11-22T00:00:00.000Z'),
      createdBefore: new Date('2026-11-19T20:00:00.000Z'), // the start of 20 Nov in Muscat
      boardBefore: new Date('2026-11-21T00:00:00.000Z'),
    });
  });
});

describe('the start-day reminder job', () => {
  function world(rows: StartingTaskRow[], visible: (taskId: string, ids: string[]) => string[] = (_t, ids) => ids) {
    const sent: CreateNotificationData[] = [];
    const keys = new Set<string>();
    const store: ReminderLogStore = { has: async (k) => keys.has(k), add: async (k) => void keys.add(k) };
    let clock = NOW;
    const job = createStartDayReminders({
      source: { startingToday: async () => rows },
      visibleRecipients: async (taskId, ids) => visible(taskId, ids),
      store,
      notify: async (n) => void sent.push(n),
      timeZone: TZ,
      now: () => clock,
    });
    return { job, sent, keys, setClock: (d: Date) => (clock = d) };
  }

  it('waits for the morning (07:00 company time), then sends once however often it runs', async () => {
    const w = world([row()]);
    w.setClock(new Date('2026-11-20T02:00:00Z')); // 06:00 in Muscat
    expect(await w.job.run()).toEqual({ sent: 0 });
    w.setClock(NOW);
    expect(await w.job.run()).toEqual({ sent: 2 });
    expect(await w.job.run()).toEqual({ sent: 0 });
    expect(w.sent.map((n) => n.userId)).toEqual(['sara', 'omar']);
    expect([...w.keys]).toEqual(['TASK_ASSIGNED:starts:t1:sara:2026-11-20', 'TASK_ASSIGNED:starts:t1:omar:2026-11-20']);
  });

  it('only people who may still open the task hear about it', async () => {
    const w = world([row()], (_t, ids) => ids.filter((id) => id !== 'omar'));
    await w.job.run();
    expect(w.sent.map((n) => n.userId)).toEqual(['sara']);
  });

  it('a start moved to another day is reminded on that day (never twice for one day)', async () => {
    const rows = [row({ startDate: day('2026-11-21'), boardDate: anchor('2026-11-21') })];
    const w = world(rows);
    await w.job.run();
    expect(w.sent).toEqual([]);
    w.setClock(new Date('2026-11-21T04:00:00Z'));
    await w.job.run();
    await w.job.run();
    expect(w.sent.map((n) => [n.userId, n.title])).toEqual([['sara', 'A task starts today'], ['omar', 'A task starts today']]);
  });
});

describe('the “assigned to you” notice of a task that waits', () => {
  it('says when it starts', () => {
    expect(assignedNoticeTitle({ boardDate: anchor('2026-11-20') }, TZ, new Date('2026-11-10T06:00:00Z'))).toBe('You were assigned a task — starts 20 Nov');
    expect(assignedNoticeTitle({ boardDate: anchor('2027-01-04') }, TZ, new Date('2026-11-10T06:00:00Z'))).toBe('You were assigned a task — starts 4 Jan 2027');
  });

  it('reads as before for a task of today (or done)', () => {
    expect(assignedNoticeTitle({ boardDate: anchor('2026-11-10') }, TZ, new Date('2026-11-10T06:00:00Z'))).toBe('You were assigned a task');
    expect(assignedNoticeTitle({ boardDate: anchor('2026-11-20'), completedAt: new Date() }, TZ, new Date('2026-11-10T06:00:00Z'))).toBe('You were assigned a task');
    expect(assignedNoticeTitle(null, TZ, new Date('2026-11-10T06:00:00Z'))).toBe('You were assigned a task');
  });
});
