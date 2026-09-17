import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { tasksApi, type ApiTask, type Priority } from '../api/tasks';
import { projectsApi } from '../api/projects';
import { columnsApi, type ApiColumn } from '../api/columns';
import { assigneesApi } from '../api/assignees';
import { usersApi } from '../api/users';
import { TaskDrawerContainer } from '../components/TaskDrawerContainer';
import { SavedViewsBar } from '../components/SavedViewsBar';
import { BulkActionBar } from '../components/BulkActionBar';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';
import { PriorityBadge } from '../components/ui/PriorityBadge';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { NewTaskButton } from '../components/NewTaskButton';
import { statusMeta, STATUS_ORDER } from '../lib/taskStatus';
import { runBulk, type BulkAction, type BulkDeps } from '../lib/bulkActions';
import { type TaskFilters } from '../lib/savedViews';

const CheckIcon = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

const pad = (n: number) => String(n).padStart(2, '0');
const dayKeyOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const nowD = () => new Date();
const todayKey = () => { const d = nowD(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const plus7Key = () => { const d = nowD(); d.setDate(d.getDate() + 7); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDue = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
const P_RANK: Record<Priority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

type View = 'grid' | 'list';
type Sort = 'due' | 'priority' | 'progress' | 'title';
const SORT_OPTIONS = [
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'progress', label: 'Progress' },
  { value: 'title', label: 'Title (A–Z)' },
];
const DUE_OPTIONS = [
  { value: '', label: 'Any due date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'none', label: 'No due date' },
];

interface Enriched {
  task: ApiTask;
  cat: string;
  done: boolean;
  overdue: boolean;
  dueToday: boolean;
  dueKey: string | null;
  projectName: string | null;
}

export function MyTasksPage() {
  const tasksQ = useQuery({ queryKey: ['my-tasks'], queryFn: () => tasksApi(apiClient).mine() });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const tasks = useMemo(() => (Array.isArray(tasksQ.data) ? tasksQ.data : []), [tasksQ.data]);
  const projects = useMemo(() => (Array.isArray(projectsQ.data) ? projectsQ.data : []), [projectsQ.data]);

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [project, setProject] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [sort, setSort] = useState<Sort>('due');
  const [view, setView] = useState<View>(() => {
    try { return (localStorage.getItem('mico360.mytasks.view') as View) || 'grid'; } catch { return 'grid'; }
  });
  useEffect(() => { try { localStorage.setItem('mico360.mytasks.view', view); } catch { /* ignore */ } }, [view]);

  // Bulk selection + async bulk-action plumbing.
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const directoryQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const enriched = useMemo<Enriched[]>(() => {
    const tKey = todayKey();
    return tasks.map((task) => {
      const cat = task.columnCategory ?? 'TODO';
      const done = task.completedAt != null || cat === 'DONE';
      const dueKey = task.dueDate ? dayKeyOf(task.dueDate) : null;
      const overdue = !!dueKey && dueKey < tKey && !done;
      const dueToday = !!dueKey && dueKey === tKey;
      return { task, cat, done, overdue, dueToday, dueKey, projectName: projectById.get(task.projectId)?.name ?? null };
    });
  }, [tasks, projectById]);

  // Filter option sources.
  const projectOptions = useMemo(() => {
    const ids = [...new Set(tasks.map((t) => t.projectId))];
    return [
      { value: '', label: 'All projects' },
      ...ids.map((id) => ({ value: id, label: projectById.get(id)?.name ?? 'Project', hint: projectById.get(id)?.code })),
    ];
  }, [tasks, projectById]);
  const statusOptions = useMemo(() => {
    const present = new Set(enriched.map((e) => e.cat));
    return [{ value: '', label: 'All statuses' }, ...STATUS_ORDER.filter((c) => present.has(c)).map((c) => ({ value: c, label: statusMeta(c).label }))];
  }, [enriched]);
  const priorityOptions = [
    { value: '', label: 'All priorities' },
    { value: 'URGENT', label: 'Urgent' },
    { value: 'HIGH', label: 'High' },
    { value: 'NORMAL', label: 'Normal' },
    { value: 'LOW', label: 'Low' },
  ];
  const assigneeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) for (const a of t.assignees ?? []) m.set(a.id, a.name);
    return [{ value: '', label: 'Anyone' }, ...[...m].map(([value, label]) => ({ value, label }))];
  }, [tasks]);

  const filtered = useMemo(() => {
    const tK = todayKey();
    const wK = plus7Key();
    return enriched.filter((e) => {
      if (project && e.task.projectId !== project) return false;
      if (status && e.cat !== status) return false;
      if (priority && e.task.priority !== priority) return false;
      if (assignee && !(e.task.assignees ?? []).some((a) => a.id === assignee)) return false;
      if (due === 'overdue' && !e.overdue) return false;
      if (due === 'today' && !e.dueToday) return false;
      if (due === 'week' && !(e.dueKey && e.dueKey >= tK && e.dueKey <= wK)) return false;
      if (due === 'none' && e.task.dueDate) return false;
      return true;
    });
  }, [enriched, project, status, priority, assignee, due]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sort === 'due') {
        if (a.dueKey && b.dueKey) return a.dueKey < b.dueKey ? -1 : a.dueKey > b.dueKey ? 1 : 0;
        if (a.dueKey) return -1;
        if (b.dueKey) return 1;
        return 0;
      }
      if (sort === 'priority') return P_RANK[a.task.priority] - P_RANK[b.task.priority];
      if (sort === 'progress') return b.task.progress - a.task.progress;
      return a.task.title.localeCompare(b.task.title);
    });
    return arr;
  }, [filtered, sort]);

  const counts = useMemo(() => {
    let open = 0, overdue = 0, done = 0;
    for (const e of enriched) {
      if (e.done) done += 1; else open += 1;
      if (e.overdue) overdue += 1;
    }
    return { total: enriched.length, open, overdue, done };
  }, [enriched]);

  const filtersActive = !!(project || status || priority || assignee || due);
  const clearFilters = () => { setProject(''); setStatus(''); setPriority(''); setAssignee(''); setDue(''); };

  // Saved views: snapshot the filter state and apply a preset back onto it.
  const currentFilters: TaskFilters = { project, status, priority, assignee, due, sort };
  const applyView = (f: TaskFilters) => {
    setProject(f.project); setStatus(f.status); setPriority(f.priority); setAssignee(f.assignee); setDue(f.due);
    setSort((f.sort as Sort) || 'due');
  };

  // Selection scoped to what's currently visible, so hidden tasks are never acted on by surprise.
  const selectedList = useMemo(() => sorted.filter((e) => selected.has(e.task.id)), [sorted, selected]);
  const toggleSelect = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clearSelection = () => setSelected(new Set());
  const allVisibleSelected = sorted.length > 0 && selectedList.length === sorted.length;
  const toggleSelectAll = () => setSelected(allVisibleSelected ? new Set() : new Set(sorted.map((e) => e.task.id)));

  // Bulk actions reuse the single-task endpoints (each already object-level authorized).
  const colCache = useRef(new Map<string, Promise<ApiColumn[]>>());
  const getColumns = (projectId: string) => {
    let p = colCache.current.get(projectId);
    if (!p) { p = columnsApi(apiClient).list(projectId); colCache.current.set(projectId, p); }
    return p;
  };
  const bulkDeps: BulkDeps = {
    update: (id, patch) => tasksApi(apiClient).update(id, patch),
    move: (id, columnId) => tasksApi(apiClient).move(id, columnId),
    assign: (id, userId) => assigneesApi(apiClient).assign(id, userId),
    doneColumnFor: async (t) => {
      const cols = await getColumns(t.projectId);
      const done = cols.find((c) => c.category === 'DONE' && c.enabled) ?? cols.find((c) => c.category === 'DONE');
      return done?.id ?? null;
    },
  };
  async function runBulkAction(action: BulkAction, label: string) {
    const refs = selectedList.map((e) => ({ id: e.task.id, projectId: e.task.projectId }));
    if (refs.length === 0) return;
    setBulkBusy(true);
    setToast(null);
    try {
      const res = await runBulk(refs, action, bulkDeps);
      colCache.current.clear();
      await qc.invalidateQueries({ queryKey: ['my-tasks'] });
      setSelected(new Set());
      setToast(res.failed === 0 ? `${label} ${res.succeeded} task${res.succeeded === 1 ? '' : 's'}.` : `${label} ${res.succeeded}, ${res.failed} couldn’t be updated.`);
    } catch {
      setToast('Bulk action failed. Please try again.');
    } finally {
      setBulkBusy(false);
    }
  }
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  // Assignable people (directory) + move targets (only when a single project is pinned).
  const directory = Array.isArray(directoryQ.data) ? directoryQ.data : [];
  const assigneeChoices = directory.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username }));
  const moveColumnsQ = useQuery({
    queryKey: ['columns', project],
    queryFn: () => columnsApi(apiClient).list(project),
    enabled: !!project,
  });
  const moveColumns = project && Array.isArray(moveColumnsQ.data)
    ? [...moveColumnsQ.data].filter((c) => c.enabled).sort((a, b) => a.position - b.position).map((c) => ({ value: c.id, label: c.name }))
    : undefined;

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="My Tasks"
        subtitle="Everything assigned to you, across every project."
        actions={<NewTaskButton onCreated={() => tasksQ.refetch()} />}
      />

      {/* Saved filter presets */}
      {counts.total > 0 ? <SavedViewsBar current={currentFilters} onApply={applyView} /> : null}

      {/* Quick stat chips */}
      {counts.total > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Chip active={!filtersActive} onClick={clearFilters} label="All" value={counts.total} />
          <Chip active={status === ''} onClick={() => { setDue(''); setStatus(''); }} label="Open" value={counts.open} tone="info" plain />
          <Chip active={due === 'overdue'} onClick={() => setDue(due === 'overdue' ? '' : 'overdue')} label="Overdue" value={counts.overdue} tone="danger" />
          <Chip active={status === 'DONE'} onClick={() => setStatus(status === 'DONE' ? '' : 'DONE')} label="Completed" value={counts.done} tone="success" />
        </div>
      ) : null}

      {/* Toolbar: filters + sort + view toggle */}
      {counts.total > 0 ? (
        <div className="card mb-4 flex flex-wrap items-center gap-2 p-2.5">
          <div className="w-40 max-w-full"><SearchableSelect ariaLabel="Filter by project" value={project} onChange={setProject} options={projectOptions} /></div>
          <div className="w-36 max-w-full"><SearchableSelect ariaLabel="Filter by status" value={status} onChange={setStatus} options={statusOptions} /></div>
          <div className="w-36 max-w-full"><SearchableSelect ariaLabel="Filter by priority" value={priority} onChange={setPriority} options={priorityOptions} /></div>
          <div className="w-36 max-w-full"><SearchableSelect ariaLabel="Filter by assignee" value={assignee} onChange={setAssignee} options={assigneeOptions} /></div>
          <div className="w-36 max-w-full"><SearchableSelect ariaLabel="Filter by due date" value={due} onChange={setDue} options={DUE_OPTIONS} /></div>
          {filtersActive ? (
            <button onClick={clearFilters} className="rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-ground hover:text-ink">Clear</button>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-1.5 text-xs text-ink-2 sm:flex">
              <span aria-hidden>Sort</span>
              <div className="w-32"><SearchableSelect ariaLabel="Sort tasks" value={sort} onChange={(v) => setSort(v as Sort)} options={SORT_OPTIONS} /></div>
            </div>
            <div className="inline-flex items-center rounded-xl border border-line bg-surface p-0.5">
              <ViewButton active={view === 'grid'} onClick={() => setView('grid')} label="Grid view">
                <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
              </ViewButton>
              <ViewButton active={view === 'list'} onClick={() => setView('list')} label="List view">
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </ViewButton>
            </div>
          </div>
        </div>
      ) : null}

      {/* Results */}
      {tasksQ.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-32 rounded-2xl" />)}
        </div>
      ) : tasksQ.isError ? (
        <p role="alert" className="text-danger">Couldn’t load your tasks.</p>
      ) : counts.total === 0 ? (
        <EmptyState
          icon={CheckIcon}
          title="No tasks assigned to you"
          description="When a task is assigned to you it shows up here — across every project."
        />
      ) : sorted.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm font-semibold text-ink">No tasks match these filters</p>
          <p className="max-w-sm text-sm text-ink-2">Try widening your filters to see more of your work.</p>
          <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
              <input type="checkbox" aria-label="Select all tasks" checked={allVisibleSelected} onChange={toggleSelectAll} className="h-3.5 w-3.5 accent-brand" />
              Select all
            </label>
            <p className="text-xs text-ink-2">
              Showing <span className="font-semibold text-ink">{sorted.length}</span>{filtersActive ? ` of ${counts.total}` : ''} task{sorted.length === 1 ? '' : 's'}
            </p>
          </div>
          {view === 'grid' ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sorted.map((e) => <MyTaskCard key={e.task.id} e={e} onOpen={() => setOpenTaskId(e.task.id)} selected={selected.has(e.task.id)} onToggleSelect={() => toggleSelect(e.task.id)} />)}
            </div>
          ) : (
            <div className="card divide-y divide-line overflow-hidden">
              {sorted.map((e) => <MyTaskRow key={e.task.id} e={e} onOpen={() => setOpenTaskId(e.task.id)} selected={selected.has(e.task.id)} onToggleSelect={() => toggleSelect(e.task.id)} />)}
            </div>
          )}
        </>
      )}

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4">
          <p className="pointer-events-auto rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink shadow-lift">{toast}</p>
        </div>
      ) : null}

      {selectedList.length > 0 ? (
        <BulkActionBar
          count={selectedList.length}
          busy={bulkBusy}
          assignees={assigneeChoices}
          columns={moveColumns}
          onComplete={() => runBulkAction({ type: 'complete' }, 'Completed')}
          onSetDueDate={(date) => runBulkAction({ type: 'setDueDate', dueDate: date }, 'Updated due date on')}
          onSetPriority={(p) => runBulkAction({ type: 'setPriority', priority: p }, 'Set priority on')}
          onAssign={(userId) => runBulkAction({ type: 'assign', userId }, 'Assigned')}
          onMove={moveColumns ? (columnId) => runBulkAction({ type: 'move', columnId }, 'Moved') : undefined}
          onClear={clearSelection}
        />
      ) : null}

      {openTaskId ? <TaskDrawerContainer taskId={openTaskId} onClose={() => setOpenTaskId(null)} /> : null}
    </div>
  );
}

