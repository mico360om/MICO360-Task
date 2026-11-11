import { useMemo, useState } from 'react';
import type { ApiTask } from '../../api/tasks';
import { PriorityBadge } from '../ui/PriorityBadge';
import { Avatar } from '../ui/Avatar';
import { taskPhase, upcomingDay, type TaskPhase } from '../../lib/project-dashboard';
import { startsText } from '../../lib/scheduled-start';
import { matchesTaskNumber } from '../../lib/task-number';
import { formatDueDay } from '../../lib/due-display';
import { EmptyNote, FlagIcon } from './parts';
import { ClientEyeIcon } from '../TaskCard';
import { TOUCH_TALL } from '../../lib/touch';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { ApprovalChip } from '../approvals/ApprovalChip';
import { GuestsLine } from '../GuestsLine';
import { RowCategoryChips } from '../RowCategoryChips';
import { GuestCategoryFilterBoxes, type GuestCategoryFilterState } from '../GuestCategoryFilters';
import { EMPTY_GUEST_CATEGORY_FILTERS, guestCategoryFiltersActive, guestsMatchWords, matchesGuestCategory } from '../../lib/guest-category-filter';
import { TaskKey } from '../TaskKey';
import { DENSE_FACE, DENSE_STACK, DENSE_TEXT } from '../../lib/density-tokens';
import type { ApiProject } from '../../api/projects';
import type { ApiColumn } from '../../api/columns';
import { READ_ONLY_NOTICE, type ProjectReadOnly } from '../../lib/project-archive';
import { TaskTable } from '../data-table/TaskTable';
import { VIEW_ICONS, ViewSwitch } from '../data-table/ViewSwitch';
import { useViewChoice } from '../data-table/hooks';
import { OVERDUE_CLASS, STATUS_CLASS, dueTone } from '../../lib/colour-classes';
import { StatusPill } from '../ui/StatusPill';
import { useDensity } from '../../lib/density';
import { ChecklistCount, DescriptionLine, PeopleLine, TagChips } from '../DetailLines';
import { taskRef, useBulkSelection } from '../../lib/bulk-selection';
import { BulkTools } from '../bulk/BulkTools';
import { SelectAllBox, TaskSelectBox } from '../bulk/select-boxes';

export type TaskFilter = 'all' | TaskPhase | 'milestones';

const FILTERS: Array<{ v: TaskFilter; label: string }> = [
  { v: 'all', label: 'All' },
  { v: 'ongoing', label: 'Ongoing' },
  { v: 'pending', label: 'Pending' },
  // Tasks scheduled for the future: waiting for a later start day.
  { v: 'upcoming', label: 'Upcoming' },
  { v: 'overdue', label: 'Overdue' },
  { v: 'completed', label: 'Completed' },
  { v: 'milestones', label: 'Milestones' },
];

export interface TaskGroup {
  id: string;
  name: string;
  color: string;
  tasks: ApiTask[];
}

/** The list's last group: the tasks waiting for a later start day (tasks scheduled for the future). */
const UPCOMING_GROUP = 'upcoming';

