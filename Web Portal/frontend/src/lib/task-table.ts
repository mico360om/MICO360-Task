import type { ApiTask } from '../api/tasks';
import { dueMatches, ME, NO_PERSON, type DueContext, type SortState, type SortValue, type TableFilters } from './data-table';
import { dueDayKey } from './due-date';
import { isTaskLate } from './due-display';
import { matchesTaskNumber } from './task-number';
import { projectReadOnly, type ProjectReadOnly } from './project-archive';

/**
 * Task tables (1.23.0: the project's Tasks and Board tabs, My Tasks, the Board page): how a task row
 * is filtered and sorted, which rows may be changed, and how My Tasks' Sort menu and the table's
 * headers are the same sort.
 */

export interface TaskStatus {
  /** What the status filter matches: a column id (one project), else a stage. */
  value: string;
  label: string;
  /** Its place in the board's order (columns, or the six stages). */
  rank: number;
}

export interface TaskTableContext extends DueContext {
  timeZone: string;
  myId?: string | null;
  statusOf: (task: ApiTask) => TaskStatus;
  projectName?: (task: ApiTask) => string;
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** The table's own filters on top of what the page shows (text, status, person, priority, due). */
export function filterTaskRows(tasks: readonly ApiTask[], f: TableFilters, ctx: TaskTableContext): ApiTask[] {
  const words = f.text.trim().toLocaleLowerCase('en');
  return tasks.filter((t) => {
    if (words && !(t.title.toLocaleLowerCase('en').includes(words) || t.key.toLocaleLowerCase('en').includes(words) || matchesTaskNumber(words, t.key, t.formerKeys))) return false;
    if (f.status && ctx.statusOf(t).value !== f.status) return false;
    const people = t.assignees ?? [];
    if (f.person === NO_PERSON ? people.length > 0 : f.person === ME ? !people.some((a) => a.id === ctx.myId) : f.person && !people.some((a) => a.id === f.person)) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.due && !dueMatches({ dueKey: dueDayKey(t.dueDate, ctx.timeZone), late: isTaskLate(t, ctx.timeZone) }, f.due, ctx)) return false;
    return true;
  });
}

/** What a task row is put in order by, for each sortable column. */
export function taskSortValue(t: ApiTask, column: string, ctx: TaskTableContext): SortValue {
  switch (column) {
    case 'key':
      return t.key;
    case 'title':
      return t.title;
    case 'project':
      return ctx.projectName?.(t) ?? '';
    case 'assignee':
      return t.assignees?.[0]?.name ?? '';
    case 'priority':
      return PRIORITY_RANK[t.priority] ?? 9;
    case 'due':
      return dueDayKey(t.dueDate, ctx.timeZone);
    case 'start':
      return dueDayKey(t.startDate, ctx.timeZone);
    case 'status':
      return ctx.statusOf(t).rank;
    case 'progress':
      return t.progress ?? 0;
    default:
      return null;
  }
}

/** My Tasks' Sort menu choices, and which way each has always gone (Progress: most done first). */
const MY_TASKS_FIRST: Record<string, 'asc' | 'desc'> = { due: 'asc', priority: 'asc', progress: 'desc', title: 'asc' };
/** Columns the table sorts by that the menu doesn't list. */
const TABLE_ONLY = new Set(['key', 'status', 'project', 'assignee', 'start']);

/** The direction a My Tasks column starts in when its header is clicked. */
export const myTasksFirstDir = (column: string): 'asc' | 'desc' => MY_TASKS_FIRST[column] ?? 'asc';

/**
 * My Tasks' sort value ('due', 'title', 'title:desc', 'status'…) as the table's sort. Today's values
 * keep their meaning (saved views go on working); anything unknown is the usual order, Due date.
 */
export function myTasksSort(value: string): SortState {
  const [column = '', way] = value.split(':');
  if (!(column in MY_TASKS_FIRST) && !TABLE_ONLY.has(column)) return { column: 'due', dir: 'asc' };
  const first = myTasksFirstDir(column);
  const dir = way === 'asc' || way === 'desc' ? way : first;
  return { column, dir };
}

/** A header click on My Tasks back as the page's sort value (letting go: Due date, its usual order). */
export function myTasksSortValue(sort: SortState | null): string {
  if (!sort) return 'due';
  return sort.dir === myTasksFirstDir(sort.column) ? sort.column : `${sort.column}:${sort.dir}`;
}

/** Each column's words in the Sort menu: its name, then its first way and the other way round. */
const SORT_WORDS: Record<string, [string, string, string]> = {
  due: ['Due date', '', ' (latest first)'],
  priority: ['Priority', '', ' (lowest first)'],
  progress: ['Progress', '', ' (least first)'],
  title: ['Title', ' (A–Z)', ' (Z–A)'],
  key: ['Number', '', ' (highest first)'],
  status: ['Status', '', ' (reversed)'],
  project: ['Project', ' (A–Z)', ' (Z–A)'],
  assignee: ['Assignee', ' (A–Z)', ' (Z–A)'],
  start: ['Start date', '', ' (latest first)'],
};

/** A My Tasks sort value in the Sort menu's words ("Title (Z–A)", "Due date (latest first)"). */
export function myTasksSortLabel(value: string): string {
  const s = myTasksSort(value);
  const [name, first, other] = SORT_WORDS[s.column] ?? ['Due date', '', ' (latest first)'];
  return name + (s.dir === myTasksFirstDir(s.column) ? first : other);
}

/**
 * May this row be changed in the table? Today's rule (owner, 5 Nov): anyone on a project may change
 * any of its tasks — so yes, unless the whole table is read-only, its project is archived or
 * completed, or the page doesn't know its project (never offer an edit the server would refuse).
 */
export function taskRowEditable(project: { status: string; archived?: boolean } | undefined, tableReadOnly: ProjectReadOnly | null): boolean {
  if (tableReadOnly) return false;
  if (!project) return false;
  return projectReadOnly(project) === null;
}