function Chip({ label, value, onClick, active, tone = 'neutral', plain = false }: { label: string; value: number; onClick: () => void; active?: boolean; tone?: 'neutral' | 'info' | 'danger' | 'success'; plain?: boolean }) {
  const dot = { neutral: 'bg-ink-3', info: 'bg-info', danger: 'bg-danger', success: 'bg-success' }[tone];
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:border-brand/30 hover:text-ink'
      }`}
    >
      {!plain ? <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden /> : null}
      {label}
      <span className={`tabular-nums ${active ? 'text-brand' : 'text-ink'}`}>{value}</span>
    </button>
  );
}

function ViewButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`grid h-8 w-8 place-items-center rounded-lg transition-colors ${active ? 'bg-brand text-white shadow-sm' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

function StatusPill({ category }: { category: string }) {
  const m = statusMeta(category);
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-ground px-1.5 py-0.5 text-[11px] font-medium text-ink-2">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} aria-hidden />
      {m.label}
    </span>
  );
}

function DueLabel({ e, className = '' }: { e: Enriched; className?: string }) {
  if (!e.task.dueDate) return <span className={`text-ink-3 ${className}`}>No due date</span>;
  const text = e.overdue ? `Overdue · ${fmtDue(e.task.dueDate)}` : e.dueToday ? 'Due today' : fmtDue(e.task.dueDate);
  const tone = e.overdue ? 'font-semibold text-danger' : e.dueToday ? 'font-semibold text-warning' : 'text-ink-2';
  return <span className={`${tone} ${className}`}>{text}</span>;
}

