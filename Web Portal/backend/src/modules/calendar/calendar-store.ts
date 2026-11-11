import type { ReminderAnchor } from './task-reminders';

/**
 * Calendar scheduling's rows: work blocks, personal reminders and each person's Calendar choices. The
 * Prisma store is prisma-calendar-store.ts; this file holds the shapes and an in-memory store for tests.
 */

export interface BlockRow {
  id: string;
  taskId: string;
  userId: string;
  plannedById: string;
  startAt: Date;
  endAt: Date;
  createdAt: Date;
}

export interface ReminderRow {
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
  createdAt: Date;
}

/** A task as the calendar's blocks and reminders name it. */
export interface CalTaskBrief {
  id: string;
  key: string;
  title: string;
  projectId: string;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  deletedAt: Date | null;
  archivedAt?: Date | null;
}

export type NewReminder = Pick<ReminderRow, 'taskId' | 'userId' | 'setById' | 'at' | 'anchor' | 'offsetMinutes' | 'nextAt'>;
export type ReminderPatch = Partial<Pick<ReminderRow, 'at' | 'anchor' | 'offsetMinutes' | 'nextAt' | 'mutedAt' | 'snoozedUntil' | 'sentFor'>>;

export interface CalendarStore {
  blocksOfTask(taskId: string): Promise<BlockRow[]>;
  block(id: string): Promise<BlockRow | null>;
  countBlocks(taskId: string, userId: string): Promise<number>;
  addBlock(data: Omit<BlockRow, 'id' | 'createdAt'>): Promise<BlockRow>;
  updateBlock(id: string, patch: { startAt: Date; endAt: Date }): Promise<BlockRow>;
  removeBlock(id: string): Promise<void>;

  /** The task's reminders `viewerId` gets or set. */
  remindersOfTask(taskId: string, viewerId: string): Promise<ReminderRow[]>;
  reminder(id: string): Promise<ReminderRow | null>;
  countReminders(taskId: string, userId: string): Promise<number>;
  addReminder(data: NewReminder): Promise<ReminderRow>;
  updateReminder(id: string, patch: ReminderPatch): Promise<ReminderRow>;
  removeReminder(id: string): Promise<void>;

  /**
   * Blocks overlapping [from, to): one person's (`userId`), or — the Team view — everyone's on tasks of
   * `projectIds` (null: every project). Live tasks of live projects only; the caller hides the rest.
   */
  blocksBetween(q: { from: Date; to: Date; userId?: string; projectIds?: string[] | null }): Promise<(BlockRow & { task: CalTaskBrief })[]>;
  /** One person's reminders that may fall in [from, to): set times in it, and every one before a start or due of an open task. */
  remindersForCalendar(q: { userId: string; from: Date; to: Date }): Promise<(ReminderRow & { task: CalTaskBrief })[]>;

  prefs(userId: string): Promise<unknown | null>;
  savePrefs(userId: string, prefs: unknown): Promise<void>;
}

/** In memory (tests): `tasks` names the tasks blocks and reminders belong to. */
export function createMemoryCalendarStore(tasks: Map<string, CalTaskBrief> = new Map()) {
  const blocks = new Map<string, BlockRow>();
  const reminders = new Map<string, ReminderRow>();
  const prefs = new Map<string, unknown>();
  let seq = 0;
  const withTask = <T extends { taskId: string }>(r: T) => ({ ...r, task: tasks.get(r.taskId)! });
  const store: CalendarStore = {
    async blocksOfTask(taskId) {
      return [...blocks.values()].filter((b) => b.taskId === taskId).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    },
    async block(id) {
      return blocks.get(id) ?? null;
    },
    async countBlocks(taskId, userId) {
      return [...blocks.values()].filter((b) => b.taskId === taskId && b.userId === userId).length;
    },
    async addBlock(data) {
      const row = { ...data, id: `b${++seq}`, createdAt: new Date() };
      blocks.set(row.id, row);
      return { ...row };
    },
    async updateBlock(id, patch) {
      const row = { ...blocks.get(id)!, ...patch };
      blocks.set(id, row);
      return { ...row };
    },
    async removeBlock(id) {
      blocks.delete(id);
    },
    async remindersOfTask(taskId, viewerId) {
      return [...reminders.values()].filter((r) => r.taskId === taskId && (r.userId === viewerId || r.setById === viewerId)).map((r) => ({ ...r }));
    },
    async reminder(id) {
      const r = reminders.get(id);
      return r ? { ...r } : null;
    },
    async countReminders(taskId, userId) {
      return [...reminders.values()].filter((r) => r.taskId === taskId && r.userId === userId).length;
    },
    async addReminder(data) {
      const row: ReminderRow = { ...data, id: `r${++seq}`, mutedAt: null, snoozedUntil: null, sentFor: null, sentAt: null, createdAt: new Date() };
      reminders.set(row.id, row);
      return { ...row };
    },
    async updateReminder(id, patch) {
      const row = { ...reminders.get(id)!, ...patch };
      reminders.set(id, row);
      return { ...row };
    },
    async removeReminder(id) {
      reminders.delete(id);
    },
    async blocksBetween(q) {
      return [...blocks.values()]
        .filter((b) => b.startAt < q.to && b.endAt > q.from && tasks.has(b.taskId))
        .filter((b) => (q.userId ? b.userId === q.userId : true))
        .filter((b) => (q.projectIds ? q.projectIds.includes(tasks.get(b.taskId)!.projectId) : true))
        .map(withTask);
    },
    async remindersForCalendar(q) {
      return [...reminders.values()]
        .filter((r) => r.userId === q.userId && tasks.has(r.taskId))
        .filter((r) => (r.at ? r.at >= q.from && r.at < q.to : true) || (r.snoozedUntil !== null && r.snoozedUntil >= q.from && r.snoozedUntil < q.to))
        .map(withTask);
    },
    async prefs(userId) {
      return prefs.get(userId) ?? null;
    },
    async savePrefs(userId, value) {
      prefs.set(userId, value);
    },
  };
  return { store, blocks, reminders, tasks };
}
