import { describe, it, expect } from 'vitest';
import { createRecurrenceService, type RecurringTask, type RecurrenceTaskPort } from './recurrence-service';
import type { RecurrenceRule } from './recurrence';

function port(instanceCount = 1, heads: RecurringTask[] = []) {
  const spawned: { sourceTaskId: string; nextDueDate: Date; rule: RecurrenceRule }[] = [];
  /** Source tasks that already have their next copy (the port's unique successor guard). */
  const alreadySpawned = new Set<string>();
  const p: RecurrenceTaskPort = {
    async spawnNext(sourceTaskId, nextDueDate, rule) {
      if (alreadySpawned.has(sourceTaskId)) return null;
      alreadySpawned.add(sourceTaskId);
      spawned.push({ sourceTaskId, nextDueDate, rule });
      return { id: `new-${spawned.length}`, projectId: 'p1' };
    },
    async countInstances() {
      return instanceCount;
    },
    async listSeriesHeads() {
      return heads;
    },
  };
  return { p, spawned, alreadySpawned };
}

const utc = (s: string) => new Date(`${s}T09:00:00.000Z`);
const midnight = (s: string) => new Date(`${s}T00:00:00.000Z`);
/** The service with a fixed clock ("today" is 1 Jan 2026 unless given). */
const make = (p: RecurrenceTaskPort, now = utc('2026-01-01'), timeZone = 'UTC') =>
  createRecurrenceService({ tasks: p, now: () => now, timeZone });

