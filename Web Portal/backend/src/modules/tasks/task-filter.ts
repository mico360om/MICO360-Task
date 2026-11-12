import type { TaskRecord } from './task-repository';
import { defaultCompanyTimeZone, isTaskLate } from './task-status';
import { matchesNormalized, normalizeForSearch } from '../search/text-normalize';
import { hasExternalCompany } from './external-contacts';
import { hasGuest, hasGuestCompany } from './guest-contacts';
import { hasAnyCategory } from './task-categories';
import { matchesTaskNumber } from '../../lib/task-number';

const PRIORITY_RANK: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 };

export const SORT_FIELDS = ['dueDate', 'priority', 'createdAt', 'updatedAt', 'title', 'position'] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export type SortOrder = 'asc' | 'desc';

export interface TaskFilterCriteria {
  /**
   * Keyword matched against title, description, key and external contacts' names and companies
   * (case-insensitive, Arabic-variant aware) — or the task's number (now or old) however it is
   * typed: "mico 142", "MICO142", "MICO_142" (1.22.3, lib/task-number).
   */
  q?: string;
  /** Keep only tasks with an external contact from this company (case and extra spaces aside). */
  externalCompany?: string;
  /** 1.24: keep only tasks with one of these guests. */
  guestIds?: string[];
  /** 1.24: keep only tasks with a guest from this company (case, spaces and accents aside). */
  guestCompany?: string;
  /** 1.24: keep only tasks with one of these task categories (not `categories`, which are column stages). */
  categoryIds?: string[];
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
  /** Keep only overdue tasks (due day before today in the company time zone, not done, not waiting for approval). */
  overdue?: boolean;
  sort?: SortField;
  order?: SortOrder;
  now?: Date;
  /** Company time zone that defines "today" for the overdue filter. */
  timeZone?: string;
}

function matches(t: TaskRecord, c: TaskFilterCriteria, q: string, now: Date, timeZone: string): boolean {
  const words = [...(t.externalSummary?.names ?? []), ...(t.externalSummary?.companies ?? []), ...(t.guests ?? []).flatMap((g) => [g.name, g.company ?? '']), ...(t.categories ?? []).map((x) => x.name)];
  if (q && !matchesNormalized(q, t.title, t.description, t.key, ...words) && !matchesTaskNumber(q, t.key, t.formerKeys)) return false;
  if (c.externalCompany?.trim() && !hasExternalCompany(t.externalSummary, c.externalCompany)) return false;
  if (c.guestIds?.length && !c.guestIds.some((id) => hasGuest(t.guests, id))) return false;
  if (c.guestCompany?.trim() && !hasGuestCompany(t.guests, c.guestCompany)) return false;
  if (c.categoryIds?.length && !hasAnyCategory(t.categories, c.categoryIds)) return false;
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
  if (c.overdue && !isTaskLate(t, timeZone, now)) return false;
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
  const now = criteria.now ?? new Date();
  const timeZone = criteria.timeZone ?? defaultCompanyTimeZone();
  const q = normalizeForSearch(criteria.q);
  const filtered = tasks.filter((t) => matches(t, criteria, q, now, timeZone));
  if (!criteria.sort) return filtered;
  const dir = criteria.order === 'desc' ? -1 : 1;
  return [...filtered].sort((a, b) => dir * compare(a, b, criteria.sort!));
}
