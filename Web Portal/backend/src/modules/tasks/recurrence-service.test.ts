import { describe, it, expect } from 'vitest';
import { createRecurrenceService, type RecurringTask, type RecurrenceTaskPort } from './recurrence-service';

function port(instanceCount = 1) {
  const spawned: { sourceTaskId: string; nextDueDate: Date }[] = [];
  const p: RecurrenceTaskPort = {
    async spawnNext(sourceTaskId, nextDueDate) {
      spawned.push({ sourceTaskId, nextDueDate });
      return { id: `new-${spawned.length}` };
    },
    async countInstances() {
      return instanceCount;
    },
  };
  return { p, spawned };
}

const utc = (s: string) => new Date(`${s}T09:00:00.000Z`);

describe('RecurrenceService.onTaskCompleted', () => {
  it('spawns the next instance for a recurring task, dated by the rule', async () => {
    const { p, spawned } = port();
    const svc = createRecurrenceService({ tasks: p });
    const task: RecurringTask = { id: 't1', dueDate: utc('2026-01-01'), recurrenceRule: { freq: 'DAILY', interval: 7 }, recurrenceParentId: null };
    const result = await svc.onTaskCompleted(task);
    expect(result).toEqual({ id: 'new-1' });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.nextDueDate.toISOString()).toBe(utc('2026-01-08').toISOString());
  });

  it('does nothing for a non-recurring task', async () => {
    const { p, spawned } = port();
    const svc = createRecurrenceService({ tasks: p });
    const result = await svc.onTaskCompleted({ id: 't1', dueDate: utc('2026-01-01'), recurrenceRule: null, recurrenceParentId: null });
    expect(result).toBeNull();
    expect(spawned).toHaveLength(0);
  });

  it('ignores an invalid rule', async () => {
    const { p, spawned } = port();
    const svc = createRecurrenceService({ tasks: p });
    const result = await svc.onTaskCompleted({ id: 't1', dueDate: utc('2026-01-01'), recurrenceRule: { freq: 'DAILY', interval: 0 }, recurrenceParentId: null });
    expect(result).toBeNull();
    expect(spawned).toHaveLength(0);
  });

  it('does not spawn while the series is paused', async () => {
    const { p, spawned } = port();
    const svc = createRecurrenceService({ tasks: p });
    const task: RecurringTask = { id: 't1', dueDate: utc('2026-01-01'), recurrenceRule: { freq: 'DAILY', interval: 1, paused: true }, recurrenceParentId: null };
    expect(await svc.onTaskCompleted(task)).toBeNull();
    expect(spawned).toHaveLength(0);
  });

  it('spawns a QUARTERLY series at the next quarter', async () => {
    const { p, spawned } = port();
    const svc = createRecurrenceService({ tasks: p });
    const task: RecurringTask = { id: 't1', dueDate: utc('2026-01-15'), recurrenceRule: { freq: 'QUARTERLY', interval: 1 }, recurrenceParentId: null };
    expect(await svc.onTaskCompleted(task)).toEqual({ id: 'new-1' });
    expect(spawned[0]!.nextDueDate.toISOString()).toBe(utc('2026-04-15').toISOString());
  });

  it('stops once the series reaches its `count`', async () => {
    const { p, spawned } = port(3); // already 3 instances exist
    const svc = createRecurrenceService({ tasks: p });
    const task: RecurringTask = { id: 't3', dueDate: utc('2026-01-03'), recurrenceRule: { freq: 'DAILY', interval: 1, count: 3 }, recurrenceParentId: 't1' };
    const result = await svc.onTaskCompleted(task);
    expect(result).toBeNull();
    expect(spawned).toHaveLength(0);
  });

  it('stops when the next occurrence would be past `until`', async () => {
    const { p, spawned } = port();
    const svc = createRecurrenceService({ tasks: p });
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

  it('falls back to now() when the task has no due date', async () => {
    const { p, spawned } = port();
    const svc = createRecurrenceService({ tasks: p });
    const before = Date.now();
    const result = await svc.onTaskCompleted({ id: 't1', dueDate: null, recurrenceRule: { freq: 'DAILY', interval: 1 }, recurrenceParentId: null });
    expect(result).not.toBeNull();
    // next = now + 1 day, so comfortably in the future
    expect(spawned[0]!.nextDueDate.getTime()).toBeGreaterThan(before);
  });
});
