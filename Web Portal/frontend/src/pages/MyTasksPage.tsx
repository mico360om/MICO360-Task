import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { tasksApi, type ApiTask, type Priority } from '../api/tasks';
import { useProjectsWithAll } from '../lib/useProjectsWith';
import { columnsApi, type ApiColumn } from '../api/columns';
import { assigneesApi } from '../api/assignees';
import { usersApi } from '../api/users';
import { useOpenTask } from '../lib/useOpenTask';
import { SavedViewsBar } from '../components/SavedViewsBar';
import { BulkActionBar } from '../components/BulkActionBar';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Button, buttonClass } from '../components/ui/Button';
import { Link } from 'react-router-dom';
import { FirstStepsActions, FirstStepsIcon, useNoProjectsYet } from '../components/FirstSteps';
import { Avatar } from '../components/ui/Avatar';
import { PriorityBadge } from '../components/ui/PriorityBadge';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { ExternalContactsLine } from '../components/ExternalContactsLine';
import { EXTERNAL_CONTACT_WORDS, externalCompanyOptions, hasExternalCompany } from '../lib/external-contacts';
import { NewTaskButton } from '../components/NewTaskButton';
import { statusMeta, STATUS_ORDER } from '../lib/taskStatus';
import { runBulk, type BulkAction, type BulkDeps } from '../lib/bulkActions';
import { OPEN_STATUS, type TaskFilters } from '../lib/savedViews';
import { dueDayKey, shiftDayKey, todayKey as companyTodayKey } from '../lib/due-date';
import { formatDueDay, isTaskDone } from '../lib/due-display';
import { useCompanyTimeZone } from '../lib/company-clock';
import { invalidateTaskQueries } from '../lib/task-cache';
import { approvalNotice } from '../lib/approvals';
import { MoveTaskDialog, useMoveTargets } from '../components/MoveTaskDialog';
import { MergeTasksDialog, type MergeTaskRef } from '../components/MergeTasksDialog';
import { MergedToast } from '../components/task-merge/MergedToast';
import { UndoMergeDialog } from '../components/task-merge/UndoMergeDialog';
import type { MergeResult } from '../api/task-merge';
import { bulkMergeAvailability, invalidateMergeQueries } from '../lib/task-merge';
import { bulkMoveAvailability, bulkMovedText, movedText } from '../lib/task-move';
import { readUserValue, writeUserValue } from '../lib/user-storage';
import { useAuthStore } from '../stores/auth-store';
import { LoadError } from '../components/ui/LoadError';
import { InspectionChip } from '../components/inspections/inspection-ui';
import { ApprovalChip } from '../components/approvals/ApprovalChip';
import { ToApproveSection } from '../components/approvals/ToApproveSection';
import { MyChecklistItems } from '../components/checklists/MyChecklistItems';
import { ProjectAvatar, type ProjectLook } from '../components/ProjectAvatar';
import { TaskKey } from '../components/TaskKey';
import { projectOption } from '../components/project-option';
import { useCurrentProject } from '../components/CurrentProject';
import { TOUCH_TALL } from '../lib/touch';
import { DENSE_FACE, DENSE_STACK, DENSE_TEXT } from '../lib/density-tokens';
import { DensityButton } from '../components/DensityButton';
import { useMediaQuery } from '../lib/useMediaQuery';
import { TaskTable } from '../components/data-table/TaskTable';
import { useTableMemory } from '../components/data-table/hooks';
import { sortRows, type SortValue } from '../lib/data-table';
import { myTasksSort, myTasksSortLabel, myTasksSortValue } from '../lib/task-table';
import { StatusPill as SchemeStatusPill } from '../components/ui/StatusPill';
import { OVERDUE_CLASS, STATUS_CLASS, dueTone } from '../lib/colour-classes';
import { useDensity } from '../lib/density';
import { ChecklistCount, DescriptionLine, PeopleLine, TagChips } from '../components/DetailLines';

const CheckIcon = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

const P_RANK: Record<Priority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

type View = 'grid' | 'list' | 'table';
const VIEWS: readonly View[] = ['grid', 'list', 'table'];
/** 'due', 'priority', 'progress', 'title' — and (1.23.0) a table header's: 'title:desc', 'status'… (lib/task-table). */
type Sort = string;
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
  /** 1.23.8: due tomorrow (amber with today, in words). */
  dueTomorrow: boolean;
  dueKey: string | null;
  /** The due date's calendar day, formatted (e.g. "Sep 30"). */
  dueLabel: string;
  projectName: string | null;
  project: ProjectLook | null;
}