describe('RecurrenceService.onTaskCompleted', () => {
  it('spawns the next instance for a recurring task, dated by the rule', async () => {
    const { p, spawned } = port();
    const svc = make(p);
    const task: RecurringTask = { id: 't1', dueDate: utc('2026-01-01'), recurrenceRule: { freq: 'DAILY', interval: 7 }, recurrenceParentId: null };
    const result = await svc.onTaskCompleted(task);
    expect(result).toEqual({ id: 'new-1', projectId: 'p1' });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.nextDueDate.toISOString()).toBe(utc('2026-01-08').toISOString());
  });

  it('does nothing for a non-recurring task', async () => {
    const { p, spawned } = port();
    const svc = make(p);
    const result = await svc.onTaskCompleted({ id: 't1', dueDate: utc('2026-01-01'), recurrenceRule: null, recurrenceParentId: null });
    expect(result).toBeNull();
    expect(spawned).toHaveLength(0);
  });

  it('ignores an invalid rule', async () => {
    const { p, spawned } = port();
    const svc = make(p);
    const result = await svc.onTaskCompleted({ id: 't1', dueDate: utc('2026-01-01'), recurrenceRule: { freq: 'DAILY', interval: 0 }, recurrenceParentId: null });
    expect(result).toBeNull();
    expect(spawned).toHaveLength(0);
  });

  it('does not spawn while the series is paused', async () => {
    const { p, spawned } = port();
    const svc = make(p);
    const task: RecurringTask = { id: 't1', dueDate: utc('2026-01-01'), recurrenceRule: { freq: 'DAILY', interval: 1, paused: true }, recurrenceParentId: null };
    expect(await svc.onTaskCompleted(task)).toBeNull();
    expect(spawned).toHaveLength(0);
  });

  it('spawns a QUARTERLY series at the next quarter', async () => {
    const { p, spawned } = port();
    const svc = make(p);
    const task: RecurringTask = { id: 't1', dueDate: utc('2026-01-15'), recurrenceRule: { freq: 'QUARTERLY', interval: 1 }, recurrenceParentId: null };
    expect(await svc.onTaskCompleted(task)).toEqual({ id: 'new-1', projectId: 'p1' });
    expect(spawned[0]!.nextDueDate.toISOString()).toBe(utc('2026-04-15').toISOString());
  });

  it('stops once the series reaches its `count`', async () => {
    const { p, spawned } = port(3); // already 3 instances exist
    const svc = make(p);
    const task: RecurringTask = { id: 't3', dueDate: utc('2026-01-03'), recurrenceRule: { freq: 'DAILY', interval: 1, count: 3 }, recurrenceParentId: 't1' };
    const result = await svc.onTaskCompleted(task);
    expect(result).toBeNull();
    expect(spawned).toHaveLength(0);
  });

  it('stops when the next occurrence would be past `until`', async () => {
    const { p, spawned } = port();
    const svc = make(p);
    const task: RecurringTask = {
      id: 't1',
      dueDate: utc('2026-01-01'),
      recurrenceRule: { freq: 'DAILY', interval: 1, until: '2026-01-01T09:00:00.000Z' },
      recurrenceParentId: null,
    };
    const result = await svc.onTaskCompleted(task);
    expect(result).toBeNull();
    expect(spawned).toHaveLength(0);
  });

  it('carries the anchor day forward so a month-end series returns to the 31st', async () => {
    const { p, spawned } = port();
    const svc = make(p);
    // First completion: due 31 Jan, rule has no day yet → anchored to 31, next is 28 Feb.
    await svc.onTaskCompleted({ id: 't1', dueDate: midnight('2026-01-31'), recurrenceRule: { freq: 'MONTHLY', interval: 1 }, recurrenceParentId: null });
    expect(spawned[0]!.nextDueDate.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(spawned[0]!.rule).toEqual({ freq: 'MONTHLY', interval: 1, anchorDay: 31 });
    // The February occurrence carries that rule → March goes back to the 31st.
    await svc.onTaskCompleted({ id: 'new-1', dueDate: midnight('2026-02-28'), recurrenceRule: spawned[0]!.rule, recurrenceParentId: 't1' });
    expect(spawned[1]!.nextDueDate.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('counts from today (a calendar day) when the task has no due date', async () => {
    const { p, spawned } = port();
    const svc = make(p);
    const result = await svc.onTaskCompleted({ id: 't1', dueDate: null, recurrenceRule: { freq: 'DAILY', interval: 1 }, recurrenceParentId: null });
    expect(result).not.toBeNull();
    expect(spawned[0]!.nextDueDate.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('skips dates that are already past: an overdue daily task completed today makes today’s copy', async () => {
    const { p, spawned } = port();
    const svc = make(p, new Date('2026-10-01T06:00:00Z'), 'Asia/Muscat');
    await svc.onTaskCompleted({ id: 't1', dueDate: midnight('2026-09-25'), recurrenceRule: { freq: 'DAILY', interval: 1 }, recurrenceParentId: null });
    expect(spawned[0]!.nextDueDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('uses the company’s calendar day for "today"', async () => {
    const { p, spawned } = port();
    // 21:00 UTC on 30 Sep is already 01:00 on 1 Oct in Muscat.
    const svc = make(p, new Date('2026-09-30T21:00:00Z'), 'Asia/Muscat');
    await svc.onTaskCompleted({ id: 't1', dueDate: midnight('2026-09-29'), recurrenceRule: { freq: 'DAILY', interval: 1 }, recurrenceParentId: null });
    expect(spawned[0]!.nextDueDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('leaves an on-schedule series to the schedule (no copy on completion)', async () => {
    const { p, spawned } = port();
    const svc = make(p);
    const rule: RecurrenceRule = { freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' };
    expect(await svc.onTaskCompleted({ id: 't1', dueDate: utc('2026-01-01'), recurrenceRule: rule, recurrenceParentId: null })).toBeNull();
    expect(spawned).toHaveLength(0);
  });

  it('never makes a second copy of the same task (completed twice, or from two apps at once)', async () => {
    const { p, spawned } = port();
    const svc = make(p);
    const task: RecurringTask = { id: 't1', dueDate: utc('2026-01-01'), recurrenceRule: { freq: 'DAILY', interval: 1 }, recurrenceParentId: null };
    const [a, b] = await Promise.all([svc.onTaskCompleted(task), svc.onTaskCompleted(task)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(spawned).toHaveLength(1);
  });
});

describe('RecurrenceService.onTaskSkipped (deleting just this occurrence)', () => {
  it('makes the next copy so the series carries on', async () => {
    const { p, spawned } = port();
    const svc = make(p);
    const res = await svc.onTaskSkipped({ id: 't1', dueDate: utc('2026-01-05'), recurrenceRule: { freq: 'WEEKLY', interval: 1 }, recurrenceParentId: null });
    expect(res).toEqual({ id: 'new-1', projectId: 'p1' });
    expect(spawned[0]).toMatchObject({ sourceTaskId: 't1' });
    expect(spawned[0]!.nextDueDate.toISOString()).toBe(utc('2026-01-12').toISOString());
  });

  it('does the same for an on-schedule series', async () => {
    const { p, spawned } = port();
    const svc = make(p);
    await svc.onTaskSkipped({ id: 't1', dueDate: utc('2026-01-05'), recurrenceRule: { freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' }, recurrenceParentId: null });
    expect(spawned[0]!.nextDueDate.toISOString()).toBe(utc('2026-01-06').toISOString());
  });

  it('does nothing for a paused series, a task without a rule, or an ended series', async () => {
    const { p, spawned } = port();
    const svc = make(p);
    await svc.onTaskSkipped({ id: 't1', dueDate: utc('2026-01-05'), recurrenceRule: { freq: 'DAILY', interval: 1, paused: true }, recurrenceParentId: null });
    await svc.onTaskSkipped({ id: 't2', dueDate: utc('2026-01-05'), recurrenceRule: null, recurrenceParentId: 't0' });
    await svc.onTaskSkipped({ id: 't3', dueDate: utc('2026-01-05'), recurrenceRule: { freq: 'DAILY', interval: 1, until: '2026-01-05' }, recurrenceParentId: null });
    expect(spawned).toHaveLength(0);
  });
});

describe('RecurrenceService.runSchedule (on-schedule series)', () => {
  const today = new Date('2026-10-01T06:00:00Z');
  const onSchedule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE', ...over });

  it('makes today’s copy for each series whose next date has arrived', async () => {
    const heads: RecurringTask[] = [
      { id: 'daily', dueDate: midnight('2026-09-30'), recurrenceRule: onSchedule(), recurrenceParentId: null },
      { id: 'weekly', dueDate: midnight('2026-09-28'), recurrenceRule: onSchedule({ freq: 'WEEKLY' }), recurrenceParentId: 'w0' },
    ];
    const { p, spawned } = port(1, heads);
    const made = await make(p, today, 'Asia/Muscat').runSchedule();
    expect(made).toEqual([{ id: 'new-1', projectId: 'p1' }]);
    expect(spawned).toEqual([{ sourceTaskId: 'daily', nextDueDate: midnight('2026-10-01'), rule: onSchedule() }]);
  });

  it('after missed days makes a single copy, for the latest date', async () => {
    const { p, spawned } = port(1, [{ id: 'd', dueDate: midnight('2026-09-20'), recurrenceRule: onSchedule(), recurrenceParentId: null }]);
    await make(p, today, 'Asia/Muscat').runSchedule();
    expect(spawned.map((s) => s.nextDueDate.toISOString())).toEqual(['2026-10-01T00:00:00.000Z']);
  });

  it('skips series that make copies on completion, are paused, ended or complete', async () => {
    const heads: RecurringTask[] = [
      { id: 'a', dueDate: midnight('2026-09-20'), recurrenceRule: { freq: 'DAILY', interval: 1 }, recurrenceParentId: null },
      { id: 'b', dueDate: midnight('2026-09-20'), recurrenceRule: onSchedule({ paused: true }), recurrenceParentId: null },
      { id: 'c', dueDate: midnight('2026-09-20'), recurrenceRule: onSchedule({ until: '2026-09-20' }), recurrenceParentId: null },
      { id: 'd', dueDate: midnight('2026-09-20'), recurrenceRule: onSchedule({ count: 1 }), recurrenceParentId: null },
    ];
    const { p, spawned } = port(1, heads);
    expect(await make(p, today, 'Asia/Muscat').runSchedule()).toEqual([]);
    expect(spawned).toHaveLength(0);
  });

  it('is safe to run again: a copy that already exists is not made twice', async () => {
    const heads: RecurringTask[] = [{ id: 'daily', dueDate: midnight('2026-09-30'), recurrenceRule: onSchedule(), recurrenceParentId: null }];
    const { p, spawned } = port(1, heads);
    const svc = make(p, today, 'Asia/Muscat');
    await svc.runSchedule();
    expect(await svc.runSchedule()).toEqual([]);
    expect(spawned).toHaveLength(1);
  });

  it('dates a series with no due date from its start day', async () => {
    const heads: RecurringTask[] = [{ id: 'x', dueDate: null, startDate: new Date('2026-09-29T08:00:00Z'), recurrenceRule: onSchedule({ interval: 2 }), recurrenceParentId: null }];
    const { p, spawned } = port(1, heads);
    await make(p, today, 'Asia/Muscat').runSchedule();
    expect(spawned[0]!.nextDueDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('keeps going when one series fails', async () => {
    const heads: RecurringTask[] = [
      { id: 'boom', dueDate: midnight('2026-09-30'), recurrenceRule: onSchedule(), recurrenceParentId: null },
      { id: 'ok', dueDate: midnight('2026-09-30'), recurrenceRule: onSchedule(), recurrenceParentId: null },
    ];
    const { p, spawned } = port(1, heads);
    const inner = p.spawnNext;
    p.spawnNext = async (id, due, rule) => {
      if (id === 'boom') throw new Error('db down');
      return inner(id, due, rule);
    };
    const failures: string[] = [];
    const svc = createRecurrenceService({ tasks: p, now: () => today, timeZone: 'Asia/Muscat', onError: (_err, taskId) => failures.push(taskId) });
    const made = await svc.runSchedule();
    expect(made).toHaveLength(1);
    expect(spawned[0]!.sourceTaskId).toBe('ok');
    expect(failures).toEqual(['boom']);
  });
});
