import { fireAtOf, reminderNotice, reminderState, REMINDER_GRACE_MS, type ReminderAnchor, type ReminderClock } from './task-reminders';

/**
 * Personal reminders (Calendar scheduling): every minute one lease-locked instance sends the ones whose
 * time has come — through the notification service, so the person's channels, quiet hours and Pause
 * apply (Notification & Scheduling: the bell fills, a held push waits for the morning). Each send is
 * claimed once in reminder_logs (`pr:<id>:<time>`) so two servers never send one twice; `sentFor`
 * remembers the time it went for, so it goes again only when that time changes (a moved due date).
 * A reminder before a start or due is kept in step with the task: its `nextAt` is worked out again
 * whenever the task changed since the last run (all of them on the first run).
 */

export const TASK_REMINDER_TYPE = 'TASK_REMINDER';
export const REMINDER_KEY_PREFIX = 'pr:';

export interface ReminderSweepRow {
  id: string;
  taskId: string;
  userId: string;
  setById: string;
  at: Date | null;
  anchor: ReminderAnchor | null;
  offsetMinutes: number | null;
  nextAt: Date | null;
  mutedAt: Date | null;
  snoozedUntil: Date | null;
  sentFor: Date | null;
  sentAt: Date | null;
}

export interface ReminderSweepTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  deletedAt: Date | null;
  archivedAt?: Date | null;
  /** Its project is archived (its own status, or all its companies): nothing is sent, as for the planner. */
  projectArchived: boolean;
  /** Who is on it now (one set for someone by a manager stops when they are taken off it). */
  assigneeIds: string[];
}

export interface ReminderSweepStore {
  /** Reminders (not muted) whose next time is within [from, to]. */
  dueBetween(from: Date, to: Date): Promise<ReminderSweepRow[]>;
  /** Reminders before a start or due whose task changed since `since` (null: all of them, of live tasks). */
  relativeChangedSince(since: Date | null): Promise<ReminderSweepRow[]>;
  tasks(ids: string[]): Promise<Map<string, ReminderSweepTask>>;
  /** Only while its `nextAt` is still `expect` (a change made meanwhile wins). */
  setNextAt(id: string, nextAt: Date | null, expect: Date | null): Promise<void>;
  /** Only while its `nextAt` is still `expectNextAt` (a change made meanwhile wins). */
  markSent(id: string, p: { sentFor: Date | null; sentAt: Date; clearSnooze: boolean; nextAt: Date | null; expectNextAt: Date | null }): Promise<void>;
}

export interface ReminderSweepDeps {
  store: ReminderSweepStore;
  /** Claim a send once across servers (false: already claimed). */
  keys: { claim(key: string): Promise<boolean> };
  notify(n: { userId: string; type: string; title: string; body: string | null; entityType: string; entityId: string }): Promise<unknown>;
  /** May this (active) person still open the task? */
  canView(userId: string, taskId: string): Promise<boolean>;
  names(userIds: string[]): Promise<Map<string, string>>;
  /** The site's time zone and when its working day starts (a date-only start or due counts from then). */
  clock(): Promise<ReminderClock>;
  now?: () => Date;
  logger?: { error?(msg: string, meta?: Record<string, unknown>): void };
}

const same = (a: Date | null, b: Date | null) => (a === null ? b === null : b !== null && a.getTime() === b.getTime());

export function createReminderSweep(deps: ReminderSweepDeps) {
  let lastRun: Date | null = null;

  async function resync(now: Date, clock: ReminderClock): Promise<void> {
    // Two minutes of overlap: a task saved while the last run was reading is looked at again.
    const since = lastRun ? new Date(lastRun.getTime() - 2 * 60_000) : null;
    const rows = await deps.store.relativeChangedSince(since);
    if (rows.length === 0) return;
    const tasks = await deps.store.tasks([...new Set(rows.map((r) => r.taskId))]);
    for (const r of rows) {
      const t = tasks.get(r.taskId);
      if (!t) continue;
      const fire = r.snoozedUntil ?? fireAtOf(r, t, clock);
      // Already sent for that time: nothing left to go (null), until the time changes again.
      const next = fire && same(fire, r.sentFor) ? null : fire;
      if (!same(next, r.nextAt)) await deps.store.setNextAt(r.id, next, r.nextAt);
    }
    void now;
  }

  async function run(): Promise<{ sent: number }> {
    const now = (deps.now ?? (() => new Date()))();
    const clock = await deps.clock();
    await resync(now, clock);
    lastRun = now;
    const rows = await deps.store.dueBetween(new Date(now.getTime() - REMINDER_GRACE_MS), now);
    if (rows.length === 0) return { sent: 0 };
    const tasks = await deps.store.tasks([...new Set(rows.map((r) => r.taskId))]);
    const names = await deps.names([...new Set(rows.filter((r) => r.setById !== r.userId).map((r) => r.setById))]);
    let sent = 0;
    for (const r of rows) {
      const t = tasks.get(r.taskId);
      if (!t || t.projectArchived) continue;
      // One a manager set for someone stops once they are no longer on the task (their own keep going).
      if (r.setById !== r.userId && !t.assigneeIds.includes(r.userId)) continue;
      const { state, fireAt } = reminderState(r, t, now, clock);
      if (state !== 'send' || !fireAt) continue;
      if (!(await deps.canView(r.userId, r.taskId))) continue;
      const base = fireAtOf(r, t, clock);
      const snoozed = !!r.snoozedUntil;
      // After a snoozed send its own time counts as sent too, when that was not later.
      const sentFor = snoozed ? (base && base.getTime() <= fireAt.getTime() ? base : r.sentFor) : fireAt;
      // Sent: nothing left to go — unless snoozed early, then its own time is still to come.
      const nextAt = snoozed && base && base.getTime() > fireAt.getTime() ? base : null;
      const mark = () => deps.store.markSent(r.id, { sentFor, sentAt: now, clearSnooze: snoozed, nextAt, expectNextAt: r.nextAt });
      if (!(await deps.keys.claim(`${REMINDER_KEY_PREFIX}${r.id}:${fireAt.getTime()}`))) {
        await mark();
        continue;
      }
      const notice = reminderNotice({ task: t, anchor: r.anchor, setByName: r.setById !== r.userId ? (names.get(r.setById) ?? null) : null, timeZone: clock.timeZone, now });
      try {
        await deps.notify({ userId: r.userId, type: TASK_REMINDER_TYPE, title: notice.title, body: notice.body, entityType: 'task', entityId: r.taskId });
        sent++;
      } catch (err) {
        deps.logger?.error?.('a personal reminder could not be sent', { err, reminderId: r.id });
      }
      await mark();
    }
    return { sent };
  }

  return { run };
}
