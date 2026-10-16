/**
 * The calendar's logic, free of React: each task's status (red is for overdue only), the items a
 * range shows (real tasks and projected copies of repeating ones), the filters (kept in the page's
 * address, so they survive switching views and a reload) and the order of a busy day.
 */
import type { ApiTask, Priority } from '../api/tasks';
import { dueDayKey } from './due-date';
import { isTaskDone } from './due-display';

export type CalStatus = 'overdue' | 'blocked' | 'in-progress' | 'todo' | 'done' | 'projected';
/** Statuses a person can filter by (a projected copy counts as "to do"). */
export const STATUS_FILTERS: Exclude<CalStatus, 'projected'>[] = ['overdue', 'todo', 'in-progress', 'blocked', 'done'];
export const PRIORITIES: Priority[] = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];

export interface CalendarOccurrence {
  taskId: string;
  seriesId: string;
  date: string;
}

export interface CalendarData {
  tasks: ApiTask[];
  occurrences: CalendarOccurrence[];
  /** The repeating tasks the occurrences come from (their newest copy). */
  series: ApiTask[];
}

export interface CalItem {
  /** Unique: the task id, or `proj:<task id>:<day>` for a projected copy. */
  key: string;
  kind: 'task' | 'projected';
  /** The task — for a projected copy, the newest copy of its series. */
  task: ApiTask;
  /** 'YYYY-MM-DD' the item sits on. */
  date: string;
  status: CalStatus;
  projectArchived: boolean;
  /** Part of a repeating series. */
  recurring: boolean;
}

export function statusOf(task: ApiTask, day: string, today: string): Exclude<CalStatus, 'projected'> {
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

const isStatus = (s: string): s is CalendarFilters['statuses'][number] => (STATUS_FILTERS as string[]).includes(s);
const isPriority = (s: string): s is Priority => (PRIORITIES as string[]).includes(s);

/** Filters as address parameters — only what differs from the defaults. */
export function filtersToParams(f: CalendarFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.projectId) p.set('project', f.projectId);
  if (f.assigneeId) p.set('assignee', f.assigneeId);
  if (f.mine) p.set('mine', '1');
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.statuses.length) p.set('status', f.statuses.join(','));
  if (f.priorities.length) p.set('priority', f.priorities.join(','));
  if (!f.showCompleted) p.set('done', '0');
  if (f.showArchived) p.set('archived', '1');
  if (!f.showProjected) p.set('repeats', '0');
  if (!f.showMeetings) p.set('meetings', '0');
  return p;
}

export function filtersFromParams(p: URLSearchParams): CalendarFilters {
  const list = (key: string) => (p.get(key) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    projectId: p.get('project') ?? '',
    assigneeId: p.get('assignee') ?? '',
    mine: p.get('mine') === '1',
    q: p.get('q') ?? '',
    statuses: list('status').filter(isStatus),
    priorities: list('priority').filter(isPriority),
    showCompleted: p.get('done') !== '0',
    showArchived: p.get('archived') === '1',
    showProjected: p.get('repeats') !== '0',
    showMeetings: p.get('meetings') !== '0',
  };
}
