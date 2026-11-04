import { ApiError } from './api-client';
import { readUserValue, writeUserValue } from './user-storage';

/**
 * The Table view (1.23.0): the parts of the shared table that are not drawing — how a header click
 * sorts, how rows are put in order, the filter bar's choices, how much is shown at once, what is
 * remembered for each person on each page, and the words when a quick edit can't be saved.
 */

export type SortDir = 'asc' | 'desc';
export interface SortState {
  column: string;
  dir: SortDir;
}

/**
 * A header click: a column not sorted on starts in its first direction (ascending, unless the column
 * reads better the other way round), then flips, then lets go — back to the page's usual order (null).
 */
export function nextSort(current: SortState | null, column: string, firstDir: SortDir = 'asc'): SortState | null {
  if (!current || current.column !== column) return { column, dir: firstDir };
  if (current.dir === firstDir) return { column, dir: firstDir === 'asc' ? 'desc' : 'asc' };
  return null;
}

export type SortValue = string | number | null | undefined;

const empty = (v: SortValue) => v === null || v === undefined || v === '';

/**
 * The rows in the sort's order (a new list): words A to Z ignoring case (numbers inside them as
 * numbers, "MICO-9" before "MICO-10"), numbers as numbers, empty values last whichever way. Rows that
 * compare equal keep the page's order. No sort: the page's order.
 */
export function sortRows<T>(rows: readonly T[], sort: SortState | null, valueOf: (row: T, column: string) => SortValue): T[] {
  const indexed = rows.map((row, i) => ({ row, i, v: sort ? valueOf(row, sort.column) : null }));
  if (!sort) return indexed.map((x) => x.row);
  const sign = sort.dir === 'asc' ? 1 : -1;
  indexed.sort((a, b) => {
    const ea = empty(a.v);
    const eb = empty(b.v);
    if (ea || eb) return ea === eb ? a.i - b.i : ea ? 1 : -1;
    const c =
      typeof a.v === 'number' && typeof b.v === 'number'
        ? a.v - b.v
        : String(a.v).localeCompare(String(b.v), 'en', { sensitivity: 'base', numeric: true });
    return c !== 0 ? c * sign : a.i - b.i;
  });
  return indexed.map((x) => x.row);
}

/** The table's own filter bar (pages without filters of their own: the Board page, a project's Board tab, a meeting). */
export interface TableFilters {
  /** Words in the title, or the task number (1.22.3's rule: mico 12, MICO12, #12…). */
  text: string;
  /** A status choice (a column, a stage, or OPEN_ONLY on a meeting). */
  status: string;
  /** A person's id, NO_PERSON ("Unassigned") or ME. */
  person: string;
  priority: string;
  /** '' | 'overdue' | 'today' | 'week' | 'none'. */
  due: string;
}

export const EMPTY_TABLE_FILTERS: TableFilters = { text: '', status: '', person: '', priority: '', due: '' };
/** The person filter's "Unassigned" (no owner). */
export const NO_PERSON = '__none';
/** The person filter's "Me". */
export const ME = '__me';
/** A meeting's status filter: everything not completed or cancelled. */
export const OPEN_ONLY = '__open';

export function tableFiltersActive(f: TableFilters): boolean {
  return Boolean(f.text.trim() || f.status || f.person || f.priority || f.due);
}

/** Today, and the calendar week around it (the person's week start), as 'YYYY-MM-DD' days. */
export interface DueContext {
  today: string;
  weekStart: string;
  weekEnd: string;
}

/**
 * The Due filter: Overdue (late — never while it waits for approval or once done; the caller says),
 * Today, This week (the calendar week that holds today) or No date. No choice: everything.
 */
export function dueMatches(row: { dueKey: string | null; late: boolean }, due: string, ctx: DueContext): boolean {
  if (!due) return true;
  if (due === 'overdue') return row.late;
  if (due === 'none') return !row.dueKey;
  if (!row.dueKey) return false;
  if (due === 'today') return row.dueKey === ctx.today;
  if (due === 'week') return row.dueKey >= ctx.weekStart && row.dueKey <= ctx.weekEnd;
  return true;
}

export const DUE_FILTER_OPTIONS = [
  { value: '', label: 'Any due date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Due this week' },
  { value: 'none', label: 'No due date' },
];

export const PRIORITY_FILTER_OPTIONS = [
  { value: '', label: 'Any priority' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'HIGH', label: 'High' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'LOW', label: 'Low' },
];

/** The rows shown at first, and how many more each "Show 100 more" adds. */
export const PAGE_SIZE = 100;

/** What a table remembers for a person on a page, on this device. `shown`: the optional columns shown (null: the defaults). */
export interface TableMemory {
  sort: SortState | null;
  filters: TableFilters;
  shown: string[] | null;
}

const memoryName = (page: string) => `table.${page}`;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The table's memory for this person on this page (the defaults when there is none, or it is damaged). */
export function readTableMemory(userId: string | null | undefined, page: string): TableMemory {
  const fresh: TableMemory = { sort: null, filters: { ...EMPTY_TABLE_FILTERS }, shown: null };
  const raw = readUserValue(userId, memoryName(page));
  if (!raw) return fresh;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object') return fresh;
    const s = v.sort as Record<string, unknown> | null | undefined;
    const sort: SortState | null = s && typeof s.column === 'string' && (s.dir === 'asc' || s.dir === 'desc') ? { column: s.column, dir: s.dir } : null;
    const f = (v.filters ?? {}) as Record<string, unknown>;
    const filters: TableFilters = { text: str(f.text), status: str(f.status), person: str(f.person), priority: str(f.priority), due: str(f.due) };
    const shown = Array.isArray(v.shown) ? v.shown.filter((x): x is string => typeof x === 'string') : null;
    return { sort, filters, shown };
  } catch {
    return fresh;
  }
}

export function writeTableMemory(userId: string | null | undefined, page: string, memory: TableMemory): void {
  writeUserValue(userId, memoryName(page), JSON.stringify(memory));
}

/**
 * A quick edit the server refused, or that never reached it, in the site's plain words: "Couldn’t
 * save — " and why (the server's own reason when it gave one).
 */
export function saveFailureText(err: unknown): string {
  const lead = 'Couldn’t save — ';
  if (err instanceof ApiError) {
    if (err.status === 403) return `${lead}you don’t have permission to do that.`;
    if (err.code === 'VERSION_CONFLICT') return `${lead}someone else changed it meanwhile. Try again.`;
    if (err.status >= 400 && err.status < 500 && err.message && !/^Request failed/.test(err.message)) return `${lead}${err.message}`;
    return `${lead}please try again.`;
  }
  if (err instanceof TypeError) return `${lead}check your connection and try again.`;
  return `${lead}please try again.`;
}