function TaskRow({ task, statusName, phase, dueText, startsOn, onOpen, selected, onToggleSelect }: { task: ApiTask; statusName: string; phase: TaskPhase; dueText: string; startsOn?: string | null; onOpen: () => void; selected?: boolean; onToggleSelect?: (shift: boolean) => void }) {
  const assignees = task.assignees ?? [];
  // Detailed (1.23.8, lib/density): the title wraps; its description's first line, tags and everyone on it.
  const density = useDensity();
  const detailed = density === 'detailed';
  const overdue = phase === 'overdue';
  const progress = phase === 'completed' ? 100 : Math.max(0, Math.min(100, task.progress ?? 0));
  const row = (
    // Compact rows (1.23.0, lib/density): a third less padding, the title a step smaller.
    <button type="button" onClick={onOpen} className={`flex w-full min-w-0 flex-col gap-1.5 py-2.5 text-start transition-colors compact:py-1.5 hover:bg-ground/60 sm:flex-row sm:items-center sm:gap-3 ${onToggleSelect ? 'pe-4 ps-1' : 'px-4'}`}>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {/* At least 4rem so the titles line up; a longer number (MICO360-10) widens it, never breaks. */}
        <span className="flex min-w-16 flex-none"><TaskKey value={task.key} dense="compact" /></span>
        {task.isMilestone ? <span className="text-brand" role="img" aria-label="Milestone" title="Milestone"><FlagIcon /></span> : null}
        {task.clientVisible ? <span className="text-info" role="img" aria-label="Visible to client" title="Visible to client"><ClientEyeIcon size={13} /></span> : null}
        <span className="flex min-w-0 flex-1 flex-col">
          {/* 1.24: its categories beside the title (Detailed: every one, on a line under it). */}
          <span className={`flex min-w-0 items-center gap-x-2 gap-y-0.5 ${detailed ? 'flex-wrap' : 'max-sm:flex-wrap'}`}>
            <span dir="auto" className={`min-w-0 ${detailed ? 'break-words' : 'flex-1 truncate'} text-start text-sm font-medium ${DENSE_TEXT} ${phase === 'completed' ? 'text-ink-2' : 'text-ink'}`}>{task.title}</span>
            <RowCategoryChips categories={task.categories} density={density} />
          </span>
          {detailed ? <DescriptionLine description={task.description} as="span" /> : null}
          <GuestsLine guests={task.guests} summary={task.externalSummary} />
          {detailed ? <TagChips tags={task.tags} className="mt-0.5" /> : null}
          {detailed && assignees.length > 0 ? <PeopleLine people={assignees} className="mt-0.5" as="span" /> : null}
          {detailed ? <ChecklistCount counts={task.counts} className="mt-0.5" /> : null}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 ps-[4.5rem] sm:flex-nowrap sm:ps-0">
        <StatusPill category={task.columnCategory} label={statusName} />
        {startsOn ? <span className="inline-flex flex-none items-center rounded-md bg-info-soft px-1.5 py-0.5 text-[11px] font-semibold text-info">{startsOn}</span> : null}
        {task.approvalRequestedAt ? <ApprovalChip /> : null}
        <PriorityBadge priority={task.priority} />
        <span className="flex w-20 items-center gap-1.5" title={`${progress}% done`}>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ground" aria-hidden="true">
            <span className={`block h-full rounded-full ${phase === 'completed' ? STATUS_CLASS.DONE.dot : 'bg-brand'}`} style={{ width: `${progress}%` }} />
          </span>
          <span className="w-8 text-end text-[11px] tabular-nums text-ink-2">{progress}%</span>
        </span>
        {assignees.length ? (
          <span className={`flex items-center -space-x-1.5 ${DENSE_STACK}`} title={assignees.map((a) => a.name).join(', ')}>
            {assignees.slice(0, 3).map((a) => <Avatar key={a.id} name={a.name} size="sm" dense />)}
            {assignees.length > 3 ? <span className={`grid h-6 w-6 place-items-center rounded-full border border-line bg-ground text-[10px] font-semibold text-ink-2 ${DENSE_FACE}`}>+{assignees.length - 3}</span> : null}
          </span>
        ) : (
          <span className="text-xs text-ink-3">Unassigned</span>
        )}
        {/* Wide enough for "Overdue · Oct 27, 2026" on one line, so every row is the same height. */}
        <span className={`w-24 flex-none text-xs tabular-nums sm:text-end lg:w-40 lg:whitespace-nowrap ${dueTone({ late: overdue })}`}>
          {overdue ? 'Overdue · ' : ''}{dueText || 'No due date'}
        </span>
      </span>
    </button>
  );
  // Bulk changes: the row's box sits beside its button (never inside it).
  return onToggleSelect ? (
    <div className={`flex items-start sm:items-center ${selected ? 'bg-brand/5' : ''}`}>
      <TaskSelectBox task={task} checked={!!selected} onChange={onToggleSelect} className="ms-2 mt-1.5 sm:mt-0" />
      {row}
    </div>
  ) : (
    row
  );
}

const VIEWS = [
  { value: 'list' as const, label: 'List', icon: VIEW_ICONS.list },
  { value: 'table' as const, label: 'Table', icon: VIEW_ICONS.table },
];

/**
 * Every task of the project by status column, narrowed to ongoing, pending, overdue, completed
 * or milestone tasks, or by words (its title, key or a guest's name or company) — with priority,
 * people, categories, guests, progress and due date on each. 1.23.0: shown as that list or as a table
 * (List | Table, remembered for the person), the table changed in place. 1.24: and by guest, guest
 * company or category.
 */
