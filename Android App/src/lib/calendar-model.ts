/**
 * The calendar's items (5a), free of React — the website's model
 * (Web Portal/frontend/src/lib/calendar-model.ts; calendar-model.test.ts checks they agree): each
 * task's status (red is for overdue only), the items a range shows (everyone's tasks in the
 * projects you can see, and projected copies of repeating ones), the filters and the order of a
 * busy day — plus what TalkBack reads for an item and a day.
 */
import type { ApiTask, Priority } from './types';
import { dueDayKey, isTaskDone } from './due-date';
import { dayLabel } from './calendar';

/** A task as the calendar gets it: a list row, whose people come as id and name. */
export type CalendarTask = Omit<ApiTask, 'assignees'> & { assignees?: { id: string; name: string }[] };

export type CalStatus = 'overdue' | 'blocked' | 'in-progress' | 'todo' | 'done' | 'projected';
/** Statuses a person can filter by (a projected copy counts as "to do"). */
export const STATUS_FILTERS: Exclude<CalStatus, 'projected'>[] = ['overdue', 'todo', 'in-progress', 'blocked', 'done'];
export const PRIORITIES: Priority[] = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];

/** Each status in words (the website's legend), so colour is never the only sign. */
export const STATUS_LABEL: Record<CalStatus, string> = {
  overdue: 'Overdue',
  blocked: 'Blocked',
  'in-progress': 'In progress',
  todo: 'To do',
  done: 'Done',
  projected: 'Repeats (not created yet)',
};

export const PRIORITY_LABEL: Record<Priority, string> = { URGENT: 'Urgent', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };

export interface CalendarOccurrence {
  taskId: string;
  seriesId: string;
  date: string;
}

export interface CalendarData {
  tasks: CalendarTask[];
  occurrences: CalendarOccurrence[];
  /** The repeating tasks the occurrences come from (their newest copy). */
  series: CalendarTask[];
}

export interface CalItem {
  /** Unique: the task id, or `proj:<task id>:<day>` for a projected copy. */
  key: string;
  kind: 'task' | 'projected';
  /** The task — for a projected copy, the newest copy of its series. */
  task: CalendarTask;
  /** 'YYYY-MM-DD' the item sits on. */
  date: string;
  status: CalStatus;
  projectArchived: boolean;
  /** Part of a repeating series. */
  recurring: boolean;
}

export function statusOf(task: CalendarTask, day: string, today: string): Exclude<CalStatus, 'projected'> {
  if (isTaskDone(task)) return 'done';
  if (day < today) return 'overdue';
  if (task.columnCategory === 'BLOCKED') return 'blocked';
  if (task.columnCategory === 'IN_PROGRESS' || task.columnCategory === 'REVIEW') return 'in-progress';
  return 'todo';
}

interface ItemContext {
  today: string;
  timeZone: string;
  projectStatus: (projectId: string) => string | undefined;
}

const archived = (status: string | undefined) => status === 'ARCHIVED';

export function buildItems(data: CalendarData, ctx: ItemContext): CalItem[] {
  const items: CalItem[] = [];
  for (const t of data.tasks) {
    const date = dueDayKey(t.dueDate, ctx.timeZone);
    if (!date) continue;
    items.push({
      key: t.id,
      kind: 'task',
      task: t,
      date,
      status: statusOf(t, date, ctx.today),
      projectArchived: archived(ctx.projectStatus(t.projectId)),
      recurring: !!(t.recurrenceRule || t.recurrenceParentId),
    });
  }
  const heads = new Map(data.series.map((s) => [s.id, s]));
  for (const o of data.occurrences) {
    const head = heads.get(o.taskId);
    const status = head ? ctx.projectStatus(head.projectId) : undefined;
    // The server makes no copies in archived or completed projects, so none are shown for them.
    if (!head || status === 'ARCHIVED' || status === 'COMPLETED') continue;
    items.push({ key: `proj:${head.id}:${o.date}`, kind: 'projected', task: head, date: o.date, status: 'projected', projectArchived: false, recurring: true });
  }
  return items;
}

export interface CalendarFilters {
  projectId: string;
  assigneeId: string;
  mine: boolean;
  q: string;
  statuses: Exclude<CalStatus, 'projected'>[];
  priorities: Priority[];
  showCompleted: boolean;
  showArchived: boolean;
  showProjected: boolean;
  /** Meetings (in the projects you can see, or that you organize or attend). */
  showMeetings: boolean;
}

