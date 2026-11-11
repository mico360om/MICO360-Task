import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { tasksApi, type ApiTask, type Priority } from '../../api/tasks';
import { columnsApi, type ApiColumn } from '../../api/columns';
import { assigneesApi } from '../../api/assignees';
import { membersApi } from '../../api/members';
import { usersApi } from '../../api/users';
import { boardPeople } from '../../lib/board-people';
import type { ApiProject } from '../../api/projects';
import { DataTable, type DataColumn } from './DataTable';
import { TableFilterBar } from './FilterBar';
import { PeopleCell, TitleCell, type CellPerson } from './cells';
import { useRowEdits, useTableMemory } from './hooks';
import { EMPTY_TABLE_FILTERS, ME, NO_PERSON, sortRows, tableFiltersActive, type SortState } from '../../lib/data-table';
import { filterTaskRows, taskRowEditable, taskSortValue, type TaskStatus, type TaskTableContext } from '../../lib/task-table';
import { statusMeta, STATUS_ORDER } from '../../lib/taskStatus';
import { dueDayKey, shiftDayKey, todayKey } from '../../lib/due-date';
import { formatDueDay, isTaskDone, isTaskLate } from '../../lib/due-display';
import { dayText } from '../../lib/day-words';
import { weekDays } from '../../lib/calendar';
import { useCompanyTimeZone } from '../../lib/company-clock';
import { useDateSettings } from '../../lib/useDatePrefs';
import { invalidateTaskQueries } from '../../lib/task-cache';
import { approvalNotice } from '../../lib/approvals';
import type { ProjectReadOnly } from '../../lib/project-archive';
import { useAuthStore } from '../../stores/auth-store';
import { SearchableSelect } from '../ui/SearchableSelect';
import { DayPickerButton } from '../ui/DateTimeField';
import { PriorityBadge } from '../ui/PriorityBadge';
import { TaskKey } from '../TaskKey';
import { ProjectAvatar } from '../ProjectAvatar';
import { ApprovalChip } from '../approvals/ApprovalChip';
import { InspectionChip } from '../inspections/inspection-ui';
import { ClientEyeIcon } from '../TaskCard';
import { FlagIcon } from '../project-dashboard/parts';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';
import { weightColumns } from './weight-column';
import { PRIORITY_CLASS, dueTone, statusColour } from '../../lib/colour-classes';
import { useDensity } from '../../lib/density';
import { ChecklistCount, DescriptionLine, TagChips } from '../DetailLines';
import { CategoryChips } from '../CategoryChip';
import { GuestIcon } from '../GuestsLine';
import { GUEST_WORDS, guestLabel } from '../../lib/guest-contacts';
import { CATEGORY_WORDS } from '../../lib/task-categories';
import { TaskFormDialog } from '../task-form/TaskFormDialog';
import { SelectAllBox, shiftHeld } from '../bulk/select-boxes';
import { selectBoxName } from '../../lib/bulk-selection';

export interface TaskTableProps {
  /** Which page's table (what it remembers for the person: sort, filters, columns). */
  page: string;
  /** The table's name ("Tasks of Platform"). */
  label: string;
  /** The tasks as the page shows them (its own filters applied), in its usual order. */
  tasks: ApiTask[];
  /** The projects of these tasks the page knows: a row of a project it doesn't know is read-only. */
  projects: ApiProject[];
  /** One project's table: its columns (the status choices, by name). Absent: each row's own project's. */
  columns?: ApiColumn[];
  /** A Project column (My Tasks, All projects). */
  showProject?: boolean;
  /** The whole table is to look at (an archived or completed project). */
  readOnly?: ProjectReadOnly | null;
  /** The table's own filter bar (pages without filters of their own). */
  filterBar?: boolean;
  /** My Tasks: the page's own sort (its Sort menu), the rows already in that order. */
  sort?: SortState | null;
  onSortChange?: (next: SortState | null) => void;
  presorted?: boolean;
  /** My Tasks: the shown columns, kept with its saved views. */
  shown?: string[];
  onShownChange?: (ids: string[]) => void;
  /**
   * Bulk changes: the selection boxes — a row's (with Shift, the range from the last one clicked, in the
   * rows' order as shown) and the header's "Select all N matching" (every row the filters leave, not only
   * the hundred drawn).
   */
  selection?: TaskTableSelection;
  /** Open a task in the task panel, with the rows as shown for its Previous / Next. */
  onOpen: (taskId: string, ids: string[]) => void;
  /** Before the Columns menu (when there is no filter bar). */
  toolbar?: ReactNode;
  /** No tasks at all. */
  empty?: ReactNode;
  /** A hundred rows at a time (the default); false: all of them (My Tasks). */
  paged?: boolean;
  /** Told the rows its own filters leave (every page), as they change — "(3 hidden by filters)". */
  onRowsShown?: (ids: string[]) => void;
}