function Assignees({ list }: { list: { id: string; name: string }[] }) {
  if (!list.length) return null;
  const shown = list.slice(0, 3);
  const extra = list.length - shown.length;
  return (
    <div className="flex flex-none -space-x-1.5">
      {shown.map((a) => <Avatar key={a.id} name={a.name} size="sm" />)}
      {extra > 0 ? <span className="grid h-6 w-6 place-items-center rounded-full border border-line bg-ground text-[10px] font-semibold text-ink-2">+{extra}</span> : null}
    </div>
  );
}

function MyTaskCard({ e, onOpen, selected, onToggleSelect }: { e: Enriched; onOpen: () => void; selected?: boolean; onToggleSelect?: () => void }) {
  const t = e.task;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(); } }}
      className={`card card-hover group flex cursor-pointer flex-col gap-2.5 p-3.5 outline-none ${selected ? 'ring-2 ring-brand/50' : ''} ${e.overdue ? 'border-l-2 border-l-danger' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {onToggleSelect ? (
            <input
              type="checkbox"
              aria-label={`Select ${t.key}`}
              checked={!!selected}
              onClick={(ev) => ev.stopPropagation()}
              onChange={onToggleSelect}
              className="h-3.5 w-3.5 flex-none accent-brand"
            />
          ) : null}
          {e.projectName ? <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-3">{e.projectName}</span> : <span />}
        </div>
        <PriorityBadge priority={t.priority} />
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded bg-ground px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{t.key}</span>
        <StatusPill category={e.cat} />
      </div>
      <p className={`line-clamp-2 text-sm font-medium leading-snug text-ink transition-colors group-hover:text-brand ${e.done ? 'line-through opacity-70' : ''}`}>{t.title}</p>

      <div className="mt-auto flex flex-col gap-2 pt-1">
        <div className="flex items-center gap-1.5 text-[11px]">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-ink-3"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          <DueLabel e={e} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-1 items-center gap-1.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ground"><div className="h-full rounded-full bg-brand-sheen transition-[width] duration-500" style={{ width: `${t.progress}%` }} /></div>
            <span className="w-8 flex-none text-right text-[10px] tabular-nums text-ink-3">{t.progress}%</span>
          </div>
          <Assignees list={t.assignees ?? []} />
        </div>
      </div>
    </div>
  );
}

function MyTaskRow({ e, onOpen, selected, onToggleSelect }: { e: Enriched; onOpen: () => void; selected?: boolean; onToggleSelect?: () => void }) {
  const t = e.task;
  const m = statusMeta(e.cat);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(); } }}
      className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 outline-none transition-colors hover:bg-ground/60 ${selected ? 'bg-brand/5' : ''} ${e.overdue ? 'border-l-2 border-l-danger' : 'border-l-2 border-l-transparent'}`}
    >
      {onToggleSelect ? (
        <input
          type="checkbox"
          aria-label={`Select ${t.key}`}
          checked={!!selected}
          onClick={(ev) => ev.stopPropagation()}
          onChange={onToggleSelect}
          className="h-3.5 w-3.5 flex-none accent-brand"
        />
      ) : null}
      <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: m.color }} title={m.label} aria-hidden />
      <span className="w-16 flex-none font-mono text-xs text-ink-3">{t.key}</span>
      <span className={`min-w-0 flex-1 truncate text-sm font-medium text-ink ${e.done ? 'line-through opacity-70' : ''}`}>{t.title}</span>
      {e.projectName ? <span className="hidden w-32 flex-none truncate text-xs text-ink-2 lg:block">{e.projectName}</span> : null}
      <span className="hidden sm:block"><PriorityBadge priority={t.priority} /></span>
      <DueLabel e={e} className="hidden w-24 flex-none text-right text-xs tabular-nums sm:block" />
      <div className="hidden w-20 flex-none items-center gap-1.5 md:flex">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ground"><div className="h-full rounded-full bg-brand-sheen" style={{ width: `${t.progress}%` }} /></div>
        <span className="w-7 text-right text-[10px] tabular-nums text-ink-3">{t.progress}%</span>
      </div>
      <span className="hidden md:block"><Assignees list={t.assignees ?? []} /></span>
    </div>
  );
}
