import { describe, it, expect } from 'vitest';
import { collectNotices, combineNotices } from './notice-batch';
import { createNotificationService } from './notification-service';
import type { CreateNotificationData, NotificationRecord, NotificationRepository } from './notification-repository';

// Bulk lane: one combined notice per person per bulk action, for the bell and the phone push alike.

const n = (userId: string, taskId: string, type = 'TASK_ASSIGNED', body = `RIG-${taskId} · Task ${taskId}`): CreateNotificationData => ({
  userId, type, title: 'You were assigned a task', body, entityType: 'task', entityId: taskId,
});
const input = {
  actorName: 'Sara Al Balushi',
  projectName: (id: string) => ({ rig: 'Rig 3', ops: 'Operations' })[id],
  projectOf: (taskId: string) => (taskId.startsWith('o') ? 'ops' : 'rig'),
};

describe('combineNotices', () => {
  it('someone told once gets that notice as it was', () => {
    expect(combineNotices([n('omar', '1')], input)).toEqual([n('omar', '1')]);
  });

  it('someone told about several tasks gets one notice: who, how many, where, the first two named', () => {
    const out = combineNotices([n('omar', '1'), n('omar', '2'), n('omar', '3'), n('nadia', '4')], input);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      userId: 'omar',
      type: 'TASK_ASSIGNED',
      title: 'Sara Al Balushi assigned you 3 tasks in Rig 3',
      body: 'RIG-1 · Task 1; RIG-2 · Task 2 and 1 more',
      entityType: 'project',
      entityId: 'rig',
      projectId: 'rig',
    });
    expect(out[1]).toEqual(n('nadia', '4'));
  });

  it('tasks in several projects: "in 2 projects", nothing single to open; mixed kinds say "changed"', () => {
    const [one] = combineNotices([n('omar', '1', 'TASK_STATUS'), n('omar', 'o2', 'TASK_ASSIGNED'), n('omar', 'o3', 'TASK_STATUS')], input);
    expect(one).toMatchObject({ type: 'TASK_STATUS', title: 'Sara Al Balushi changed 3 tasks in 2 projects', entityType: null, entityId: null, projectId: null });
  });

  it('status changes say so', () => {
    const [one] = combineNotices([n('omar', '1', 'TASK_STATUS'), n('omar', '2', 'TASK_STATUS')], input);
    expect(one!.title).toBe('Sara Al Balushi changed the status of 2 tasks in Rig 3');
  });
});

describe('the notification service gathers notices while a bulk action runs', () => {
  function service() {
    const created: CreateNotificationData[] = [];
    const pushed: string[] = [];
    const repo = {
      async create(d: CreateNotificationData) {
        created.push(d);
        return { id: `n${created.length}`, ...d, readAt: null, createdAt: new Date() } as unknown as NotificationRecord;
      },
    } as unknown as NotificationRepository;
    const svc = createNotificationService({ notifications: repo, push: { async sendToUser(userId) { pushed.push(userId); return 1; } } });
    return { svc, created, pushed };
  }

  it('inside collectNotices nothing is stored or pushed; outside, as before', async () => {
    const { svc, created, pushed } = service();
    const { result, notices } = await collectNotices(async () => {
      await svc.notify(n('omar', '1'));
      await svc.notify(n('omar', '2'));
      return 'done';
    });
    expect(result).toBe('done');
    expect(notices).toHaveLength(2);
    expect(created).toEqual([]);
    expect(pushed).toEqual([]);
    await svc.notify(n('omar', '3'));
    expect(created).toHaveLength(1);
  });
});

describe('a notice sent after the bulk action returned (review M6)', () => {
  it('is not gathered into the closed batch: it goes as usual', async () => {
    let later: (() => Promise<unknown>) | null = null;
    const sent: string[] = [];
    const { notices } = await collectNotices(async () => {
      later = async () => {
        const { activeNoticeBatch } = await import('./notice-batch');
        if (activeNoticeBatch()) return 'gathered';
        sent.push('sent');
        return 'sent';
      };
    });
    expect(notices).toEqual([]);
    expect(await later!()).toBe('sent');
    expect(sent).toEqual(['sent']);
  });
});