/** The table's selection boxes (bulk changes): the page keeps the selection (lib/bulk-selection). */
export interface TaskTableSelection {
  selected: ReadonlySet<string>;
  /** A row's box; `order`: the rows as shown, for a Shift-click's range. */
  onToggle: (task: ApiTask, opts: { shift: boolean; order: ApiTask[] }) => void;
  /** The header's box: every matching row on, or off. */
  onSelectAll?: (tasks: ApiTask[], on: boolean) => void;
}

const PRIORITIES: Priority[] = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];
const PRIORITY_LABEL: Record<Priority, string> = { URGENT: 'Urgent', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };
/** The priority pill's own colours (ui/PriorityBadge, the 1.23.8 scheme), for its chip. */
const PRIORITY_CHIP: Record<Priority, string> = {
  LOW: PRIORITY_CLASS.LOW.chip,
  NORMAL: PRIORITY_CLASS.NORMAL.chip,
  HIGH: PRIORITY_CLASS.HIGH.chip,
  URGENT: PRIORITY_CLASS.URGENT.chip,
};
const dot = (color: string) => <span className="h-2 w-2 rounded-full" style={{ background: color }} />;

/**
 * Tasks as a table (1.23.0): number, title (with its milestone, client, approval and inspection
 * marks), project, people, priority, due date and status — each changed in place by someone who may
 * (today's rule: anyone on the project, never on an archived or completed one), shown at once and put
 * back with the site's plain error if the server refuses. A status is one of the row's own project's
 * columns, moved as the board moves it (a task that needs approval goes to wait). Open at the end of
 * the row opens the task panel.
 */