/** Stop a key/click on a row's checkbox from also opening the task (Space must select the row). */

export function MyTasksPage() {
  const tasksQ = useQuery({ queryKey: ['my-tasks'], queryFn: () => tasksApi(apiClient).mine() });
  const tasks = useMemo(() => (Array.isArray(tasksQ.data) ? tasksQ.data : []), [tasksQ.data]);
  // Names and colours for every task's project — an administrator's own tasks show from projects
  // off their "Show my projects only" list too (owner, 4 Nov).
  const { projects } = useProjectsWithAll(useMemo(() => tasks.map((t) => t.projectId), [tasks]));
  const noProjectsYet = useNoProjectsYet();

  // A task opens in the app's task panel (?task=, so Back closes it), with the list as shown —
  // its sort and filters — for the panel's Previous / Next.
  const openTask = useOpenTask();
  // "Today" / "overdue" are company calendar days (a task due today is never overdue; finished work never is).
  const timeZone = useCompanyTimeZone();
  const userId = useAuthStore((s) => s.user?.id);
  const [project, setProject] = useState('');
  // Filtered to one project: New task starts in it.
  useCurrentProject(project);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  // External company: only tasks with a contact from it (not part of saved views).
  const [company, setCompany] = useState('');
  const [sort, setSort] = useState<Sort>('due');
  const [view, setView] = useState<View>(() => {
    const saved = readUserValue(useAuthStore.getState().user?.id, 'mytasks.view') as View | null;
    return saved && VIEWS.includes(saved) ? saved : 'grid';
  });
  // 1.23.0: the Table view's optional columns, remembered for the person (and kept with saved views).
  const tableMemory = useTableMemory('mytasks', { shown: [] });
  // A phone (below the sm width): the filters wait behind one button.
  const phone = useMediaQuery('(max-width: 39.9375em)');
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => { writeUserValue(userId, 'mytasks.view', view); }, [view, userId]);

  // Bulk selection + async bulk-action plumbing.
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const directoryQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const enriched = useMemo<Enriched[]>(() => {
    const tKey = companyTodayKey(timeZone);
    return tasks.map((task) => {
      const cat = task.columnCategory ?? 'TODO';
      const done = isTaskDone(task);
      const dueKey = dueDayKey(task.dueDate, timeZone);
      // Never overdue while it waits for approval: its badge says so instead (owner, 30 Oct).
      const overdue = !!dueKey && dueKey < tKey && !done && !task.approvalRequestedAt;
      const dueToday = !!dueKey && dueKey === tKey;
      const dueTomorrow = !!dueKey && dueKey === shiftDayKey(tKey, 1);
      const dueLabel = formatDueDay(task.dueDate, timeZone, { month: 'short', day: 'numeric' });
      return { task, cat, done, overdue, dueToday, dueTomorrow, dueKey, dueLabel, projectName: projectById.get(task.projectId)?.name ?? null, project: projectById.get(task.projectId) ?? null };
    });
  }, [tasks, projectById, timeZone]);

  // Filter option sources.
  const projectOptions = useMemo(() => {
    const ids = [...new Set(tasks.map((t) => t.projectId))];
    return [
      { value: '', label: 'All projects' },
      ...ids.map((id) => {
        const p = projectById.get(id);
        return p ? projectOption(p) : { value: id, label: 'Project' };
      }),
    ];
  }, [tasks, projectById]);
  const statusOptions = useMemo(() => {
    const present = new Set(enriched.map((e) => e.cat));
    return [
      { value: '', label: 'All statuses' },
      { value: OPEN_STATUS, label: 'Open (not completed)' },
      ...STATUS_ORDER.filter((c) => present.has(c)).map((c) => ({ value: c, label: statusMeta(c).label })),
    ];
  }, [enriched]);
  const priorityOptions = [
    { value: '', label: 'All priorities' },
    { value: 'URGENT', label: 'Urgent' },
    { value: 'HIGH', label: 'High' },
    { value: 'NORMAL', label: 'Normal' },
    { value: 'LOW', label: 'Low' },
  ];
  const companyOptions = useMemo(() => {
    const found = externalCompanyOptions(tasks);
    const choices = company && !found.includes(company) ? [company, ...found] : found;
    return [{ value: '', label: `${EXTERNAL_CONTACT_WORDS.filter}: ${EXTERNAL_CONTACT_WORDS.anyCompany}` }, ...choices.map((c) => ({ value: c, label: c }))];
  }, [tasks, company]);
  const assigneeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) for (const a of t.assignees ?? []) m.set(a.id, a.name);
    return [{ value: '', label: 'Anyone' }, ...[...m].map(([value, label]) => ({ value, label }))];
  }, [tasks]);

  const filtered = useMemo(() => {
    const tK = companyTodayKey(timeZone);
    const wK = shiftDayKey(tK, 7);
    return enriched.filter((e) => {
      if (project && e.task.projectId !== project) return false;
      if (status === OPEN_STATUS ? e.done : status && e.cat !== status) return false;
      if (priority && e.task.priority !== priority) return false;
      if (assignee && !(e.task.assignees ?? []).some((a) => a.id === assignee)) return false;
      if (due === 'overdue' && !e.overdue) return false;
      if (due === 'today' && !e.dueToday) return false;
      if (due === 'week' && !(e.dueKey && e.dueKey >= tK && e.dueKey <= wK)) return false;
      if (due === 'none' && e.task.dueDate) return false;
      if (company && !hasExternalCompany(e.task.externalSummary, company)) return false;
      return true;
    });
  }, [enriched, project, status, priority, assignee, due, company, timeZone]);

  // The Sort menu's choice — or a table header's (the same sort): due date with undated last, priority
  // most urgent first, progress most done first, title A–Z, and each the other way round.
  const sorted = useMemo(() => {
    const valueOf = (e: Enriched, column: string): SortValue => {
      switch (column) {
        case 'due': return e.dueKey;
        case 'priority': return P_RANK[e.task.priority];
        case 'progress': return e.task.progress;
        case 'title': return e.task.title;
        case 'key': return e.task.key;
        case 'status': return STATUS_ORDER.indexOf(e.cat as (typeof STATUS_ORDER)[number]);
        case 'project': return e.projectName ?? '';
        case 'assignee': return e.task.assignees?.[0]?.name ?? '';
        case 'start': return dueDayKey(e.task.startDate, timeZone);
        default: return null;
      }
    };
    return sortRows(filtered, myTasksSort(sort), valueOf);
  }, [filtered, sort, timeZone]);

  const counts = useMemo(() => {
    let open = 0, overdue = 0, done = 0;
    for (const e of enriched) {
      if (e.done) done += 1; else open += 1;
      if (e.overdue) overdue += 1;
    }
    return { total: enriched.length, open, overdue, done };
  }, [enriched]);

  const filtersActive = !!(project || status || priority || assignee || due || company);
  const clearFilters = () => { setProject(''); setStatus(''); setPriority(''); setAssignee(''); setDue(''); setCompany(''); };

  // Saved views: snapshot the filter state and apply a preset back onto it — 1.23.0: with the table's
  // columns (a view saved before keeps the columns as they are).
  const currentFilters: TaskFilters = { project, status, priority, assignee, due, sort, columns: tableMemory.shown.join(',') };
  const applyView = (f: TaskFilters) => {
    setProject(f.project); setStatus(f.status); setPriority(f.priority); setAssignee(f.assignee); setDue(f.due);
    setSort((f.sort as Sort) || 'due');
    if (f.columns !== undefined) tableMemory.setShown(f.columns.split(',').filter(Boolean));
  };
  // A header's sort not in the menu (Status, Title Z–A…) is shown there as the choice in force.
  const sortOptions = SORT_OPTIONS.some((o) => o.value === sort) ? SORT_OPTIONS : [...SORT_OPTIONS, { value: sort, label: myTasksSortLabel(sort) }];

  // Selection scoped to what's currently visible, so hidden tasks are never acted on by surprise.
  const selectedList = useMemo(() => sorted.filter((e) => selected.has(e.task.id)), [sorted, selected]);
  const sortedIds = useMemo(() => sorted.map((e) => e.task.id), [sorted]);
  const toggleSelect = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clearSelection = () => setSelected(new Set());
  const allVisibleSelected = sorted.length > 0 && selectedList.length === sorted.length;
  const toggleSelectAll = () => setSelected(allVisibleSelected ? new Set() : new Set(sorted.map((e) => e.task.id)));

  // Bulk actions reuse the single-task endpoints (each already object-level authorized).
  const colCache = useRef(new Map<string, Promise<ApiColumn[]>>());
  const waitingAfterBulk = useRef(0);
  const getColumns = (projectId: string) => {
    let p = colCache.current.get(projectId);
    if (!p) { p = columnsApi(apiClient).list(projectId); colCache.current.set(projectId, p); }
    return p;
  };
  const bulkDeps: BulkDeps = {
    update: (id, patch) => tasksApi(apiClient).update(id, patch),
    move: async (id, columnId) => {
      const moved = await tasksApi(apiClient).move(id, columnId);
      // Needs approval: it waits for a project manager instead of completing.
      if (approvalNotice(columnId, moved)) waitingAfterBulk.current += 1;
      return moved;
    },
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
    waitingAfterBulk.current = 0;
    try {
      const res = await runBulk(refs, action, bulkDeps);
      colCache.current.clear();
      await invalidateTaskQueries(qc);
      setSelected(new Set());
      const waiting = waitingAfterBulk.current;
      const waits = waiting ? ` ${waiting} need${waiting === 1 ? 's' : ''} approval and ${waiting === 1 ? 'is' : 'are'} waiting for a project manager.` : '';
      setToast((res.failed === 0 ? `${label} ${res.succeeded} task${res.succeeded === 1 ? '' : 's'}.` : `${label} ${res.succeeded}, ${res.failed} couldn’t be updated.`) + waits);
    } catch {
      setToast('Bulk action failed. Please try again.');
    } finally {
      setBulkBusy(false);
    }
  }
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  // "Move to project…": one dialog for the whole selection (each task is checked there).
  const [moving, setMoving] = useState<{ id: string; key: string; title: string; projectId: string }[] | null>(null);
  const moveTargets = useMoveTargets(selected.size > 0);
  const moveUnavailable = bulkMoveAvailability(moveTargets).reason;
  // 1.23.1 "Merge…": 2–10 selected tasks, each in a project the person manages (administrators: any).
  const mergeAvail = bulkMergeAvailability(selectedList.map((e) => e.task), moveTargets);
  const [merging, setMerging] = useState<MergeTaskRef[] | null>(null);
  const [merged, setMerged] = useState<MergeResult | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);

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

  // The toolbar's parts: laid out in a row (tablet and up), or behind "Filters" on a phone.
  const activeFilters = [project, status, priority, assignee, due, company].filter(Boolean).length;
  const filterBoxes = (box: string) => (
    <>
      <div className={box}><SearchableSelect ariaLabel="Filter by project" value={project} onChange={setProject} options={projectOptions} /></div>
      <div className={box}><SearchableSelect ariaLabel="Filter by status" value={status} onChange={setStatus} options={statusOptions} /></div>
      <div className={box}><SearchableSelect ariaLabel="Filter by priority" value={priority} onChange={setPriority} options={priorityOptions} /></div>
      <div className={box}><SearchableSelect ariaLabel="Filter by assignee" value={assignee} onChange={setAssignee} options={assigneeOptions} /></div>
      <div className={box}><SearchableSelect ariaLabel="Filter by due date" value={due} onChange={setDue} options={DUE_OPTIONS} /></div>
      {companyOptions.length > 1 ? (
        <div className={box}><SearchableSelect ariaLabel={`Filter by ${EXTERNAL_CONTACT_WORDS.filter.toLowerCase()}`} value={company} onChange={setCompany} options={companyOptions} /></div>
      ) : null}
    </>
  );
  const clearButton = filtersActive ? (
    <button onClick={clearFilters} className={`rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-ground hover:text-ink ${TOUCH_TALL}`}>Clear</button>
  ) : null;
  const sortSelect = <SearchableSelect ariaLabel="Sort tasks" value={sort} onChange={(v) => setSort(v as Sort)} options={sortOptions} />;
  const viewSwitch = (
    <div className="inline-flex items-center rounded-xl border border-line bg-surface p-0.5 [@media(pointer:coarse)]:p-0">
      <ViewButton active={view === 'grid'} onClick={() => setView('grid')} label="Grid view">
        <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
      </ViewButton>
      <ViewButton active={view === 'list'} onClick={() => setView('list')} label="List view">
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </ViewButton>
      {/* 1.23.0: the table — changed in place, sorted by its headers (the Sort menu's sort). */}
      <ViewButton active={view === 'table'} onClick={() => setView('table')} label="Table view">
        <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 10v10" />
      </ViewButton>
    </div>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="My Tasks"
        learn="tasks"
        subtitle="Everything assigned to you, across every project."
        actions={<NewTaskButton onCreated={() => tasksQ.refetch()} />}
      />

      {/* Tasks waiting for my approval (people who run a project, and admins). */}
      <ToApproveSection onOpen={(id) => openTask(id)} />

      {/* 1.23.3: checklist items of other tasks given to me (each opens its task at the item). */}
      <MyChecklistItems />

      {/* Saved filter presets */}
      {counts.total > 0 ? <SavedViewsBar current={currentFilters} onApply={applyView} /> : null}

      {/* Quick stat chips */}
      {counts.total > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Chip active={!filtersActive} onClick={clearFilters} label="All" value={counts.total} />
          <Chip active={status === OPEN_STATUS} onClick={() => setStatus(status === OPEN_STATUS ? '' : OPEN_STATUS)} label="Open" value={counts.open} tone="info" />
          <Chip active={due === 'overdue'} onClick={() => setDue(due === 'overdue' ? '' : 'overdue')} label="Overdue" value={counts.overdue} tone="overdue" />
          <Chip active={status === 'DONE'} onClick={() => setStatus(status === 'DONE' ? '' : 'DONE')} label="Completed" value={counts.done} tone="done" />
        </div>
      ) : null}

      {/* Toolbar: filters + sort + view toggle. On a phone the filters and the sort wait behind one
          "Filters" button (with how many are in use), as on the Calendar: five boxes took a screenful. */}
      {counts.total > 0 ? (
        phone ? (
          <div className="card mb-4 p-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFiltersOpen((o) => !o)}
                aria-expanded={filtersOpen}
                aria-controls="my-tasks-filters"
                className={`inline-flex h-9 items-center gap-1.5 rounded-xl border bg-surface px-3 text-sm font-semibold transition-colors hover:border-brand [@media(pointer:coarse)]:h-11 ${filtersOpen || activeFilters ? 'border-brand/60 text-brand' : 'border-line text-ink'}`}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>
                Filters{activeFilters ? ` (${activeFilters})` : ''}
              </button>
              {clearButton}
              <div className="ms-auto">{viewSwitch}</div>
            </div>
            {filtersOpen ? (
              <div id="my-tasks-filters" className="mt-2.5 grid grid-cols-2 gap-2 border-t border-line pt-2.5">
                {filterBoxes('min-w-0')}
                <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink-2">
                  <span aria-hidden>Sort</span>
                  <div className="min-w-0 flex-1">{sortSelect}</div>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="card mb-4 flex flex-wrap items-center gap-2 p-2.5">
            {filterBoxes('min-w-0 flex-[1_1_9rem] sm:max-w-[13rem]')}
            {clearButton}

            <div className="ml-auto flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-ink-2">
                <span aria-hidden>Sort</span>
                <div className="w-32">{sortSelect}</div>
              </div>
              {viewSwitch}
              {/* 1.23.0: Compact rows for all three views (from 768px with a mouse; Settings otherwise). */}
              <DensityButton />
            </div>
          </div>
        )
      ) : null}

      {/* Results */}
      {tasksQ.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-32 rounded-2xl" />)}
        </div>
      ) : tasksQ.isError ? (
        <LoadError what="your tasks" onRetry={() => void tasksQ.refetch()} />
      ) : counts.total === 0 ? (
        noProjectsYet ? (
          // A company's first day: tasks live in projects, so the first step is a project.
          <EmptyState
            icon={FirstStepsIcon}
            title="No tasks yet"
            description="Tasks live in projects. Create your first project, then add tasks and assign them — yours will show up here."
            action={<FirstStepsActions />}
          />
        ) : (
          <EmptyState
            icon={CheckIcon}
            title="No tasks assigned to you"
            description="When a task is assigned to you it shows up here — across every project. Everyone’s work is on the board."
            action={<Link to="/board" className={buttonClass('secondary', 'md', TOUCH_TALL)}>Open the board</Link>}
          />
        )
      ) : sorted.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm font-semibold text-ink">No tasks match these filters</p>
          <p className="max-w-sm text-sm text-ink-2">Try widening your filters to see more of your work.</p>
          <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink-2 [@media(pointer:coarse)]:min-h-11">
              <input type="checkbox" aria-label="Select all tasks" checked={allVisibleSelected} onChange={toggleSelectAll} className="h-3.5 w-3.5 accent-brand" />
              Select all
            </label>
            <p className="text-xs text-ink-2">
              Showing <span className="font-semibold text-ink">{sorted.length}</span>{filtersActive ? ` of ${counts.total}` : ''} task{sorted.length === 1 ? '' : 's'}
            </p>
          </div>
          {view === 'grid' ? (
            <div className="grid gap-3 compact:gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sorted.map((e) => <MyTaskCard key={e.task.id} e={e} onOpen={() => openTask(e.task.id, sortedIds)} selected={selected.has(e.task.id)} onToggleSelect={() => toggleSelect(e.task.id)} />)}
            </div>
          ) : view === 'list' ? (
            <div className="card divide-y divide-line overflow-hidden">
              {sorted.map((e) => <MyTaskRow key={e.task.id} e={e} onOpen={() => openTask(e.task.id, sortedIds)} selected={selected.has(e.task.id)} onToggleSelect={() => toggleSelect(e.task.id)} />)}
            </div>
          ) : (
            // The page's filters, Sort menu, saved views and selection apply; a header click sets the sort.
            <TaskTable
              page="mytasks"
              label="My tasks"
              tasks={sorted.map((e) => e.task)}
              projects={projects}
              showProject
              presorted
              // Every task, as Grid and List draw them: "Select all" then acts only on what is on screen.
              paged={false}
              sort={myTasksSort(sort)}
              onSortChange={(next) => setSort(myTasksSortValue(next))}
              shown={tableMemory.shown}
              onShownChange={tableMemory.setShown}
              selection={{ selected, onToggle: toggleSelect }}
              onOpen={(id, ids) => openTask(id, ids)}
            />
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
          onMoveToProject={() => setMoving(selectedList.map((e) => ({ id: e.task.id, key: e.task.key, title: e.task.title, projectId: e.task.projectId })))}
          moveUnavailable={moveUnavailable}
          onMerge={mergeAvail.show ? () => setMerging(selectedList.map((e) => ({ id: e.task.id, key: e.task.key, title: e.task.title, projectId: e.task.projectId }))) : undefined}
          mergeUnavailable={mergeAvail.reason}
          onAssign={(userId) => runBulkAction({ type: 'assign', userId }, 'Assigned')}
          onMove={moveColumns ? (columnId) => runBulkAction({ type: 'move', columnId }, 'Moved') : undefined}
          onClear={clearSelection}
        />
      ) : null}

      {moving ? (
        <MoveTaskDialog
          tasks={moving}
          onClose={() => setMoving(null)}
          // One task selected: the one-task move.
          onMoved={(result) => {
            void invalidateTaskQueries(qc);
            setSelected(new Set());
            setToast(movedText(result));
            setMoving(null);
          }}
          onBulkMoved={(result, projectName) => {
            void invalidateTaskQueries(qc);
            setSelected(new Set());
            setToast(bulkMovedText(result, projectName));
            // All moved: done. Otherwise the dialog lists the ones that couldn't be, until Done.
            if (result.failed === 0) setMoving(null);
          }}
        />
      ) : null}

      {merging ? (
        <MergeTasksDialog
          tasks={merging}
          onClose={() => setMerging(null)}
          onMerged={(result) => {
            setMerging(null);
            setSelected(new Set());
            setMerged(result);
            void invalidateMergeQueries(qc);
          }}
        />
      ) : null}
      {undoing ? (
        <UndoMergeDialog
          mergeId={undoing}
          onClose={() => setUndoing(null)}
          onUndone={(result) => {
            setUndoing(null);
            setMerged(null);
            setToast(result.text);
            void invalidateMergeQueries(qc);
          }}
        />
      ) : null}
      {merged ? <MergedToast text={merged.text} onOpen={() => openTask(merged.mainTaskId)} onUndo={() => setUndoing(merged.mergeId)} onDismiss={() => setMerged(null)} /> : null}
    </div>
  );
}