export function TasksTab({
  groups,
  today,
  timeZone,
  loading,
  filter,
  onFilter,
  onOpen,
  onNew,
  project,
  columns,
  readOnly = null,
}: {
  groups: TaskGroup[];
  today: string;
  timeZone: string;
  loading: boolean;
  filter: TaskFilter;
  onFilter: (f: TaskFilter) => void;
  onOpen: (taskId: string) => void;
  /** Add a task to this project (absent when it takes no new work). */
  onNew?: () => void;
  /** The project and its columns, for the Table view (without them there is only the list). */
  project?: ApiProject;
  columns?: ApiColumn[];
  /** Archived or completed: the table is to look at. */
  readOnly?: ProjectReadOnly | null;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<GuestCategoryFilterState>(EMPTY_GUEST_CATEGORY_FILTERS);
  const [chosenView, setView] = useViewChoice('project-tasks.view', ['list', 'table'] as const, 'list');
  const view = project && columns ? chosenView : 'list';
  const all = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);
  const counts = useMemo(() => {
    const c: Record<TaskFilter, number> = { all: all.length, ongoing: 0, pending: 0, upcoming: 0, overdue: 0, completed: 0, milestones: 0 };
    for (const t of all) {
      c[taskPhase(t, today, timeZone)] += 1;
      if (t.isMilestone) c.milestones += 1;
    }
    return c;
  }, [all, today, timeZone]);
  const words = q.trim().toLocaleLowerCase('en');
  const keep = (t: ApiTask) =>
    (filter === 'all' || (filter === 'milestones' ? !!t.isMilestone : taskPhase(t, today, timeZone) === filter)) &&
    (!words || t.title.toLocaleLowerCase('en').includes(words) || t.key.toLocaleLowerCase('en').includes(words) || guestsMatchWords(t, words) || matchesTaskNumber(words, t.key, t.formerKeys)) &&
    matchesGuestCategory(t, picked);
  // Tasks scheduled for the future: the waiting ones leave their columns for a last "Upcoming" group,
  // soonest start first (each row keeps its column's name).
  const columnOf = new Map(groups.flatMap((g) => g.tasks.map((t) => [t.id, g.name] as const)));
  const waiting = (t: ApiTask) => upcomingDay(t, today) !== null;
  const upcoming = all.filter((t) => waiting(t) && keep(t)).sort((a, b) => upcomingDay(a, today)!.localeCompare(upcomingDay(b, today)!, 'en'));
  const shown = [
    ...groups.map((g) => ({ ...g, tasks: g.tasks.filter((t) => !waiting(t) && keep(t)) })),
    { id: UPCOMING_GROUP, name: 'Upcoming', color: '', tasks: upcoming },
  ].filter((g) => g.tasks.length > 0);
  // Bulk changes (owner, 10 Nov): ticked tasks stay ticked through the chips, words and filters.
  // A project that takes no changes (archived or completed) has no boxes.
  const sel = useBulkSelection(project?.id);
  const selecting = Boolean(project) && !readOnly;
  const shownTasks = shown.flatMap((g) => g.tasks);
  const shownIds = shownTasks.map((t) => t.id);
  const shownRefs = shownTasks.map(taskRef);
  const allState = sel.allState(shownIds);
  const narrowed = filter !== 'all' || Boolean(words) || guestCategoryFiltersActive(picked) > 0;

  if (loading) return <div className="skeleton h-40 rounded-xl" role="status" aria-label="Loading tasks" />;
  if (all.length === 0) {
    return (
      <EmptyState
        title="No tasks in this project yet"
        description="Tasks are the work to be done: each has its people, a due date and a place on the board."
        action={onNew ? <Button onClick={onNew} className={TOUCH_TALL}>+ New task</Button> : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Show tasks" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-ground p-1">
          {FILTERS.map((f) => (
            <button
              key={f.v}
              type="button"
              aria-pressed={filter === f.v}
              onClick={() => onFilter(f.v)}
              // flex-none: on a phone the chips keep their words whole and the group scrolls sideways
              // (shrunk to their 44px touch minimum, the words ran into each other).
              className={`flex-none whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${TOUCH_TALL} [@media(pointer:coarse)]:!min-w-11 ${filter === f.v ? 'bg-surface text-ink shadow-soft' : 'text-ink-2 hover:text-ink'} ${f.v === 'overdue' && counts.overdue ? OVERDUE_CLASS.text : ''}`}
            >
              {f.label} <span className="tabular-nums text-ink-3">{counts[f.v]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1 sm:w-60 sm:flex-none">
            <span className="sr-only">Find a task</span>
            <input type="search" data-page-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a task…" className="h-9 [@media(pointer:coarse)]:h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
          </label>
          {project && columns ? <ViewSwitch label="Show tasks as" value={view} onChange={setView} options={VIEWS} /> : null}
        </div>
      </div>
      {/* 1.24: Guest, Guest company and Category — each only when the project's tasks give it a choice. */}
      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        <GuestCategoryFilterBoxes rows={all} value={picked} onChange={setPicked} box="min-w-0 max-sm:flex-[1_1_calc(50%-0.25rem)] sm:w-48" />
        {guestCategoryFiltersActive(picked) > 0 ? (
          <button type="button" onClick={() => setPicked(EMPTY_GUEST_CATEGORY_FILTERS)} className={`rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-ground hover:text-ink ${TOUCH_TALL}`}>
            Clear
          </button>
        ) : null}
      </div>
      {selecting && shownTasks.length > 0 ? (
        <label className={`flex w-fit items-center gap-1.5 text-xs font-medium text-ink-2 ${TOUCH_TALL}`}>
          <SelectAllBox state={allState} onChange={() => (allState === 'all' ? sel.deselect(shownIds) : sel.selectAll(shownRefs))} />
          Select all {shownTasks.length}
          {narrowed ? ' matching' : ''}
        </label>
      ) : null}
      {view === 'table' && project && columns && readOnly ? (
        // An archived or completed project's table is there to look at, and says why (the board's notice).
        <p role="status" data-read-only={readOnly} className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-2">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-ink-3">
            <rect x="3" y="4" width="18" height="5" rx="1" />
            <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
          </svg>
          <span>{READ_ONLY_NOTICE[readOnly]}</span>
        </p>
      ) : null}
      {view === 'table' && project && columns ? (
        // The tab's phase chips and words apply; the rows as the list has them, column by column.
        <TaskTable
          page="project-tasks"
          label={`Tasks of ${project.name}`}
          tasks={shown.flatMap((g) => g.tasks)}
          projects={[project]}
          columns={columns}
          readOnly={readOnly}
          onOpen={(id) => onOpen(id)}
          empty={<EmptyNote>No tasks match.</EmptyNote>}
          // (Its "Select all" is the tab's own, above.)
          selection={selecting ? { selected: sel.selected, onToggle: (t, { shift, order }) => sel.toggle(taskRef(t), { shift, order: order.map(taskRef) }) } : undefined}
        />
      ) : shown.length === 0 ? (
        <EmptyNote>No tasks match.</EmptyNote>
      ) : (
        shown.map((g) => (
          <section key={g.id} aria-label={`${g.name}, ${g.tasks.length}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
              {g.id === UPCOMING_GROUP ? (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-info">
                  <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
              ) : (
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} aria-hidden />
              )}
              <h2 className="text-sm font-bold text-ink">{g.name}</h2>
              <span className="rounded-full bg-ground px-2 text-xs font-semibold text-ink-2">{g.tasks.length}</span>
              {g.id === UPCOMING_GROUP ? <span className="text-xs text-ink-2">Scheduled to start later — each joins the list on its start day.</span> : null}
            </div>
            <div className="card divide-y divide-line overflow-hidden">
              {g.tasks.map((t) => {
                const startsOn = upcomingDay(t, today);
                return (
                  <TaskRow
                    key={t.id}
                    task={t}
                    statusName={columnOf.get(t.id) ?? g.name}
                    phase={taskPhase(t, today, timeZone)}
                    dueText={formatDueDay(t.dueDate, timeZone)}
                    startsOn={startsOn ? startsText(startsOn, today) : null}
                    onOpen={() => onOpen(t.id)}
                    selected={sel.has(t.id)}
                    onToggleSelect={selecting ? (shift) => sel.toggle(taskRef(t), { shift, order: shownRefs }) : undefined}
                  />
                );
              })}
            </div>
          </section>
        ))
      )}
      {selecting && project ? <BulkTools selection={sel} visibleIds={shownIds} projects={[project]} assignedOf={(id) => all.find((t) => t.id === id)?.assignees} /> : null}
    </div>
  );
}
