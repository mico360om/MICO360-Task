import type { Prisma, PrismaClient } from '@prisma/client';
import { shiftDayKey, todayKey, zonedDayKey, zonedStartOfDay } from '../../lib/due-date';
import { LIVE_PROJECT_WHERE } from '../companies/company-access';
import { dispatchReminders, type ReminderLogStore } from '../notifications/reminder-dispatch';
import type { PlannedReminder } from '../notifications/reminder';
import type { CreateNotificationData } from '../notifications/notification-repository';
import { taskNoticeBody } from '../notifications/task-notice';
import { boardDateKey } from './board-date';
import { isNotStarted, startDayKey, startsOnWords, waitingDayKey } from './scheduled-start';

/**
 * Tasks scheduled for the future (owner, 10 Nov 2026: notices "Both: now and on the day"):
 *
 *   - now: the usual "You were assigned a task" notice, marked "— starts 20 Nov" while the task waits;
 *   - on the day: the morning it starts, its people get "A task starts today" in the bell (and on their
 *     phone, unless they turned task assignments off — the same switch as the assignment notice; the day's
 *     email lists it under their tasks that morning). Sent once by a daily job, never for a task deleted,
 *     merged, completed, under way or handed in for approval meanwhile, nor in an archived project; a start
 *     moved to another day is reminded on that day, never twice for one day (reminder_logs, per day).
 */

const DAY_MS = 86_400_000;
/** The morning: from 07:00 company time, as the daily digest. */
export const START_REMINDER_HOUR = 7;

/** "You were assigned a task", with "— starts 20 Nov" while the task waits for its start day. */
export function assignedNoticeTitle(task: { boardDate?: Date | string | null; completedAt?: Date | string | null } | null, timeZone: string, now: Date): string {
  const waits = task ? waitingDayKey(task, timeZone, now) : null;
  return waits ? `You were assigned a task — ${startsOnWords(waits, now, timeZone)}` : 'You were assigned a task';
}

/** A task the job looks at: its dates and state, and who is on it. */
export interface StartingTaskRow {
  id: string;
  key: string;
  title: string;
  startDate: Date | null;
  boardDate: Date | null;
  createdAt: Date;
  columnCategory: string | null;
  completedAt: Date | null;
  approvalRequestedAt: Date | null;
  assigneeIds: string[];
}

/**
 * The reminders due now: a task not started yet (Backlog or To-do kind, not done, not handed in) whose
 * start day is today, that is on today's board (not put on a later one), and that was made before today
 * (one made today was news in its assignment notice). Each of its people, once (`dedupeId`).
 */
export function planStartDayReminders(tasks: StartingTaskRow[], { timeZone, now }: { timeZone: string; now: Date }): PlannedReminder[] {
  const today = todayKey(timeZone, now);
  const out: PlannedReminder[] = [];
  for (const t of tasks) {
    if (!isNotStarted(t)) continue;
    if (startDayKey(t.startDate, timeZone) !== today) continue;
    if (t.boardDate && boardDateKey(t.boardDate, timeZone) > today) continue;
    if (zonedDayKey(t.createdAt, timeZone) >= today) continue;
    const body = taskNoticeBody({ key: t.key, title: t.title }) ?? t.title;
    for (const userId of [...new Set(t.assigneeIds)]) {
      out.push({ userId, type: 'TASK_ASSIGNED', title: 'A task starts today', body, entityType: 'task', entityId: t.id, dedupeId: `starts:${t.id}` });
    }
  }
  return out;
}

/** The database's loose edges (a start may be a day or an instant): the plan decides each row exactly. */
export function startingWindow(timeZone: string, now: Date) {
  const today = todayKey(timeZone, now);
  const midnight = (key: string) => new Date(`${key}T00:00:00.000Z`);
  return {
    today,
    startFrom: midnight(shiftDayKey(today, -1)),
    startBefore: midnight(shiftDayKey(today, 2)),
    createdBefore: zonedStartOfDay(today, timeZone),
    boardBefore: midnight(shiftDayKey(today, 1)),
  };
}

export interface StartDayReminderDeps {
  source: { startingToday(window: ReturnType<typeof startingWindow>): Promise<StartingTaskRow[]> };
  /** Of these people, those who may still open the task (active, on its project, in its company). */
  visibleRecipients(taskId: string, userIds: string[]): Promise<string[]>;
  store: ReminderLogStore;
  notify(n: CreateNotificationData): Promise<unknown>;
  timeZone: string;
  now?: () => Date;
}

/** The daily job (run hourly under a lease, like the digest): sends the morning's start-day reminders once. */
export function createStartDayReminders({ source, visibleRecipients, store, notify, timeZone, now = () => new Date() }: StartDayReminderDeps) {
  async function run(): Promise<{ sent: number }> {
    const at = now();
    const hour = Math.floor((at.getTime() - zonedStartOfDay(todayKey(timeZone, at), timeZone).getTime()) / (DAY_MS / 24));
    if (hour < START_REMINDER_HOUR) return { sent: 0 };
    const window = startingWindow(timeZone, at);
    const rows = await source.startingToday(window);
    const due = rows.filter((t) => planStartDayReminders([t], { timeZone, now: at }).length > 0);
    const visible: StartingTaskRow[] = [];
    for (const t of due) visible.push({ ...t, assigneeIds: await visibleRecipients(t.id, t.assigneeIds) });
    const sent = await dispatchReminders(planStartDayReminders(visible, { timeZone, now: at }), { period: window.today, store, notify });
    return { sent };
  }
  return { run };
}

const startingSelect = {
  id: true,
  key: true,
  title: true,
  startDate: true,
  boardDate: true,
  createdAt: true,
  completedAt: true,
  approvalRequestedAt: true,
  column: { select: { category: true } },
  assignees: { select: { userId: true } },
} satisfies Prisma.TaskSelect;

/**
 * The tasks that may start today, over Prisma (MariaDB-safe: a plain filtered select). Live tasks only:
 * not deleted or merged (a merged task is deleted too), not completed or handed in, in a Backlog or
 * To-do kind of column, of a live project (not deleted, not archived, in an active company).
 */
export function createPrismaStartingTasksSource(prisma: PrismaClient): StartDayReminderDeps['source'] {
  return {
    async startingToday(w) {
      const rows = await prisma.task.findMany({
        where: {
          deletedAt: null,
          mergedIntoId: null,
          archivedAt: null, // task archive: an archived task sends no start-day reminder
          completedAt: null,
          approvalRequestedAt: null,
          startDate: { gte: w.startFrom, lt: w.startBefore },
          createdAt: { lt: w.createdBefore },
          OR: [{ boardDate: null }, { boardDate: { lt: w.boardBefore } }],
          column: { category: { in: ['BACKLOG', 'TODO'] } },
          project: { is: { deletedAt: null, ...LIVE_PROJECT_WHERE } },
        },
        select: startingSelect,
      });
      return rows.map((t) => ({
        id: t.id,
        key: t.key,
        title: t.title,
        startDate: t.startDate,
        boardDate: t.boardDate,
        createdAt: t.createdAt,
        columnCategory: t.column?.category ?? null,
        completedAt: t.completedAt,
        approvalRequestedAt: t.approvalRequestedAt,
        assigneeIds: t.assignees.map((a) => a.userId),
      }));
    },
  };
}
