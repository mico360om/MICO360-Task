import { shiftDayKey } from '../../lib/due-date';
import type { Priority } from '../tasks/task-repository';

/**
 * How a template's tasks get their dates (the one rule, used by the preview and by creating the project):
 * - A task's offset counts **calendar days** from the project's start day: 0 is the start day, 5 is the
 *   fifth day after it, -2 two days before. No offset: no due date.
 * - A due day that falls on one of the company's days off (the working days set for meetings in System
 *   Settings, Sunday to Thursday unless changed) moves forward to the next working day.
 * - The start day itself may be any day, a past one or a day off too; it is never moved.
 */

/** 0 = Sunday … 6 = Saturday, of a 'YYYY-MM-DD' day. */
export function weekdayOf(dayKey: string): number {
  return new Date(`${dayKey}T12:00:00.000Z`).getUTCDay();
}

/** The due day for `offset` days from `startKey`, and the day it was moved off when that was a day off. */
export function dueDayFor(startKey: string, offset: number | null, workingDays: number[]): { day: string | null; movedFrom: string | null } {
  if (offset === null) return { day: null, movedFrom: null };
  const first = shiftDayKey(startKey, offset);
  const working = new Set(workingDays);
  if (working.size === 0) return { day: first, movedFrom: null };
  let day = first;
  for (let i = 0; i < 7 && !working.has(weekdayOf(day)); i++) day = shiftDayKey(day, 1);
  return { day, movedFrom: day === first ? null : first };
}

/** Whole days from `baseKey` to `dueKey` (negative when due before it); null without a due day. */
export function offsetBetween(baseKey: string, dueKey: string | null): number | null {
  if (!dueKey) return null;
  return Math.round((Date.parse(`${dueKey}T12:00:00Z`) - Date.parse(`${baseKey}T12:00:00Z`)) / 86_400_000);
}

/** The column a template's tasks start in: the first To Do column, else the first that isn't Done, else the first. */
export function startColumnIndex(columns: { category: string }[]): number {
  const todo = columns.findIndex((c) => c.category === 'TODO');
  if (todo >= 0) return todo;
  const open = columns.findIndex((c) => c.category !== 'DONE');
  return open >= 0 ? open : 0;
}

/** What planning needs of a template task. */
export interface PlanSourceTask {
  title: string;
  description: string | null;
  priority: Priority;
  dueOffsetDays: number | null;
  roleId: string | null;
  checklist: string[];
}

/** A template task as it will be created for one start day. */
export interface PlannedTask {
  title: string;
  description: string | null;
  priority: Priority;
  /** 'YYYY-MM-DD', or null for no due date. */
  dueDay: string | null;
  /** The day off its offset fell on, when it was moved to the next working day. */
  movedFrom: string | null;
  offset: number | null;
  roleId: string | null;
  roleName: string | null;
  /** The person filling its role; null: nobody (the project's usual default applies — its owner). */
  assigneeId: string | null;
  checklist: string[];
}

/**
 * A template's tasks for a project starting on `startKey`: their due days (dueDayFor) and who does
 * them — the person chosen for each task's role. A task without a role, or whose role nobody fills,
 * gets no one here: creating the project gives it the usual default (the project's owner).
 */
export function planTemplateTasks(
  template: { roles: { id: string; name: string }[]; tasks: PlanSourceTask[] },
  { startKey, workingDays, fillers }: { startKey: string; workingDays: number[]; fillers: Record<string, string | null | undefined> },
): PlannedTask[] {
  const roleNames = new Map(template.roles.map((r) => [r.id, r.name]));
  return template.tasks.map((t) => {
    const { day, movedFrom } = dueDayFor(startKey, t.dueOffsetDays, workingDays);
    const roleId = t.roleId && roleNames.has(t.roleId) ? t.roleId : null;
    return {
      title: t.title,
      description: t.description,
      priority: t.priority,
      dueDay: day,
      movedFrom,
      offset: t.dueOffsetDays,
      roleId,
      roleName: roleId ? roleNames.get(roleId)! : null,
      assigneeId: roleId ? fillers[roleId] ?? null : null,
      checklist: [...t.checklist],
    };
  });
}