function Chip({ label, value, onClick, active, tone = 'neutral', plain = false }: { label: string; value: number; onClick: () => void; active?: boolean; tone?: 'neutral' | 'info' | 'overdue' | 'done'; plain?: boolean }) {
  // 1.23.8: Overdue and Completed wear the scheme's overdue red and Done green.
  const dot = { neutral: 'bg-ink-3', info: 'bg-info', overdue: OVERDUE_CLASS.dot, done: STATUS_CLASS.DONE.dot }[tone];
  return (
    <button
      onClick={onClick}
      aria-pressed={!!active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${TOUCH_TALL} ${
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
      className={`grid h-8 w-8 place-items-center rounded-lg transition-colors [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 ${active ? 'bg-brand text-white shadow-sm' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

/** Its status in the one colour scheme (1.23.8, components/ui/StatusPill). */
function StatusPill({ category }: { category: string }) {
  return <SchemeStatusPill category={category} />;
}

function DueLabel({ e, className = '' }: { e: Enriched; className?: string }) {
  if (!e.task.dueDate) return <span className={`text-ink-3 ${className}`}>No due date</span>;
  const soon = !e.done && !e.task.approvalRequestedAt && (e.dueToday || e.dueTomorrow);
  const text = e.overdue ? `Overdue · ${e.dueLabel}` : e.dueToday ? 'Due today' : soon ? `Due tomorrow · ${e.dueLabel}` : e.dueLabel;
  const tone = dueTone({ late: e.overdue, soon });
  return <span className={`${tone} ${className}`}>{text}</span>;
}

function Assignees({ list, all = false }: { list: { id: string; name: string; avatarUrl?: string | null }[]; /** Detailed: every face (their names are on the line below). */ all?: boolean }) {
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, 3);
  const extra = list.length - shown.length;
  return (
    <div className={`flex flex-none -space-x-1.5 ${all ? 'flex-wrap justify-end' : ''} ${DENSE_STACK}`}>
      {shown.map((a) => <Avatar key={a.id} name={a.name} src={a.avatarUrl} size="sm" dense />)}
      {extra > 0 ? <span className={`grid h-6 w-6 place-items-center rounded-full border border-line bg-ground text-[10px] font-semibold text-ink-2 ${DENSE_FACE}`}>+{extra}</span> : null}
    </div>
  );
}

/**
 * The "select this task" checkbox of a card or row. It sits above the row's click area, and its
 * label pads the 16px box out to a 28px target so it can be hit with a finger.
 */
function SelectBox({ taskKey, checked, onChange }: { taskKey: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="relative z-10 -m-1.5 grid h-7 w-7 flex-none cursor-pointer place-items-center [@media(pointer:coarse)]:-m-2.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
      <input type="checkbox" aria-label={`Select ${taskKey}`} checked={checked} onChange={onChange} className="h-4 w-4 cursor-pointer accent-brand" />
    </label>
  );
}

function MyTaskCard({ e, onOpen, selected, onToggleSelect }: { e: Enriched; onOpen: () => void; selected?: boolean; onToggleSelect?: () => void }) {
  const t = e.task;
  // Detailed (1.23.8, lib/density): the whole title, the description's first line, tags and everyone on it.
  const detailed = useDensity() === 'detailed';
  return (
    // The title button opens the task; its ::after covers the card, so a click anywhere works, while
    // the select checkbox sits above it as a separate control (never one control inside another).
    <div
      data-task-key={t.key}
      // Compact rows (1.23.0, lib/density): a third less padding and room inside, the title a step smaller.
      className={`card card-hover group relative flex flex-col gap-2.5 p-3.5 compact:gap-1.5 compact:p-2.5 focus-within:border-brand/40 ${selected ? 'ring-2 ring-brand/50' : ''} ${e.overdue ? 'border-l-2 border-l-overdue' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {onToggleSelect ? <SelectBox taskKey={t.key} checked={!!selected} onChange={onToggleSelect} /> : null}
          {e.project ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <ProjectAvatar project={e.project} size="xs" />
              <span dir="auto" title={e.project.name} className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-3">{e.project.name}</span>
            </span>
          ) : <span />}
        </div>
        <PriorityBadge priority={t.priority} />
      </div>
      <div className="flex items-center gap-2">
        <TaskKey value={t.key} dense="compact" />
        <StatusPill category={e.cat} />
        {t.approvalRequestedAt ? <ApprovalChip /> : null}
        {t.inspectionFormId ? <InspectionChip /> : null}
      </div>
      <button
        type="button"
        onClick={onOpen}
        dir="auto"
        className={`${detailed ? 'break-words' : 'line-clamp-2'} cursor-pointer text-start text-sm font-medium leading-snug text-ink outline-none transition-colors ${DENSE_TEXT} after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-brand/60 group-hover:text-brand ${e.done ? 'line-through opacity-70' : ''}`}
      >
        {t.title}
      </button>
      {detailed ? <DescriptionLine description={t.description} className="-mt-1" /> : null}
      <ExternalContactsLine summary={t.externalSummary} />
      {detailed ? <TagChips tags={t.tags} /> : null}

      <div className="mt-auto flex flex-col gap-2 pt-1 compact:gap-1.5 compact:pt-0">
        <div className="flex items-center gap-1.5 text-[11px]">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-ink-3"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          <DueLabel e={e} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-1 items-center gap-1.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ground"><div className="h-full rounded-full bg-brand-sheen transition-[width] duration-500" style={{ width: `${t.progress}%` }} /></div>
            <span className="w-9 flex-none text-right text-[11px] tabular-nums text-ink-3">{t.progress}%</span>
          </div>
          <Assignees list={t.assignees ?? []} all={detailed} />
        </div>
        {detailed && (t.assignees?.length ?? 0) > 1 ? <PeopleLine people={t.assignees} /> : null}
        {detailed ? <ChecklistCount counts={t.counts} /> : null}
      </div>
    </div>
  );
}

function MyTaskRow({ e, onOpen, selected, onToggleSelect }: { e: Enriched; onOpen: () => void; selected?: boolean; onToggleSelect?: () => void }) {
  const t = e.task;
  const m = statusMeta(e.cat);
  // Detailed (1.23.8): the title wraps, and the description's first line, tags and everyone on it go under it.
  const detailed = useDensity() === 'detailed';
  return (
    <div
      data-task-key={t.key}
      // Compact rows (1.23.0, lib/density): a third less padding, the title a step smaller.
      className={`relative flex items-center gap-3 px-4 py-2.5 transition-colors compact:py-1.5 hover:bg-ground/60 ${selected ? 'bg-brand/5' : ''} ${e.overdue ? 'border-l-2 border-l-overdue' : 'border-l-2 border-l-transparent'}`}
    >
      {onToggleSelect ? <SelectBox taskKey={t.key} checked={!!selected} onChange={onToggleSelect} /> : null}
      {/* The status: a named dot (its word on the phone line below, and in a column on a wide screen). */}
      <span role="img" aria-label={m.label} title={m.label} className="hidden h-2.5 w-2.5 flex-none rounded-full sm:block 2xl:hidden" style={{ background: m.color }} />
      {/* At least the usual width, so the titles line up; a longer number widens its row's column, never cut. */}
      <span className="hidden min-w-[5.5rem] flex-none sm:block"><TaskKey value={t.key} dense="compact" /></span>
      {/* The title takes the room left; a check's Inspection chip sits at its end, so the columns
          after it line up from row to row. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
        <button
          type="button"
          onClick={onOpen}
          dir="auto"
          title={detailed ? undefined : t.title}
          className={`min-w-0 flex-1 basis-0 cursor-pointer ${detailed ? 'break-words' : 'truncate'} text-start text-sm font-medium text-ink outline-none ${DENSE_TEXT} after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-brand/60 ${e.done ? 'line-through opacity-70' : ''}`}
        >
          {t.title}
        </button>
        {t.approvalRequestedAt ? (
          <span className="hidden flex-none sm:inline-flex">
            <ApprovalChip />
          </span>
        ) : null}
        {t.inspectionFormId ? (
          <span className="hidden flex-none sm:inline-flex">
            <InspectionChip />
          </span>
        ) : null}
        {detailed ? <DescriptionLine description={t.description} className="basis-full" /> : null}
        <ExternalContactsLine summary={t.externalSummary} className="basis-full" />
        {detailed ? <TagChips tags={t.tags} className="mt-1 basis-full" /> : null}
        {detailed && (t.assignees?.length ?? 0) > 0 ? <PeopleLine people={t.assignees} className="mt-1 basis-full" /> : null}
        {detailed ? <ChecklistCount counts={t.counts} className="mt-1" /> : null}
        {/* Phones have no room for the columns: the same facts go on a second line. */}
        <div data-phone-meta className="mt-1 flex basis-full flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
          <TaskKey value={t.key} />
          <StatusPill category={e.cat} />
          {t.approvalRequestedAt ? <ApprovalChip /> : null}
          {t.inspectionFormId ? <InspectionChip /> : null}
          <PriorityBadge priority={t.priority} />
          <DueLabel e={e} className="text-xs tabular-nums" />
        </div>
      </div>
      {e.project ? (
        <span className="hidden w-36 flex-none items-center gap-1.5 xl:flex">
          <ProjectAvatar project={e.project} size="xs" />
          <span dir="auto" title={e.project.name} className="truncate text-xs text-ink-2">{e.project.name}</span>
        </span>
      ) : <span className="hidden w-36 flex-none xl:block" />}
      <span className="hidden w-28 flex-none 2xl:block"><StatusPill category={e.cat} /></span>
      <span className="hidden w-[4.5rem] flex-none sm:block"><PriorityBadge priority={t.priority} /></span>
      <DueLabel e={e} className="hidden w-24 flex-none text-right text-xs tabular-nums sm:block" />
      <div className="hidden w-20 flex-none items-center gap-1.5 lg:flex">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ground"><div className="h-full rounded-full bg-brand-sheen" style={{ width: `${t.progress}%` }} /></div>
        <span className="w-8 text-right text-[11px] tabular-nums text-ink-3">{t.progress}%</span>
      </div>
      <span className="hidden w-[4.5rem] flex-none justify-end lg:flex"><Assignees list={t.assignees ?? []} /></span>
    </div>
  );
}
