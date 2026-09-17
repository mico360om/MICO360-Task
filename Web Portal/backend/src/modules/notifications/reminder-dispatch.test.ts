import { describe, it, expect } from 'vitest';
import { dispatchReminders, type ReminderLogStore } from './reminder-dispatch';
import type { CreateNotificationData } from './notification-repository';

/** In-memory marker store that persists across dispatch runs (simulating the DB-backed store). */
function makeStore(): ReminderLogStore & { keys: Set<string> } {
  const keys = new Set<string>();
  return {
    keys,
    async has(k) {
      return keys.has(k);
    },
    async add(k) {
      keys.add(k);
    },
  };
}

const overdue = (taskId: string, userId: string): CreateNotificationData => ({
  userId,
  type: 'TASK_OVERDUE',
  title: 'A task is overdue',
  body: taskId,
  entityType: 'task',
  entityId: taskId,
});

describe('dispatchReminders', () => {
  it('sends each planned reminder once and records a marker', async () => {
    const store = makeStore();
    const sentTo: string[] = [];
    const count = await dispatchReminders([overdue('t1', 'u1'), overdue('t1', 'u2')], {
      period: '2026-09-09',
      store,
      notify: async (n) => { sentTo.push(`${n.entityId}:${n.userId}`); },
    });
    expect(count).toBe(2);
    expect(sentTo).toEqual(['t1:u1', 't1:u2']);
    expect(store.keys.size).toBe(2);
  });

  it('does NOT re-send on a second run with the same persisted store + period (restart / next sweep)', async () => {
    const store = makeStore();
    const planned = [overdue('t1', 'u1')];
    await dispatchReminders(planned, { period: '2026-09-09', store, notify: async () => {} });

    const sentTo: string[] = [];
    const count = await dispatchReminders(planned, {
      period: '2026-09-09',
      store,
      notify: async (n) => { sentTo.push(n.entityId!); },
    });
    expect(count).toBe(0);
    expect(sentTo).toEqual([]);
  });

  it('re-sends in a new period (a genuinely new day)', async () => {
    const store = makeStore();
    const planned = [overdue('t1', 'u1')];
    await dispatchReminders(planned, { period: '2026-09-09', store, notify: async () => {} });
    const count = await dispatchReminders(planned, { period: '2026-09-10', store, notify: async () => {} });
    expect(count).toBe(1);
  });
});
