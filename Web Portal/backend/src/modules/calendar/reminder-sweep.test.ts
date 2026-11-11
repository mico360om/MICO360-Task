import { describe, it, expect } from 'vitest';
import { createReminderSweep, type ReminderSweepRow, type ReminderSweepStore, type ReminderSweepTask } from './reminder-sweep';

const TZ = 'Asia/Muscat';
const day = (k: string) => new Date(`${k}T00:00:00.000Z`);
const at = (iso: string) => new Date(iso);

function memory(rows: ReminderSweepRow[], tasks: ReminderSweepTask[]) {
  const byId = new Map(rows.map((r) => [r.id, { ...r }]));
  const taskById = new Map(tasks.map((t) => [t.id, { ...t }]));
  const changed = new Map<string, Date>(tasks.map((t) => [t.id, at('2026-11-01T00:00:00Z')]));
  const store: ReminderSweepStore = {
    async dueBetween(from, to) {
      return [...byId.values()].filter((r) => r.nextAt && r.nextAt >= from && r.nextAt <= to && !r.mutedAt).map((r) => ({ ...r }));
    },
    async relativeChangedSince(since) {
      return [...byId.values()].filter((r) => r.anchor && (!since || changed.get(r.taskId)! >= since)).map((r) => ({ ...r }));
    },
    async tasks(ids) {
      return new Map(ids.filter((id) => taskById.has(id)).map((id) => [id, { ...taskById.get(id)! }]));
    },
    async setNextAt(id, nextAt) {
      byId.get(id)!.nextAt = nextAt;
    },
    async markSent(id, p) {
      const r = byId.get(id)!;
      r.sentFor = p.sentFor;
      r.sentAt = p.sentAt;
      if (p.clearSnooze) r.snoozedUntil = null;
      r.nextAt = p.nextAt;
    },
  };
  const claimed = new Set<string>();
  const sent: { userId: string; type: string; title: string; body: string | null; entityType: string; entityId: string }[] = [];
  return {
    store,
    byId,
    taskById,
    changed,
    claimed,
    sent,
    keys: { async claim(key: string) { if (claimed.has(key)) return false; claimed.add(key); return true; } },
    notify: async (n: (typeof sent)[number]) => { sent.push(n); },
  };
}

const row = (extra: Partial<ReminderSweepRow>): ReminderSweepRow => ({
  id: 'r1',
  taskId: 't1',
  userId: 'ali',
  setById: 'ali',
  at: null,
  anchor: 'due',
  offsetMinutes: 0,
  nextAt: at('2026-11-20T04:00:00Z'),
  mutedAt: null,
  snoozedUntil: null,
  sentFor: null,
  sentAt: null,
  ...extra,
});
const task = (extra: Partial<ReminderSweepTask> = {}): ReminderSweepTask => ({
  id: 't1',
  key: 'RIG-12',
  title: 'Pour the slab',
  projectId: 'p1',
  startDate: null,
  dueDate: day('2026-11-20'),
  completedAt: null,
  deletedAt: null,
  projectArchived: false,
  ...extra,
});

function sweep(m: ReturnType<typeof memory>, now: Date, opts: { canView?: (u: string, t: string) => boolean } = {}) {
  return createReminderSweep({
    store: m.store,
    keys: m.keys,
    notify: m.notify,
    canView: async (u, t) => (opts.canView ? opts.canView(u, t) : true),
    names: async (ids) => new Map(ids.map((id) => [id, id === 'sara' ? 'Sara Ali' : id])),
    clock: async () => ({ timeZone: TZ, dayStart: '08:00' }),
    now: () => now,
  });
}

describe('the personal reminder sweep (every minute, one instance)', () => {
  it('sends a reminder once at its time, through the notification service, to its person', async () => {
    const m = memory([row({})], [task()]);
    await sweep(m, at('2026-11-20T03:59:00Z')).run();
    expect(m.sent).toHaveLength(0);
    const s = sweep(m, at('2026-11-20T04:00:30Z'));
    await s.run();
    expect(m.sent).toEqual([{ userId: 'ali', type: 'TASK_REMINDER', title: 'Reminder: RIG-12 Pour the slab', body: 'Due Fri 20 Nov.', entityType: 'task', entityId: 't1' }]);
    expect(m.byId.get('r1')!.sentFor).toEqual(at('2026-11-20T04:00:00Z'));
    await s.run();
    expect(m.sent).toHaveLength(1);
  });

  it('keeps a reminder before the start or due in step with the task’s dates (a moved due date moves it)', async () => {
    const m = memory([row({ offsetMinutes: 24 * 60, nextAt: at('2026-11-19T04:00:00Z') })], [task()]);
    m.taskById.get('t1')!.dueDate = day('2026-11-27');
    m.changed.set('t1', at('2026-11-18T10:00:00Z'));
    const s = sweep(m, at('2026-11-19T04:00:00Z'));
    await s.run();
    expect(m.sent).toHaveLength(0);
    expect(m.byId.get('r1')!.nextAt).toEqual(at('2026-11-26T04:00:00Z'));
    await sweep(m, at('2026-11-26T04:01:00Z')).run();
    expect(m.sent).toHaveLength(1);
  });

  it('says who set it when it was set for them', async () => {
    const m = memory([row({ setById: 'sara' })], [task()]);
    await sweep(m, at('2026-11-20T04:00:00Z')).run();
    expect(m.sent[0]!.body).toBe('Due Fri 20 Nov. Set by Sara Ali.');
  });

  it('never for a task done, binned or archived, in an archived project, or one its person can no longer open', async () => {
    for (const t of [task({ completedAt: at('2026-11-19T00:00:00Z') }), task({ deletedAt: at('2026-11-19T00:00:00Z') }), task({ archivedAt: at('2026-11-19T00:00:00Z') }), task({ projectArchived: true })]) {
      const m = memory([row({})], [t]);
      await sweep(m, at('2026-11-20T04:00:00Z')).run();
      expect(m.sent).toHaveLength(0);
    }
    const m = memory([row({})], [task()]);
    await sweep(m, at('2026-11-20T04:00:00Z'), { canView: () => false }).run();
    expect(m.sent).toHaveLength(0);
  });

  it('a muted one never; a snoozed one at its snooze time, then back to its own time', async () => {
    const muted = memory([row({ mutedAt: at('2026-11-19T00:00:00Z') })], [task()]);
    await sweep(muted, at('2026-11-20T04:00:00Z')).run();
    expect(muted.sent).toHaveLength(0);
    const fire = at('2026-11-20T04:00:00Z');
    const snoozed = memory([row({ sentFor: fire, snoozedUntil: at('2026-11-20T05:00:00Z'), nextAt: at('2026-11-20T05:00:00Z') })], [task()]);
    await sweep(snoozed, at('2026-11-20T05:00:10Z')).run();
    expect(snoozed.sent).toHaveLength(1);
    const r = snoozed.byId.get('r1')!;
    expect(r.snoozedUntil).toBeNull();
    expect(r.sentFor).toEqual(fire);
    await sweep(snoozed, at('2026-11-20T05:01:00Z')).run();
    expect(snoozed.sent).toHaveLength(1);
  });

  it('two servers never send one twice (the key in reminder_logs)', async () => {
    const m = memory([row({})], [task()]);
    m.claimed.add(`pr:r1:${at('2026-11-20T04:00:00Z').getTime()}`);
    await sweep(m, at('2026-11-20T04:00:00Z')).run();
    expect(m.sent).toHaveLength(0);
    expect(m.byId.get('r1')!.sentFor).toEqual(at('2026-11-20T04:00:00Z'));
  });
});
