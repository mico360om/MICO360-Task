import { dueDayKey } from '../../lib/due-date';
import { zonedClock, zonedInstant } from '../../lib/working-days';
import { formatDay } from '../../lib/export-format';
import { chosenStart } from './calendar-span';

/**
 * Personal reminders on tasks (Calendar scheduling, owner 11 Nov 2026): anyone who can see a task adds
 * their own — at a date and time, or a time before its start or due — and each person sees only their
 * own (and the ones they set for others); the task's creator or whoever runs its project can set them
 * for its assignees ("set by Sara"), who can mute or snooze those for themselves but not delete them.
 * Sent through the Notification & Scheduling engine (the person's channels, quiet hours and Pause).
 * Pure rules here; the store, routes and sweep sit beside.
 */

export type ReminderAnchor = 'start' | 'due';

/** Up to 60 days before the start or due. */
export const MAX_REMINDER_OFFSET_MINUTES = 60 * 24 * 60;
/** A reminder more than a day past its time is not sent (the server was off, or a date moved into the past). */
export const REMINDER_GRACE_MS = 24 * 3600_000;

export interface ReminderSpec {
  at?: Date | null;
  anchor?: ReminderAnchor | null;
  offsetMinutes?: number | null;
}

/** What is wrong with a reminder's time (null: fine): exactly one of a time, or an anchor and how long before it. */
export function reminderSpecProblem(spec: ReminderSpec): string | null {
  const hasAt = spec.at instanceof Date;
  const hasAnchor = spec.anchor === 'start' || spec.anchor === 'due';
  if (hasAt === hasAnchor) return 'Choose when: a date and time, or a time before the start or due date.';
  if (hasAt) return Number.isNaN(spec.at!.getTime()) ? 'Choose when: a date and time, or a time before the start or due date.' : null;
  const off = spec.offsetMinutes;
  if (typeof off !== 'number' || !Number.isInteger(off) || off < 0) return 'Say how long before (in minutes).';
  if (off > MAX_REMINDER_OFFSET_MINUTES) return 'A reminder is at most 60 days before.';
  return null;
}

export interface ReminderTiming {
  at: Date | null;
  anchor: ReminderAnchor | null;
  offsetMinutes: number | null;
}

export interface ReminderTaskDates {
  startDate: Date | null;
  dueDate: Date | null;
}

export interface ReminderClock {
  /** The site's (company) time zone. */
  timeZone: string;
  /** When a working day starts ('HH:MM'): a date-only start or due counts from then. */
  dayStart: string;
}

const isDateOnly = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;

/** The instant a start or due date stands for: its time, or for a day the start of that working day (company time). */
export function anchorInstant(value: Date | null, clock: ReminderClock): Date | null {
  if (!value) return null;
  if (!isDateOnly(value)) return value;
  return zonedInstant(dueDayKey(value, clock.timeZone)!, clock.dayStart, clock.timeZone);
}

/** When the reminder is set for (null: its anchor is gone — the task has no such date now). */
export function fireAtOf(r: ReminderTiming, task: ReminderTaskDates, clock: ReminderClock): Date | null {
  if (r.at) return r.at;
  if (!r.anchor) return null;
  // Before its start: only a start someone chose (the automatic one is when the task was made — R11).
  const base = anchorInstant(r.anchor === 'start' ? chosenStart(task.startDate) : task.dueDate, clock);
  return base ? new Date(base.getTime() - (r.offsetMinutes ?? 0) * 60_000) : null;
}

export type ReminderStateName = 'wait' | 'send' | 'sent' | 'missed' | 'muted' | 'hidden' | 'none';

export interface ReminderRowState extends ReminderTiming {
  mutedAt: Date | null;
  snoozedUntil: Date | null;
  /** The instant it was last sent for (it goes again only when its time changes). */
  sentFor: Date | null;
}

export interface ReminderTaskState extends ReminderTaskDates {
  completedAt: Date | null;
  deletedAt: Date | null;
  archivedAt?: Date | null;
}

