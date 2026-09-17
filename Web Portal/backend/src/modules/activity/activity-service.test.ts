import { describe, it, expect } from 'vitest';
import { createActivityService } from './activity-service';
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
});