export function TaskTable({
  page,
  label,
  tasks,
  projects,
  columns,
  showProject = false,
  readOnly = null,
  filterBar = false,
  sort: pageSort,
  onSortChange,
  presorted = false,
  shown: pageShown,
  onShownChange,
  selection,
  onOpen,
  toolbar,
  empty,
  paged = true,
  onRowsShown,
}: TaskTableProps) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
  const timeZone = useCompanyTimeZone();
  const { weekStart } = useDateSettings();
  const today = todayKey(timeZone);
  const week = weekDays(today, weekStart);
  // A page that keeps the sort and columns itself (My Tasks) has the table remember nothing of its own.
  const memory = useTableMemory(page, { shown: [] }, { remember: !(pageSort !== undefined && pageShown !== undefined) });
  const sort = pageSort !== undefined ? pageSort : memory.sort;
  const setSort = onSortChange ?? memory.setSort;
  const shown = pageShown ?? memory.shown;
  const detailed = useDensity() === 'detailed';
  const setShown = onShownChange ?? memory.setShown;
  const remembered = filterBar ? memory.filters : EMPTY_TABLE_FILTERS;
  const [notice, setNotice] = useState<string | null>(null);
  const edits = useRowEdits<ApiTask>();

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  // Every row's project's columns: one project's from the page, else each project's own (cached under ['columns', id]).
  const otherIds = useMemo(() => (columns ? [] : [...new Set(tasks.map((t) => t.projectId))]), [columns, tasks]);
  const columnQs = useQueries({
    queries: otherIds.map((id) => ({ queryKey: ['columns', id], queryFn: () => columnsApi(apiClient).list(id), staleTime: 60_000 })),
  });
  // (Small: worked out on each draw.)
  const columnsByProject = new Map<string, ApiColumn[]>();
  if (columns) {
    for (const c of columns) columnsByProject.set(c.projectId, [...(columnsByProject.get(c.projectId) ?? []), c]);
  } else {
    otherIds.forEach((id, i) => {
      const data = columnQs[i]?.data;
      if (Array.isArray(data)) columnsByProject.set(id, data);
    });
  }
  for (const [id, list] of columnsByProject) columnsByProject.set(id, [...list].sort((a, b) => a.position - b.position));
  const columnOf = (t: ApiTask) => columnsByProject.get(t.projectId)?.find((c) => c.id === t.columnId);

  const ctx: TaskTableContext = {
    timeZone,
    today,
    weekStart: week[0]!,
    weekEnd: week[6]!,
    myId,
    projectName: (t) => projectById.get(t.projectId)?.name ?? '',
    statusOf: (t): TaskStatus => {
      const col = columnOf(t);
      const cat = col?.category ?? t.columnCategory ?? 'TODO';
      // One project: by its own column. Several: by stage (each project has its own columns).
      if (columns) return { value: t.columnId, label: col?.name ?? statusMeta(cat).label, rank: col ? columnsByProject.get(t.projectId)!.indexOf(col) : 99 };
      return { value: cat, label: col?.name ?? statusMeta(cat).label, rank: STATUS_ORDER.indexOf(cat as (typeof STATUS_ORDER)[number]) * 100 + (col?.position ?? 0) };
    },
  };

  // The filter bar's choices: the columns (one project) or the six stages; the people on the rows.
  const statusOptions = useMemo(
    () => [
      { value: '', label: 'Any status' },
      ...(columns
        ? [...columns].sort((a, b) => a.position - b.position).filter((c) => c.enabled !== false).map((c) => ({ value: c.id, label: c.name, icon: dot(statusColour(c.category)) }))
        : STATUS_ORDER.map((s) => ({ value: s, label: statusMeta(s).label, icon: dot(statusMeta(s).color) }))),
    ],
    [columns],
  );
  const personOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) for (const a of t.assignees ?? []) if (a.id !== myId) m.set(a.id, a.name);
    return [
      { value: '', label: 'Anyone' },
      { value: ME, label: 'Me' },
      { value: NO_PERSON, label: 'Unassigned' },
      ...[...m].sort((a, b) => a[1].localeCompare(b[1], 'en')).map(([value, label]) => ({ value, label })),
    ];
  }, [tasks, myId]);
  // Remembered for the page, not for each project or day: a status (another project's column) or a
  // person not among this table's choices is let go here, never an empty table with a blank box.
  const filters = {
    ...remembered,
    status: statusOptions.some((o) => o.value === remembered.status) ? remembered.status : '',
    person: personOptions.some((o) => o.value === remembered.person) ? remembered.person : '',
  };
  // A sort on a column since hidden is let go too (unless the page keeps its own sort: My Tasks' menu says it).
  const OPTIONAL = new Set(['start', 'progress', 'tags', 'guests', 'categories']);
  const shownSort = presorted || !sort || !OPTIONAL.has(sort.column) || shown.includes(sort.column) ? sort : null;

  const rawById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const withEdits = edits.apply(tasks, (t) => t.id);
  const filtered = filterBar ? filterTaskRows(withEdits, filters, ctx) : withEdits;
  const rows = presorted ? filtered : sortRows(filtered, shownSort, (t, c) => taskSortValue(t, c, ctx));
  const ids = rows.map((t) => t.id);
  const idsKey = ids.join(',');
  const told = useRef(onRowsShown);
  told.current = onRowsShown;
  useEffect(() => {
    told.current?.(idsKey ? idsKey.split(',') : []);
  }, [idsKey]);

  const save = (t: ApiTask, patch: Partial<ApiTask>, run: () => Promise<Partial<ApiTask> | void>) => {
    const base = rawById.get(t.id);
    if (!base) return;
    setNotice(null);
    void edits.edit(t.id, base, patch, async () => {
      const confirmed = await run();
      void invalidateTaskQueries(qc);
      return confirmed;
    });
  };
  const api = tasksApi(apiClient);
  const setTitle = (t: ApiTask, title: string) => save(t, { title }, async () => ({ title: (await api.update(t.id, { title })).title }));
  const setPriority = (t: ApiTask, priority: Priority) => save(t, { priority }, async () => ({ priority: (await api.update(t.id, { priority })).priority }));
  const setDue = (t: ApiTask, day: string | null) => save(t, { dueDate: day }, async () => ({ dueDate: (await api.update(t.id, { dueDate: day })).dueDate }));
  const setStatus = (t: ApiTask, col: ApiColumn) =>
    save(t, { columnId: col.id, columnCategory: col.category }, async () => {
      const moved = await api.move(t.id, col.id);
      // Needs approval and finished by someone who can't approve: it waits (the board's words).
      const waits = approvalNotice(col.id, moved);
      if (waits) setNotice(waits);
      const at = columnsByProject.get(t.projectId)?.find((c) => c.id === moved.columnId);
      return { columnId: moved.columnId, columnCategory: moved.columnCategory ?? at?.category ?? col.category, approvalRequestedAt: moved.approvalRequestedAt ?? null, completedAt: moved.completedAt ?? null };
    });
  const togglePerson = (t: ApiTask, p: CellPerson, on: boolean) => {
    const now = t.assignees ?? [];
    const next = on ? [...now.filter((a) => a.id !== p.id), { id: p.id, name: p.name }] : now.filter((a) => a.id !== p.id);
    save(t, { assignees: next }, async () => {
      if (on) await assigneesApi(apiClient).assign(t.id, p.id);
      else await assigneesApi(apiClient).unassign(t.id, p.id);
    });
  };

  const editable = (t: ApiTask) => taskRowEditable(projectById.get(t.projectId), readOnly);
  const open = (t: ApiTask) => onOpen(t.id, ids);
  // Duplicate Task: "Duplicate" beside Open — the New task form, filled in from that row's task.
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const rowButton = `inline-grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors compact:h-7 compact:w-7 hover:bg-ground hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${TOUCH_SQUARE}`;

  // The header's "Select all N matching": every row the filters leave (all pages, not only the drawn).
  const selectedRows = selection ? rows.filter((t) => selection.selected.has(t.id)).length : 0;
  const allState: 'all' | 'some' | 'none' = selectedRows === 0 ? 'none' : selectedRows === rows.length ? 'all' : 'some';
  const tableColumns: DataColumn<ApiTask>[] = [
    ...(selection
      ? [
          {
            id: 'select',
            label: 'Select',
            hideLabel: !selection.onSelectAll,
            header: selection.onSelectAll ? (
              <label className="mx-auto grid h-8 w-8 cursor-pointer place-items-center compact:h-7 compact:w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                <SelectAllBox
                  state={allState}
                  label={`Select all ${rows.length}${filterBar && tableFiltersActive(filters) ? ' matching' : ''}`}
                  onChange={() => selection.onSelectAll?.(rows, allState !== 'all')}
                  className="h-4 w-4 cursor-pointer accent-brand"
                />
              </label>
            ) : undefined,
            pin: true,
            className: 'w-11 !px-0 text-center',
            cell: (t: ApiTask) => (
              <label className="mx-auto grid h-8 w-8 cursor-pointer place-items-center compact:h-7 compact:w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                <input
                  type="checkbox"
                  aria-label={selectBoxName(t)}
                  checked={selection.selected.has(t.id)}
                  onChange={(e) => selection.onToggle(t, { shift: shiftHeld(e.nativeEvent), order: rows })}
                  className="h-4 w-4 cursor-pointer accent-brand"
                />
              </label>
            ),
          },
        ]
      : []),
    { id: 'key', label: 'No.', sortable: true, phoneHidden: true, className: 'w-px whitespace-nowrap', cell: (t) => <TaskKey value={t.key} dense="compact" /> },
    {
      id: 'title',
      label: 'Title',
      sortable: true,
      pin: true,
      rowHeader: true,
      className: 'min-w-[16rem] max-md:min-w-[9.5rem] max-md:max-w-[11rem]',
      cell: (t) => {
        const done = t.columnCategory === 'DONE' || !!t.completedAt;
        const marks = (
          <>
            {t.isMilestone ? <span className="mt-1 flex-none text-brand" role="img" aria-label="Milestone" title="Milestone"><FlagIcon size={13} /></span> : null}
            {t.clientVisible ? <span className="mt-1 flex-none text-info" role="img" aria-label="Visible to client" title="Visible to client"><ClientEyeIcon size={13} /></span> : null}
          </>
        );
        return (
          <span className="flex min-w-0 flex-col gap-1">
            {/* On a phone the No. column steps aside: the number sits on the title. */}
            <span className="md:hidden"><TaskKey value={t.key} dense="compact" /></span>
            <TitleCell
              value={t.title}
              what={`the title of ${t.key}`}
              editable={editable(t)}
              onSave={(next) => setTitle(t, next)}
              onOpen={() => open(t)}
              emptyMessage="A task needs a title."
              done={done}
              lead={marks}
            />
            {t.approvalRequestedAt || t.inspectionFormId ? (
              <span className="flex flex-wrap gap-1">
                {t.approvalRequestedAt ? <ApprovalChip /> : null}
                {t.inspectionFormId ? <InspectionChip /> : null}
              </span>
            ) : null}
            {/* Detailed (1.23.8, lib/density): the description's first line and the tags under the title. */}
            {detailed ? <DescriptionLine description={t.description} /> : null}
            {detailed && !shown.includes('categories') ? <CategoryChips categories={t.categories} density="detailed" /> : null}
            {detailed && !shown.includes('tags') ? <TagChips tags={t.tags} /> : null}
            {detailed ? <ChecklistCount counts={t.counts} /> : null}
          </span>
        );
      },
    },
    ...(showProject
      ? [
          {
            id: 'project',
            label: 'Project',
            sortable: true,
            className: 'max-w-[12rem]',
            cell: (t: ApiTask) => {
              const p = projectById.get(t.projectId);
              return p ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <ProjectAvatar project={p} size="xs" />
                  <span dir="auto" title={p.name} className="truncate text-ink-2">{p.name}</span>
                </span>
              ) : (
                <span className="text-ink-3">—</span>
              );
            },
          },
        ]
      : []),
    {
      id: 'assignee',
      label: 'Assignees',
      sortable: true,
      className: 'min-w-[9rem] max-w-[14rem]',
      cell: (t) => <TaskPeopleCell task={t} project={projectById.get(t.projectId)} editable={editable(t)} onToggle={(p, on) => togglePerson(t, p, on)} />,
    },
    {
      id: 'priority',
      label: 'Priority',
      sortable: true,
      className: 'w-px whitespace-nowrap',
      cell: (t) =>
        editable(t) ? (
          <SearchableSelect
            size="chip"
            ariaLabel={`Priority of ${t.key}: ${PRIORITY_LABEL[t.priority]}`}
            value={t.priority}
            onChange={(v) => v !== t.priority && setPriority(t, v as Priority)}
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
            chipClassName={PRIORITY_CHIP[t.priority]}
          />
        ) : (
          <PriorityBadge priority={t.priority} />
        ),
    },
    // 1.23.5: Weight, for projects counting completion by weight (weight-column.tsx).
    ...weightColumns({
      tasks,
      projectOf: (t) => projectById.get(t.projectId),
      editable,
      onSave: (t, weight) => save(t, { weight }, async () => ({ weight: (await api.update(t.id, { weight })).weight ?? null })),
    }),
    {
      id: 'due',
      label: 'Due date',
      sortable: true,
      className: 'w-px whitespace-nowrap',
      cell: (t) => <DueCell task={t} timeZone={timeZone} today={today} weekStart={weekStart} editable={editable(t)} onPick={(day) => setDue(t, day)} />,
    },
    {
      id: 'status',
      label: 'Status',
      sortable: true,
      className: 'w-px whitespace-nowrap',
      cell: (t) => {
        const status = ctx.statusOf(t);
        const col = columnOf(t);
        // 1.23.8 one colour scheme: the column's kind decides the colour, whatever the column was given.
        const color = statusColour(col?.category ?? t.columnCategory);
        const list = columnsByProject.get(t.projectId);
        if (!editable(t) || !list) {
          return (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-ground px-2 py-0.5 text-xs font-medium text-ink-2">
              {dot(color)}
              <span dir="auto">{status.label}</span>
            </span>
          );
        }
        // Its project's columns on its board (a column switched off stays a choice while it is in it).
        const choices = list.filter((c) => c.enabled !== false || c.id === t.columnId);
        return (
          <SearchableSelect
            size="chip"
            ariaLabel={`Status of ${t.key}: ${status.label}`}
            value={t.columnId}
            onChange={(v) => {
              const to = choices.find((c) => c.id === v);
              if (to && v !== t.columnId) setStatus(t, to);
            }}
            options={choices.map((c) => ({ value: c.id, label: c.name, icon: dot(statusColour(c.category)) }))}
            chipClassName="bg-ground text-ink-2"
          />
        );
      },
    },
    { id: 'start', label: 'Start date', optional: true, sortable: true, className: 'w-px whitespace-nowrap', cell: (t) => <span className="text-ink-2">{formatDueDay(t.startDate, timeZone) || '—'}</span> },
    {
      id: 'progress',
      label: 'Progress',
      optional: true,
      sortable: true,
      firstDir: 'desc',
      className: 'w-28',
      cell: (t) => {
        const pct = Math.max(0, Math.min(100, t.progress ?? 0));
        return (
          <span className="flex items-center gap-1.5" title={`${pct}% done`}>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ground" aria-hidden="true">
              <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
            </span>
            <span className="w-8 text-end text-[11px] tabular-nums text-ink-2">{pct}%</span>
          </span>
        );
      },
    },
    {
      id: 'tags',
      label: 'Tags',
      optional: true,
      className: 'min-w-[8rem]',
      cell: (t) =>
        t.tags?.length ? (
          <span className="flex flex-wrap gap-1">
            {t.tags.map((g) => (
              <span key={g.id} className="inline-flex items-center gap-1 rounded-full bg-ground px-2 py-0.5 text-[11px] font-medium text-ink-2">
                {dot(g.color)}
                <span dir="auto">{g.name}</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    // 1.24: its guests (people outside the company, named for the record) and its categories.
    {
      id: 'guests',
      label: GUEST_WORDS.heading,
      optional: true,
      sortable: true,
      className: 'min-w-[9rem] max-w-[16rem]',
      cell: (t) => <GuestsCell task={t} />,
    },
    {
      id: 'categories',
      label: CATEGORY_WORDS.heading,
      optional: true,
      sortable: true,
      className: 'min-w-[8rem] max-w-[16rem]',
      cell: (t) => (t.categories?.length ? <CategoryChips categories={t.categories} density="detailed" /> : <span className="text-ink-3">—</span>),
    },
    {
      id: 'open',
      label: 'Open',
      hideLabel: true,
      className: 'w-px !px-1.5 text-end',
      cell: (t) => (
        <span className="inline-flex items-center gap-0.5">
          {/* A table only to look at (an archived or completed project) leaves Duplicate to the task panel. */}
          {readOnly ? null : (
            <button type="button" onClick={() => setDuplicatingId(t.id)} aria-label={`Duplicate ${t.key}: ${t.title}`} title="Duplicate" className={rowButton}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="8" y="8" width="13" height="13" rx="2" />
                <path d="M4 16V5a1 1 0 0 1 1-1h11" />
              </svg>
            </button>
          )}
          <button type="button" onClick={() => open(t)} aria-label={`Open ${t.key}: ${t.title}`} title="Open" className={rowButton}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
          </button>
        </span>
      ),
    },
  ];

  const bar = filterBar ? (
    <TableFilterBar
      filters={filters}
      onChange={memory.setFilters}
      statusOptions={statusOptions}
      personOptions={personOptions}
      personLabel="assignee"
      shown={rows.length}
      total={tasks.length}
      noun={['task', 'tasks']}
    />
  ) : (
    toolbar
  );

  const messages = (
    <>
      {edits.error ? <Banner tone="danger" onDismiss={edits.clearError}>{edits.error}</Banner> : null}
      {notice ? <Banner tone="warning" onDismiss={() => setNotice(null)}>{notice}</Banner> : null}
    </>
  );

  const table = (
    <DataTable
      label={label}
      columns={tableColumns}
      rows={rows}
      rowKey={(t) => t.id}
      rowProps={(t) => ({ 'data-task-key': t.key })}
      rowClassName={(t) => (selection?.selected.has(t.id) ? 'is-selected bg-brand/5' : '')}
      sort={shownSort}
      onSort={setSort}
      paged={paged}
      shown={shown}
      onShownChange={setShown}
      toolbar={bar}
      notice={messages}
      empty={
        tasks.length === 0 ? (
          (empty ?? <p className="card p-6 text-center text-sm text-ink-2">No tasks.</p>)
        ) : (
          <div className="card flex flex-col items-center gap-2 p-6 text-center">
            <p className="text-sm font-semibold text-ink">No tasks match these filters</p>
            {filterBar && tableFiltersActive(filters) ? (
              <button type="button" onClick={() => memory.setFilters({ ...EMPTY_TABLE_FILTERS })} className={`text-sm font-semibold text-brand underline ${TOUCH_TALL}`}>
                Clear filters
              </button>
            ) : null}
          </div>
        )
      }
    />
  );
  return duplicatingId ? (
    <>
      {table}
      {/* The copy's notice ("Task MSSP-40 created", with Open) comes from the app shell; every view refreshes. */}
      <TaskFormDialog duplicateOfId={duplicatingId} onClose={() => setDuplicatingId(null)} />
    </>
  ) : (
    table
  );
}

/**
 * 1.24 A task's guests in the table: each by name (company) with the person-outside icon, read out as
 * "Guest: …" (an older server: its contacts in short, by name). Never a link or a button: guests have no access.
 */
function GuestsCell({ task }: { task: ApiTask }) {
  const labels = task.guests?.length
    ? task.guests.map((g) => ({ key: g.id, text: guestLabel(g) }))
    : (task.externalSummary?.names ?? []).map((name, i) => ({ key: `${i}`, text: i === 0 ? guestLabel({ name, company: task.externalSummary!.company }) : name }));
  if (labels.length === 0) return <span className="text-ink-3">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((g) => (
        <span key={g.key} data-testid="table-guest" title={`${GUEST_WORDS.one}: ${g.text}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-ground px-2 py-0.5 text-[11px] font-medium text-ink-2">
          <GuestIcon size={11} />
          <span className="sr-only">{GUEST_WORDS.one}: </span>
          <span dir="auto" className="truncate">{g.text}</span>
        </span>
      ))}
    </span>
  );
}

/** A message above the table (a refused save: an alert; "waiting for approval": a status), dismissible. */
function Banner({ tone, onDismiss, children }: { tone: 'danger' | 'warning'; onDismiss: () => void; children: ReactNode }) {
  return (
    <p role={tone === 'danger' ? 'alert' : 'status'} className={`mb-2 flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-sm ${tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}>
      <span>{children}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className={`flex-none rounded px-1 opacity-80 hover:opacity-100 ${TOUCH_SQUARE}`}>
        ✕
      </button>
    </p>
  );
}

/** The due date: a chip that opens the calendar ("Overdue · 3 Nov" while late), or the words. */
function DueCell({ task, timeZone, today, weekStart, editable, onPick }: { task: ApiTask; timeZone: string; today: string; weekStart: 0 | 1 | 6; editable: boolean; onPick: (day: string | null) => void }) {
  const day = dueDayKey(task.dueDate, timeZone);
  const late = isTaskLate(task, timeZone);
  const words = day ? dayText(day, { year: day.slice(0, 4) !== today.slice(0, 4) }) : 'No due date';
  const text = late ? `Overdue · ${words}` : words;
  const soon = !late && !!day && !isTaskDone(task) && (day === today || day === shiftDayKey(today, 1));
  const tone = dueTone({ late, soon }, day ? 'text-ink' : 'text-ink-3');
  if (!editable) return <span className={`text-xs ${tone}`}>{text}</span>;
  return (
    <DayPickerButton
      ariaLabel={`Due date of ${task.key}: ${day ? dayText(day) : 'No due date'}${late ? ', overdue' : ''}`}
      value={day ?? ''}
      today={today}
      weekStart={weekStart}
      placeholder="No due date"
      clearLabel="No due date"
      onPick={(next) => {
        if ((next ?? null) !== (day ?? null)) onPick(next);
      }}
      className={`inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium outline-none compact:min-h-6 transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-brand/40 ${late ? 'bg-danger-soft' : 'bg-ground'} ${tone}`}
    >
      {text}
    </DayPickerButton>
  );
}

/**
 * A task's people: its faces, and the people who may be put on it to tick on and off (read when first
 * needed) — its project's owner, named manager and team, less anyone the server would refuse: a team
 * member in none of the project's companies any more, or a deactivated person (lib/board-people).
 */
function TaskPeopleCell({ task, project, editable, onToggle }: { task: ApiTask; project: ApiProject | undefined; editable: boolean; onToggle: (p: CellPerson, on: boolean) => void }) {
  const [active, setActive] = useState(false);
  const membersQ = useQuery({
    queryKey: ['members', task.projectId],
    queryFn: () => membersApi(apiClient).list(task.projectId),
    enabled: editable && active,
    staleTime: 60_000,
  });
  const directoryQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory(), enabled: editable && active });
  const members = Array.isArray(membersQ.data) ? membersQ.data : null;
  const people =
    members && project && directoryQ.isFetched
      ? boardPeople(project, members, Array.isArray(directoryQ.data) ? directoryQ.data : []).map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl }))
      : null;
  return (
    <PeopleCell
      what={task.key}
      chosen={task.assignees ?? []}
      editable={editable}
      people={people}
      onActivate={() => setActive(true)}
      onToggle={onToggle}
    />
  );
}
