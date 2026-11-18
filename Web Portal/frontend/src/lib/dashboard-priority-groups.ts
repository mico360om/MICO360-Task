import type { PriorityRow } from '../api/dashboard';
import { dayText } from './day-words';
import { shiftDayKey } from './due-date';

/**
 * 1.23.41 "My Priorities Today" as a compact grouped list (owner, 18 Nov 2026): the groups in the owner's
 * order — Today · Overdue · Approvals · Blocked (only if any) · Upcoming · Team — five rows each, the
 * one-line row's due words, and the Overdue group's "Move all to today" / "Reschedule…". The server still
 * decides the rows and their ranking (modules/dashboard/priorities.ts); a group keeps that order.
 */

export type PriorityGroupId = 'today' | 'overdue' | 'approvals' | 'blocked' | 'upcoming' | 'team' | 'other';

export const GROUP_ORDER: readonly PriorityGroupId[] = ['today', 'overdue', 'approvals', 'blocked', 'upcoming', 'team', 'other'];

export const GROUP_LABEL: Record<PriorityGroupId, string> = {
  today: 'Today',
  overdue: 'Overdue',
  approvals: 'Approvals',
  blocked: 'Blocked',
  upcoming: 'Upcoming',
  team: 'Team',
  other: 'Other priorities',
};

/** What an empty group says. */
export const GROUP_EMPTY: Record<PriorityGroupId, string> = {
  today: 'Nothing due today.',
  overdue: 'Nothing late.',
  approvals: 'Nothing waiting for your approval.',
  blocked: 'Nothing blocked.',
  upcoming: 'Nothing due in the next few days.',
  team: 'Nothing needs you on the team.',
  other: 'Nothing else.',
};

/** A group shows five rows, then "Show more" (five more) and "Show all N". */
export const GROUP_FIRST = 5;

/**
 * The one group a row is under: approvals by kind; other people's work (the server's Team chip) under Team;
 * otherwise the first of Today, Overdue, Blocked, Upcoming it counts under; a row with no chip ("Urgent",
 * "Blocks 2 tasks" alone) under Other priorities.
 */
export function groupOf(row: PriorityRow): PriorityGroupId {
  if (row.kind === 'approval') return 'approvals';
  if (row.chips.includes('team')) return 'team';
  for (const g of ['today', 'overdue', 'blocked', 'upcoming'] as const) if (row.chips.includes(g)) return g;
  return 'other';
}

export interface PriorityGroup {
  id: PriorityGroupId;
  label: string;
  rows: PriorityRow[];
}

/** The groups to show, in order: Blocked and Other only when they have rows, Team only for the people who run projects. */
export function groupRows(rows: readonly PriorityRow[], { manager }: { manager: boolean }): PriorityGroup[] {
  const by = new Map<PriorityGroupId, PriorityRow[]>(GROUP_ORDER.map((g) => [g, []]));
  for (const r of rows) by.get(groupOf(r))!.push(r);
  return GROUP_ORDER.filter((g) => {
    const n = by.get(g)!.length;
    if (g === 'blocked' || g === 'other') return n > 0;
    if (g === 'team') return manager || n > 0;
    return true;
  }).map((g) => ({ id: g, label: GROUP_LABEL[g], rows: by.get(g)! }));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Days between two 'YYYY-MM-DD' keys (b − a). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** A row's due day in a few words: "Today", "Tomorrow", "27 days late" (late: shown red), "Thu 20 Nov". */
export function dueLabel(due: string | null | undefined, today: string): { text: string; late: boolean } | null {
  if (!due) return null;
  const day = due.slice(0, 10);
  if (day === today) return { text: 'Today', late: false };
  if (day === shiftDayKey(today, 1)) return { text: 'Tomorrow', late: false };
  if (day < today) return { text: `${plural(daysBetween(day, today), 'day', 'days')} late`, late: true };
  return { text: dayText(day, { weekday: 'short', year: day.slice(0, 4) !== today.slice(0, 4) }), late: false };
}

/** The task number a row shows (a checklist item: its task's), or null (an action item). */
export function rowKey(row: PriorityRow): string | null {
  return row.task?.key ?? row.checklistItem?.task.key ?? null;
}

/** What the row is called: the task's title, the action item, the checklist item. */
export function rowTitle(row: PriorityRow): string {
  return row.task?.title ?? row.actionItem?.description ?? row.checklistItem?.text ?? '';
}

/** "RIG-4: Pump check" — what the tick, the title and the ⋯ menu are named after. */
export function rowName(row: PriorityRow): string {
  const key = rowKey(row);
  const title = rowTitle(row);
  return key ? `${key}: ${title}` : title;
}

/** The rows the Overdue group's "Move all" changes (the ones the person may reschedule; never an approval), and how many stay. */
export function movableOverdue(rows: readonly PriorityRow[]): { movable: PriorityRow[]; staying: number; allTasks: boolean } {
  const can = (r: PriorityRow) =>
    r.kind === 'task' ? !!r.task?.can.reschedule : r.kind === 'action-item' ? !!r.actionItem?.can.reschedule : r.kind === 'checklist-item' ? !!r.checklistItem?.can.reschedule : false;
  const movable = rows.filter(can);
  return { movable, staying: rows.length - movable.length, allTasks: movable.every((r) => r.kind === 'task') };
}

/** The confirmation: "Move 22 tasks to today? 2 you can’t change will stay." */
export function bulkConfirmText({ count, staying, allTasks, day, today }: { count: number; staying: number; allTasks: boolean; day: string; today: string }): string {
  const what = allTasks ? plural(count, 'task', 'tasks') : plural(count, 'item', 'items');
  const when = day === today ? 'today' : dayText(day, { weekday: 'short', year: day.slice(0, 4) !== today.slice(0, 4) });
  return `Move ${what} to ${when}?${staying > 0 ? ` ${staying} you can’t change will stay.` : ''}`;
}
