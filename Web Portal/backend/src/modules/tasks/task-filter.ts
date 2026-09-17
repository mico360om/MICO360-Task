import type { TaskRecord } from './task-repository';

const PRIORITY_RANK: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 };

export const SORT_FIELDS = ['dueDate', 'priority', 'createdAt', 'updatedAt', 'title', 'position'] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export type SortOrder = 'asc' | 'desc';

export interface TaskFilterCriteria {
  /** Keyword matched against title, description and key (case-insensitive). */
  q?: string;
  /** Keep only these priorities. */
  priorities?: string[];
  /** Keep only tasks whose column category is one of these (status). */
  categories?: string[];
  /** Keep only tasks carrying at least one of these tag ids. */
  tagIds?: string[];
  /** Due on/before this instant. */
  dueBefore?: Date;
  /** Due on/after this instant. */
  dueAfter?: Date;
  /** Keep only overdue (past due + not done) tasks. */
  overdue?: boolean;
  sort?: SortField;
  order?: SortOrder;
  now?: Date;
}

function isDone(t: TaskRecord): boolean {
  return t.columnCategory === 'DONE' || t.completedAt != null;
}

function matches(t: TaskRecord, c: TaskFilterCriteria, nowMs: number): boolean {
  if (c.q) {
    const hay = `${t.title} ${t.description ?? ''} ${t.key}`.toLowerCase();
    if (!hay.includes(c.q.trim().toLowerCase())) return false;
  }
  if (c.priorities?.length && !c.priorities.includes(t.priority)) return false;
  if (c.categories?.length) {
    const cat = t.columnCategory ?? null;
    if (!cat || !c.categories.includes(cat)) return false;
  }
  if (c.tagIds?.length) {
    const ids = new Set((t.tags ?? []).map((x) => x.id));
    if (!c.tagIds.some((id) => ids.has(id))) return false;
  }
  if (c.dueBefore && (!t.dueDate || new Date(t.dueDate).getTime() > c.dueBefore.getTime())) return false;
  if (c.dueAfter && (!t.dueDate || new Date(t.dueDate).getTime() < c.dueAfter.getTime())) return false;
  if (c.overdue && !(t.dueDate && new Date(t.dueDate).getTime() < nowMs && !isDone(t))) return false;
  return true;
}

function compare(a: TaskRecord, b: TaskRecord, field: SortField): number {
  switch (field) {
    case 'priority':
      return (PRIORITY_RANK[a.priority] ?? 0) - (PRIORITY_RANK[b.priority] ?? 0);
    case 'title':
      return a.title.localeCompare(b.title);
    case 'position':
      return a.position - b.position;
    case 'dueDate':
    case 'createdAt':
    case 'updatedAt': {
      // Null due dates sort last regardless of direction is handled by the caller flipping sign;
      // here we treat missing as +Infinity so ascending puts them last.
      const av = a[field] ? new Date(a[field] as Date).getTime() : Number.POSITIVE_INFINITY;
      const bv = b[field] ? new Date(b[field] as Date).getTime() : Number.POSITIVE_INFINITY;
      return av - bv;
    }
  }
}

/**
 * Filter + sort a list of tasks by combined criteria. Pure and deterministic.
 * Filtering by project/column/assignee is done at the repository; this layer adds
 * keyword, priority, status, tag, date-range and overdue filters plus sorting.
 */
export function filterAndSortTasks(tasks: TaskRecord[], criteria: TaskFilterCriteria = {}): TaskRecord[] {
  const nowMs = (criteria.now ?? new Date()).getTime();
  const filtered = tasks.filter((t) => matches(t, criteria, nowMs));
  if (!criteria.sort) return filtered;
  const dir = criteria.order === 'desc' ? -1 : 1;
  return [...filtered].sort((a, b) => dir * compare(a, b, criteria.sort!));
}