export const DEFAULT_FILTERS: CalendarFilters = {
  projectId: '',
  assigneeId: '',
  mine: false,
  q: '',
  statuses: [],
  priorities: [],
  showCompleted: true,
  showArchived: false,
  showProjected: true,
  showMeetings: true,
};

export function applyFilters(items: CalItem[], f: CalendarFilters, ctx: { myId: string }): CalItem[] {
  const q = f.q.trim().toLocaleLowerCase();
  return items.filter((i) => {
    const t = i.task;
    if (!f.showArchived && i.projectArchived) return false;
    if (!f.showCompleted && i.status === 'done') return false;
    if (!f.showProjected && i.kind === 'projected') return false;
    if (f.projectId && t.projectId !== f.projectId) return false;
    if (f.assigneeId && !(t.assignees ?? []).some((a) => a.id === f.assigneeId)) return false;
    if (f.mine && !(t.assignees ?? []).some((a) => a.id === ctx.myId)) return false;
    if (f.statuses.length && !f.statuses.includes(i.status === 'projected' ? 'todo' : i.status)) return false;
    if (f.priorities.length && !f.priorities.includes(t.priority)) return false;
    if (q && !t.title.toLocaleLowerCase().includes(q) && !t.key.toLocaleLowerCase().includes(q)) return false;
    return true;
  });
}

export function activeFilterCount(f: CalendarFilters): number {
  let n = 0;
  if (f.projectId) n++;
  if (f.assigneeId) n++;
  if (f.mine) n++;
  if (f.q.trim()) n++;
  if (f.statuses.length) n++;
  if (f.priorities.length) n++;
  if (f.showCompleted !== DEFAULT_FILTERS.showCompleted) n++;
  if (f.showArchived !== DEFAULT_FILTERS.showArchived) n++;
  if (f.showProjected !== DEFAULT_FILTERS.showProjected) n++;
  if (f.showMeetings !== DEFAULT_FILTERS.showMeetings) n++;
  return n;
}

const ORDER: Record<CalStatus, number> = { overdue: 0, blocked: 1, 'in-progress': 2, todo: 3, projected: 4, done: 5 };
const PRIORITY_RANK: Record<Priority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** Items by day, each day's most urgent first (status, then priority, then title). */
export function groupByDay(items: CalItem[]): Map<string, CalItem[]> {
  const days = new Map<string, CalItem[]>();
  for (const i of items) days.set(i.date, [...(days.get(i.date) ?? []), i]);
  for (const list of days.values()) {
    list.sort((a, b) => ORDER[a.status] - ORDER[b.status] || PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] || a.task.title.localeCompare(b.task.title));
  }
  return days;
}

/** What TalkBack reads for a task on the calendar (the website's words). */
export function itemName(item: CalItem): string {
  const t = item.task;
  const parts = [t.title];
  if (item.kind === 'projected') parts.push(`repeat, not created yet, ${dayLabel(item.date)}`);
  else parts.push(STATUS_LABEL[item.status].toLowerCase());
  if (item.kind === 'task' && item.recurring) parts.push('repeats');
  if (t.priority === 'URGENT' || t.priority === 'HIGH') parts.push(`${PRIORITY_LABEL[t.priority].toLowerCase()} priority`);
  return parts.join(', ');
}

/** The line under a task's title: its key ("Not created yet" for a projected copy), project and people. */
export function itemMeta(item: CalItem, projectName: string | undefined): string {
  const people = item.task.assignees?.map((a) => a.name).join(', ');
  return [item.kind === 'task' ? item.task.key : 'Not created yet', projectName, people].filter(Boolean).join(' · ');
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** ", 2 meetings, 3 tasks" — what a day holds, as the website's day buttons say it ('' for nothing). */
export function countLabel(tasks: number, meetings = 0): string {
  return [meetings ? plural(meetings, 'meeting', 'meetings') : '', tasks ? plural(tasks, 'task', 'tasks') : '']
    .filter(Boolean)
    .map((s) => `, ${s}`)
    .join('');
}

/** What TalkBack reads for a day of the month: 'Sat 10 Oct, today, 1 meeting, 2 tasks'. */
export function dayCellLabel(day: string, opts: { tasks: number; meetings: number; today: boolean }): string {
  const counts = countLabel(opts.tasks, opts.meetings);
  return `${dayLabel(day)}${opts.today ? ', today' : ''}${counts || ', nothing due'}`;
}
