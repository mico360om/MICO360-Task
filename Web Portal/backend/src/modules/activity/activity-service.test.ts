import { describe, it, expect } from 'vitest';
import { createActivityService } from './activity-service';
import { actingVia } from '../../lib/acting-via';
import type { ActivityRecord, ActivityRepository } from './activity-repository';

function inMemory(): ActivityRepository {
  const rows: ActivityRecord[] = [];
  let seq = 0;
  return {
    async create(data) {
      const a: ActivityRecord = {
        id: `a${seq++}`,
        taskId: data.taskId ?? null,
        projectId: data.projectId ?? null,
        userId: data.userId,
        action: data.action,
        meta: data.meta ?? null,
        createdAt: new Date(),
      };
      rows.push(a);
      return a;
    },
    async listForTask(taskId) {
      return rows.filter((a) => a.taskId === taskId).reverse();
    },
    async listRecent(limit) {
      return rows.slice().reverse().slice(0, limit ?? 50);
    },
    async timesBetween(from, to) {
      return rows.filter((a) => a.createdAt >= from && a.createdAt < to).map((a) => a.createdAt);
    },
    async listBetween(from, to, _scope, page) {
      const day = rows.filter((a) => a.createdAt >= from && a.createdAt < to).reverse();
      const start = page.before ? day.findIndex((a) => a.id === page.before) + 1 : 0;
      return day.slice(start, start + page.limit);
    },
  };
}

describe('ActivityService', () => {
  it('records and lists task activity (newest first)', async () => {
    const svc = createActivityService({ activities: inMemory() });
    await svc.record({ taskId: 't1', userId: 'u1', action: 'TASK_CREATED' });
    await svc.record({ taskId: 't1', userId: 'u1', action: 'STATUS_CHANGED', meta: { from: 'TODO', to: 'DONE' } });
    const list = await svc.listForTask('t1');
    expect(list).toHaveLength(2);
    expect(list[0]!.action).toBe('STATUS_CHANGED');
  });

  it('does not return other tasks’ activity', async () => {
    const svc = createActivityService({ activities: inMemory() });
    await svc.record({ taskId: 't2', userId: 'u1', action: 'X' });
    expect(await svc.listForTask('t1')).toHaveLength(0);
  });

  it('a line written while MICO AI carries out a confirmed change is marked via MICO AI (and nothing else is)', async () => {
    const svc = createActivityService({ activities: inMemory() });
    await actingVia('mico-ai', async () => {
      await svc.record({ taskId: 't1', userId: 'u1', action: 'UPDATED', meta: { changes: [{ field: 'priority', from: 'NORMAL', to: 'HIGH' }] } });
      await svc.record({ taskId: 't1', userId: 'u1', action: 'CREATED' });
    });
    await svc.record({ taskId: 't1', userId: 'u1', action: 'COMMENTED', meta: { commentId: 'c1' } });
    const [comment, created, updated] = await svc.listForTask('t1');
    expect(updated!.meta).toEqual({ changes: [{ field: 'priority', from: 'NORMAL', to: 'HIGH' }], via: 'mico-ai' });
    expect(created!.meta).toEqual({ via: 'mico-ai' });
    expect(comment!.meta).toEqual({ commentId: 'c1' });
  });

  it('counts a run of days per day of the site’s zone, and pages one day 100 at a time (1.22)', async () => {
    const repo = inMemory();
    const svc = createActivityService({ activities: repo });
    // 101 changes recorded "now"; the calendar asks about today in UTC.
    for (let i = 0; i < 101; i++) await svc.record({ taskId: 't1', projectId: 'p1', userId: 'u1', action: 'MOVED' });
    const today = new Date().toISOString().slice(0, 10);
    expect(await svc.countByDay(today, today, 'UTC', { projectIds: null })).toEqual([{ day: today, count: 101 }]);
    const first = await svc.listDay(today, 'UTC', { projectIds: null });
    expect(first.rows).toHaveLength(100);
    expect(first.next).toBe(first.rows[99]!.id);
    const second = await svc.listDay(today, 'UTC', { projectIds: null }, first.next);
    expect(second.rows.map((r) => r.id)).toEqual(['a0']);
    expect(second.next).toBeNull();
  });
});
