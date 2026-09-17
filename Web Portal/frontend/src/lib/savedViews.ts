/** The full My Tasks filter state a saved view captures. */
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
  /** True for the app-provided presets (not editable/deletable). */
  builtIn?: boolean;
}

export const EMPTY_FILTERS: TaskFilters = { project: '', status: '', priority: '', assignee: '', due: '', sort: 'due' };

/** App-provided starting points — closes the "session-only filters" gap out of the box. */
export const BUILT_IN_VIEWS: SavedView[] = [
  { id: 'builtin:overdue', name: 'My overdue', builtIn: true, filters: { ...EMPTY_FILTERS, due: 'overdue', sort: 'due' } },
  { id: 'builtin:sprint', name: 'This sprint', builtIn: true, filters: { ...EMPTY_FILTERS, due: 'week', sort: 'due' } },
  { id: 'builtin:urgent', name: 'Urgent open', builtIn: true, filters: { ...EMPTY_FILTERS, priority: 'URGENT', sort: 'due' } },
];

const KEY = 'mico360.mytasks.views';
const FIELDS: (keyof TaskFilters)[] = ['project', 'status', 'priority', 'assignee', 'due', 'sort'];
const ACTIVE_FIELDS: (keyof TaskFilters)[] = ['project', 'status', 'priority', 'assignee', 'due'];

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `view:${crypto.randomUUID()}`;
  } catch { /* fall through */ }
  return `view:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Read the user's saved custom views from localStorage (never throws). */
export function loadCustomViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is SavedView => v && typeof v.id === 'string' && typeof v.name === 'string' && v.filters)
      .map((v) => ({ id: v.id, name: v.name, filters: { ...EMPTY_FILTERS, ...v.filters } }));
  } catch {
    return [];
  }
}

function persist(views: SavedView[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch { /* storage unavailable — presets are a convenience */ }
}

/** Save (or replace-by-name) a custom view; returns the updated custom list. */
export function saveView(name: string, filters: TaskFilters): SavedView[] {
  const trimmed = name.trim();
  const views = loadCustomViews().filter((v) => v.name.toLowerCase() !== trimmed.toLowerCase());
  views.push({ id: newId(), name: trimmed, filters: { ...EMPTY_FILTERS, ...filters } });
  persist(views);
  return views;
}

/** Delete a custom view by id; returns the updated custom list. */
export function deleteView(id: string): SavedView[] {
  const views = loadCustomViews().filter((v) => v.id !== id);
  persist(views);
  return views;
}

/** Deep-compare two filter sets across every field (used to highlight the active preset). */
export function filtersEqual(a: TaskFilters, b: TaskFilters): boolean {
  return FIELDS.every((f) => a[f] === b[f]);
}

/** Whether any real filter (not sort) is applied. */
export function hasActiveFilters(f: TaskFilters): boolean {
  return ACTIVE_FIELDS.some((k) => f[k] !== '');
}
