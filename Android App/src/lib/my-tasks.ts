/**
 * My Tasks (4d), as the website's page (Web Portal/frontend/src/pages/MyTasksPage.tsx and
 * lib/savedViews.ts): everything assigned to you across every project, with its project, status,
 * priority, due day (company time — a task due today is never overdue; finished work never is),
 * progress and people. Filters by project, status (or "Open"), priority, assignee and due date;
 * the All / Open / Overdue / Completed chips; four sorts; saved views (the website's three, and
 * your own, kept on this phone); and a selection for bulk actions that covers only what is shown.
 * Pure, so it is tested here (my-tasks.test.ts checks the words against the website).
 */
import { STATUS_NAME, STATUS_ORDER } from './all-board';
import { shiftDayKey } from './calendar';
import { companyTodayKey, dueDayKey, isTaskDone } from './due-date';
import { dateFormat } from './intl-cache';
import type { ApiProject, ApiTask, ColumnCategory, Priority } from './types';

/** The full filter state a saved view keeps. */
export interface TaskFilters {
  project: string;
  status: string;
  priority: string;
  assignee: string;
  due: string;
  sort: string;
}

export interface SavedView {
  id: string;
  name: string;
  filters: TaskFilters;
  /** The website's own starting points (not deleted). */
  builtIn?: boolean;
}

/** The status filter's "everything not completed". */
export const OPEN_STATUS = 'OPEN';

export const EMPTY_FILTERS: TaskFilters = { project: '', status: '', priority: '', assignee: '', due: '', sort: 'due' };

export const BUILT_IN_VIEWS: SavedView[] = [
  { id: 'builtin:overdue', name: 'My overdue', builtIn: true, filters: { ...EMPTY_FILTERS, due: 'overdue', sort: 'due' } },
  { id: 'builtin:sprint', name: 'This sprint', builtIn: true, filters: { ...EMPTY_FILTERS, due: 'week', sort: 'due' } },
  { id: 'builtin:urgent', name: 'Urgent open', builtIn: true, filters: { ...EMPTY_FILTERS, status: OPEN_STATUS, priority: 'URGENT', sort: 'due' } },
];

export const SORT_OPTIONS = [
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'progress', label: 'Progress' },
  { value: 'title', label: 'Title (A–Z)' },
];