/**
 * Where a reminder stands now. Kept but hidden (never sent) while its task is done, binned or archived
 * (call 2) — back when it is reopened; muted by its person: never sent; snoozed: it goes at the snooze
 * time instead. It goes once for its time, again only if that time changes; more than a day late, never.
 */
export function reminderState(r: ReminderRowState, task: ReminderTaskState, now: Date, clock: ReminderClock): { state: ReminderStateName; fireAt: Date | null } {
  const base = fireAtOf(r, task, clock);
  const fireAt = r.snoozedUntil ?? base;
  if (task.deletedAt || task.archivedAt || task.completedAt) return { state: 'hidden', fireAt };
  if (!fireAt) return { state: 'none', fireAt };
  if (r.mutedAt) return { state: 'muted', fireAt };
  if (r.sentFor && r.sentFor.getTime() === fireAt.getTime()) return { state: 'sent', fireAt };
  if (fireAt.getTime() > now.getTime()) return { state: 'wait', fireAt };
  if (now.getTime() - fireAt.getTime() > REMINDER_GRACE_MS) return { state: 'missed', fireAt };
  return { state: 'send', fireAt };
}

// ── Who ───────────────────────────────────────────────────────────────────

export interface ReminderTaskPeople {
  assigneeIds: readonly string[];
  createdById: string;
}

/**
 * May `viewerId` (who can see the task) set a reminder for `recipientId`? Their own always; someone
 * else's only as the task's creator or whoever runs its project, and only for its assignees.
 */
export function mayAddReminder(p: { viewerId: string; recipientId: string; task: ReminderTaskPeople; runsProject: boolean }): boolean {
  if (p.recipientId === p.viewerId) return true;
  return (p.viewerId === p.task.createdById || p.runsProject) && p.task.assigneeIds.includes(p.recipientId);
}

/** Each person sees their own reminders and the ones they set for others — nobody else's. */
export function maySeeReminder(viewerId: string, r: { userId: string; setById: string }): boolean {
  return r.userId === viewerId || r.setById === viewerId;
}

/** Only whoever set it changes its time or removes it. */
export function mayChangeReminder(viewerId: string, r: { userId?: string; setById: string }): boolean {
  return r.setById === viewerId;
}

/** Its person mutes or snoozes one someone else set for them (their own they change or remove). */
export function mayMuteReminder(viewerId: string, r: { userId: string; setById: string }): boolean {
  return r.userId === viewerId && r.setById !== viewerId;
}

// ── The notice ────────────────────────────────────────────────────────────

function whenWords(value: Date, timeZone: string, now: Date): string {
  const day = dueDayKey(value, timeZone)!;
  const sameYear = day.slice(0, 4) === zonedClock(now, timeZone).day.slice(0, 4);
  const words = formatDay(day, { weekday: true, year: !sameYear });
  if (isDateOnly(value)) return words;
  const { minutes } = zonedClock(value, timeZone);
  return `${words} at ${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "Reminder: RIG-12 Pour the slab" — "Due Fri 20 Nov. Set by Sara Ali." */
export function reminderNotice(p: {
  task: { key: string; title: string; startDate: Date | null; dueDate: Date | null };
  anchor: ReminderAnchor | null;
  setByName: string | null;
  timeZone: string;
  now: Date;
}): { title: string; body: string | null } {
  const { task } = p;
  const lines: string[] = [];
  const useStart = p.anchor === 'start' && task.startDate;
  if (useStart) lines.push(`Starts ${whenWords(task.startDate!, p.timeZone, p.now)}.`);
  else if (task.dueDate) lines.push(`Due ${whenWords(task.dueDate, p.timeZone, p.now)}.`);
  else if (task.startDate) lines.push(`Starts ${whenWords(task.startDate, p.timeZone, p.now)}.`);
  if (p.setByName) lines.push(`Set by ${p.setByName}.`);
  return { title: `Reminder: ${task.key} ${task.title}`, body: lines.length ? lines.join(' ') : null };
}
