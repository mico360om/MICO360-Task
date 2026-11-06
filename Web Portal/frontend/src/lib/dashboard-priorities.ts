import { PRIORITY_CHIPS, type PriorityChip, type PriorityReason, type PriorityRow, type PriorityTask, type ReschedulePatch } from '../api/dashboard';
import { dayText } from './day-words';
import { shiftDayKey } from './due-date';
import type { WeekStart } from './calendar';

/**
 * 1.23.4 Smarter Dashboard — "My Priorities Today" in words: each row's reasons, the filter chips, the
 * first ten, Reschedule's quick days, and what a reschedule (and its Undo) sends. The server decides the
 * rows and their order (modules/dashboard/priorities.ts); this only says them.
 */

export const PRIORITIES_TITLE = 'My Priorities Today';
export const PRIORITIES_EMPTY = 'Nothing urgent — you’re clear for today.';
export const PRIORITIES_CHIP_EMPTY = 'Nothing here right now.';
/** The list shows the first ten, then "Show all (23)". */
export const SHOWN_FIRST = 10;

export const CHIP_LABEL: Record<'all' | PriorityChip, string> = {
  all: 'All',
  overdue: 'Overdue',
  today: 'Today',
  approvals: 'Approvals',
  blocked: 'Blocked',
  upcoming: 'Upcoming',
  team: 'Team',
};

/** The chips above the list: Team only for administrators and the people who run projects. */
export function chipsShown(manager: boolean): ('all' | PriorityChip)[] {
  return ['all', ...PRIORITY_CHIPS.filter((c) => manager || c !== 'team')];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Whose a team row is: "Omar Ahmed", "Omar Ahmed +1". */
function whose(people: readonly { id?: string; name: string }[] | undefined): string {
  if (!people || people.length === 0) return '';
  return ` · ${people[0]!.name}${people.length > 1 ? ` +${people.length - 1}` : ''}`;
}

/** One reason in words ("Overdue 2 days", "Blocked by RIG-4"); a team row's names its people. */
export function reasonText(r: PriorityReason, assignees?: readonly { id?: string; name: string }[]): string {
  switch (r.code) {
    case 'overdue':
      return `Overdue ${plural(r.days, 'day', 'days')}`;
    case 'approval':
      return 'Waiting for your approval';
    case 'blocking':
      return `Blocks ${plural(r.count, 'task', 'tasks')}`;
    case 'due-today':
      return 'Due today';
    case 'urgent':
      return 'Urgent';
    case 'team-overdue':
      return `Overdue ${plural(r.days, 'day', 'days')}${whose(assignees)}`;
    case 'team-blocked':
      return `Blocked (status)${whose(assignees)}`;
    case 'unassigned':
      return 'No one assigned';
    case 'blocked-status':
      return 'Blocked (status)';
    case 'blocked-by': {
      const [first, ...rest] = r.blockers;
      return `Blocked by ${first?.key ?? 'another task'}${rest.length ? ` and ${rest.length} more` : ''}`;
    }
    case 'due-soon':
      return r.days === 1 ? 'Due tomorrow' : `Due in ${r.days} days`;
  }
}

/** A row's reasons in words: the strongest first, then the small tags. */
export function tagsOf(row: PriorityRow): string[] {
  return [row.reason, ...row.also].map((r) => reasonText(r, row.task?.assignees));
}

/** How a reason looks: late and blocked in red, approvals and today in amber, the rest quiet. */
export function reasonTone(r: PriorityReason): 'danger' | 'warning' | 'info' | 'neutral' {
  if (r.code === 'overdue' || r.code === 'team-overdue' || r.code === 'blocked-by' || r.code === 'blocked-status' || r.code === 'team-blocked') return 'danger';
  if (r.code === 'approval' || r.code === 'due-today' || r.code === 'urgent') return 'warning';
  if (r.code === 'blocking' || r.code === 'unassigned') return 'info';
  return 'neutral';
}

/** The rows a chip shows, the first ten unless all are asked for. */
export function rowsFor(rows: readonly PriorityRow[], chip: 'all' | PriorityChip, all: boolean): PriorityRow[] {
  const kept = chip === 'all' ? [...rows] : rows.filter((r) => r.chips.includes(chip));
  return all ? kept : kept.slice(0, SHOWN_FIRST);
}

/** The first day of next week in the company week (on the week's first day itself: a week later). */
export function nextWeekStart(today: string, weekStart: WeekStart): string {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const ahead = (weekStart - dow + 7) % 7 || 7;
  return shiftDayKey(today, ahead);
}

/** Reschedule's quick days: Today, Tomorrow, Next week — each with its day in words. */
export function rescheduleChoices(today: string, weekStart: WeekStart): { label: string; day: string; hint: string }[] {
  const at = (label: string, day: string) => ({ label, day, hint: dayText(day, { weekday: 'short', year: false }) });
  return [at('Today', today), at('Tomorrow', shiftDayKey(today, 1)), at('Next week', nextWeekStart(today, weekStart))];
}

/**
 * A task's reschedule from the copy the row shows: the new due day; a start date after it moves to it
 * (the start ≤ due rule); a repeating task's newest copy moves only this occurrence (the calendar's "This
 * occurrence": the rule notes the day it replaced). `undo(version)` puts all of it back, from the saved copy.
 */
export function planTaskReschedule(task: PriorityTask, toDay: string): { patch: ReschedulePatch; undo: (version: number) => ReschedulePatch } {
  const patch: ReschedulePatch = { dueDate: toDay };
  const back: ReschedulePatch = { dueDate: task.dueDate };
  if (task.startDate && task.startDate > toDay) {
    patch.startDate = toDay;
    back.startDate = task.startAt;
  }
  if (task.recurrenceRule && task.dueDate) {
    patch.recurrenceRule = { ...task.recurrenceRule, resumeFrom: task.recurrenceRule.resumeFrom ?? task.dueDate };
    back.recurrenceRule = task.recurrenceRule;
  }
  return { patch: { ...patch, expectedVersion: task.version }, undo: (version) => ({ ...back, expectedVersion: version }) };
}