export const DUE_OPTIONS = [
  { value: '', label: 'Any due date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'none', label: 'No due date' },
];

export const PRIORITY_OPTIONS = [
  { value: '', label: 'All priorities' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'HIGH', label: 'High' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'LOW', label: 'Low' },
];

/** The page's words (the website's, checked by the test). */
export const MY_TASKS_TEXT = {
  subtitle: 'Everything assigned to you, across every project.',
  emptyTitle: 'No tasks assigned to you',
  emptyText: 'When a task is assigned to you it shows up here — across every project.',
  noMatchTitle: 'No tasks match these filters',
  noMatchText: 'Try widening your filters to see more of your work.',
} as const;

export interface MyTaskRow {
  task: ApiTask;
  /** Its status (column kind; To Do when the server names none). */
  cat: string;
  done: boolean;
  overdue: boolean;
  dueToday: boolean;
  dueKey: string | null;
  /** The due day, short ("Oct 20"); '' with none. */
  dueLabel: string;
  project: ApiProject | null;
}

const P_RANK: Record<Priority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const PRIORITY_WORD: Record<Priority, string> = { URGENT: 'Urgent', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };

type When = { timeZone: string; now?: Date };

export function enrichMyTasks(tasks: readonly ApiTask[], projects: readonly ApiProject[], o: When): MyTaskRow[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const today = companyTodayKey(o.now ?? new Date(), o.timeZone);
  const day = dateFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (Array.isArray(tasks) ? tasks : []).map((task) => {
    const done = isTaskDone(task);
    const dueKey = dueDayKey(task.dueDate, o.timeZone);
    return {
      task,
      cat: task.columnCategory ?? 'TODO',
      done,
      overdue: !!dueKey && dueKey < today && !done,
      dueToday: !!dueKey && dueKey === today,
      dueKey,
      dueLabel: dueKey ? day.format(new Date(`${dueKey}T12:00:00.000Z`)) : '',
      project: byId.get(task.projectId) ?? null,
    };
  });
}

export function myTaskCounts(rows: readonly MyTaskRow[]): { total: number; open: number; overdue: number; done: number } {
  let open = 0;
  let overdue = 0;
  let done = 0;
  for (const r of rows) {
    if (r.done) done += 1;
    else open += 1;
    if (r.overdue) overdue += 1;
  }
  return { total: rows.length, open, overdue, done };
}

/** The filters (and this app's search box, over title, key and description). */
export function filterMyTasks(rows: readonly MyTaskRow[], f: TaskFilters, o: When & { q?: string }): MyTaskRow[] {
  const today = companyTodayKey(o.now ?? new Date(), o.timeZone);
  const week = shiftDayKey(today, 7);
  const needle = (o.q ?? '').trim().toLowerCase();
  return rows.filter((e) => {
    if (f.project && e.task.projectId !== f.project) return false;
    if (f.status === OPEN_STATUS ? e.done : f.status && e.cat !== f.status) return false;
    if (f.priority && e.task.priority !== f.priority) return false;
    if (f.assignee && !(e.task.assignees ?? []).some((a) => a.id === f.assignee)) return false;
    if (f.due === 'overdue' && !e.overdue) return false;
    if (f.due === 'today' && !e.dueToday) return false;
    if (f.due === 'week' && !(e.dueKey && e.dueKey >= today && e.dueKey <= week)) return false;
    if (f.due === 'none' && e.task.dueDate) return false;
    if (needle && !`${e.task.title} ${e.task.description ?? ''} ${e.task.key}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export function sortMyTasks(rows: readonly MyTaskRow[], sort: string): MyTaskRow[] {
  return [...rows].sort((a, b) => {
    if (sort === 'priority') return P_RANK[a.task.priority] - P_RANK[b.task.priority];
    if (sort === 'progress') return b.task.progress - a.task.progress;
    if (sort === 'title') return a.task.title.localeCompare(b.task.title);
    if (a.dueKey && b.dueKey) return a.dueKey < b.dueKey ? -1 : a.dueKey > b.dueKey ? 1 : 0;
    if (a.dueKey) return -1;
    if (b.dueKey) return 1;
    return 0;
  });
}

export interface Option {
  value: string;
  label: string;
}

/** The projects my tasks are in. */
export function projectFilterOptions(tasks: readonly ApiTask[], projects: readonly ApiProject[]): Option[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const ids = [...new Set(tasks.map((t) => t.projectId))];
  return [{ value: '', label: 'All projects' }, ...ids.map((id) => ({ value: id, label: byId.get(id)?.name ?? 'Project' }))];
}

/** "Open", then the statuses my tasks are in, in the board's order. */
export function statusFilterOptions(rows: readonly MyTaskRow[]): Option[] {
  const present = new Set(rows.map((r) => r.cat));
  return [
    { value: '', label: 'All statuses' },
    { value: OPEN_STATUS, label: 'Open (not completed)' },
    ...STATUS_ORDER.filter((c) => present.has(c)).map((c) => ({ value: c, label: STATUS_NAME[c as ColumnCategory] })),
  ];
}

/** The people on my tasks. */
export function assigneeFilterOptions(tasks: readonly ApiTask[]): Option[] {
  const m = new Map<string, string>();
  for (const t of tasks) for (const a of (t.assignees ?? []) as unknown as { id: string; name: string }[]) m.set(a.id, a.name);
  return [{ value: '', label: 'Anyone' }, ...[...m].map(([value, label]) => ({ value, label }))];
}

const ACTIVE: (keyof TaskFilters)[] = ['project', 'status', 'priority', 'assignee', 'due'];
const FIELDS: (keyof TaskFilters)[] = [...ACTIVE, 'sort'];

/** Is any real filter (not the sort) on? */
export function filtersActive(f: TaskFilters): boolean {
  return ACTIVE.some((k) => f[k] !== '');
}

export function filtersEqual(a: TaskFilters, b: TaskFilters): boolean {
  return FIELDS.every((k) => a[k] === b[k]);
}

export type Chip = 'all' | 'open' | 'overdue' | 'completed';

/** A chip tapped: All clears the filters (the sort stays); the others turn on, or off again. */
export function toggleChip(f: TaskFilters, chip: Chip): TaskFilters {
  switch (chip) {
    case 'all':
      return { ...f, project: '', status: '', priority: '', assignee: '', due: '' };
    case 'open':
      return { ...f, status: f.status === OPEN_STATUS ? '' : OPEN_STATUS };
    case 'overdue':
      return { ...f, due: f.due === 'overdue' ? '' : 'overdue' };
    case 'completed':
      return { ...f, status: f.status === 'DONE' ? '' : 'DONE' };
  }
}

export function chipState(f: TaskFilters): Record<Chip, boolean> {
  return { all: !filtersActive(f), open: f.status === OPEN_STATUS, overdue: f.due === 'overdue', completed: f.status === 'DONE' };
}

/** "Showing 3 of 10 tasks" (with filters), "Showing 10 tasks". */
export function showingText(shown: number, total: number, active: boolean): string {
  return `Showing ${shown}${active ? ` of ${total}` : ''} task${shown === 1 ? '' : 's'}`;
}

/** The due day as the website's row says it. */
export function dueLabel(r: MyTaskRow): string {
  if (!r.task.dueDate) return 'No due date';
  if (r.overdue) return `Overdue · ${r.dueLabel}`;
  if (r.dueToday) return 'Due today';
  return r.dueLabel;
}

/** One task, in words, for TalkBack. */
export function myTaskLabel(r: MyTaskRow): string {
  const people = ((r.task.assignees ?? []) as unknown as { name: string }[]).map((a) => a.name);
  return [
    `${r.task.key}, ${r.task.title}.`,
    r.project ? `${r.project.name}.` : null,
    `${STATUS_NAME[r.cat as ColumnCategory] ?? r.cat}.`,
    `${PRIORITY_WORD[r.task.priority] ?? r.task.priority} priority.`,
    `${dueLabel(r)}.`,
    r.done ? 'Done.' : `${r.task.progress}% done.`,
    people.length ? `${people.join(', ')}.` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/** The selected tasks among those shown (a hidden one is never acted on by surprise). */
export function selectedOf(shown: readonly MyTaskRow[], selected: ReadonlySet<string>): MyTaskRow[] {
  return shown.filter((r) => selected.has(r.task.id));
}

/** "Select all": every shown task, or none when they all are. */
export function toggleAllVisible(shown: readonly MyTaskRow[], selected: ReadonlySet<string>): Set<string> {
  const all = shown.length > 0 && shown.every((r) => selected.has(r.task.id));
  return all ? new Set() : new Set(shown.map((r) => r.task.id));
}

// ── Saved views, kept on this phone per person ───────────────────────────────

export function savedViewsKey(userId: string): string {
  return `mico360.mytasks.views.${userId}`;
}

/** Your views as kept (anything unreadable is left out). */
export function readSavedViews(raw: string | null | undefined): SavedView[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is SavedView => !!v && typeof v.id === 'string' && typeof v.name === 'string' && !!v.filters && typeof v.filters === 'object')
      .map((v) => ({ id: v.id, name: v.name, filters: { ...EMPTY_FILTERS, ...v.filters } }));
  } catch {
    return [];
  }
}

/** Save a view (one with the same name, any case, is replaced). */
export function withSavedView(views: readonly SavedView[], name: string, filters: TaskFilters, newId: () => string): SavedView[] {
  const trimmed = name.trim();
  return [...views.filter((v) => v.name.toLowerCase() !== trimmed.toLowerCase()), { id: newId(), name: trimmed, filters: { ...EMPTY_FILTERS, ...filters } }];
}

export function withoutView(views: readonly SavedView[], id: string): SavedView[] {
  return views.filter((v) => v.id !== id);
}
