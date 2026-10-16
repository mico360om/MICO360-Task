import { useMemo, useState } from 'react';
import type { ApiTask } from '../../api/tasks';
import { PriorityBadge } from '../ui/PriorityBadge';
import { Avatar } from '../ui/Avatar';
import { taskPhase, type TaskPhase } from '../../lib/project-dashboard';
import { formatDueDay } from '../../lib/due-display';
import { EmptyNote, FlagIcon } from './parts';

export type TaskFilter = 'all' | TaskPhase | 'milestones';

const FILTERS: Array<{ v: TaskFilter; label: string }> = [
  { v: 'all', label: 'All' },
  { v: 'ongoing', label: 'Ongoing' },
  { v: 'pending', label: 'Pending' },
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

function TaskRow({ task, statusName, statusColor, phase, dueText, onOpen }: { task: ApiTask; statusName: string; statusColor: string; phase: TaskPhase; dueText: string; onOpen: () => void }) {
  const assignees = task.assignees ?? [];
  const overdue = phase === 'overdue';
  const progress = phase === 'completed' ? 100 : Math.max(0, Math.min(100, task.progress ?? 0));
  return (
    <button type="button" onClick={onOpen} className="flex w-full flex-col gap-1.5 px-4 py-2.5 text-start transition-colors hover:bg-ground/60 sm:flex-row sm:items-center sm:gap-3">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="w-16 flex-none font-mono text-xs text-ink-3">{task.key}</span>
        {task.isMilestone ? <span className="text-brand" role="img" aria-label="Milestone" title="Milestone"><FlagIcon /></span> : null}
        <span dir="auto" className={`min-w-0 flex-1 truncate text-start text-sm font-medium ${phase === 'completed' ? 'text-ink-2' : 'text-ink'}`}>{task.title}</span>
      </span>
      <span className="flex flex-wrap items-center gap-2 ps-[4.5rem] sm:flex-nowrap sm:ps-0">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-ground px-2 py-0.5 text-xs font-medium text-ink-2">
          <span className="h-2 w-2 rounded-full" style={{ background: statusColor }} aria-hidden />
          {statusName}
        </span>
        <PriorityBadge priority={task.priority} />
        <span className="flex w-20 items-center gap-1.5" title={`${progress}% done`}>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ground" aria-hidden="true">
            <span className={`block h-full rounded-full ${phase === 'completed' ? 'bg-success' : 'bg-brand'}`} style={{ width: `${progress}%` }} />
          </span>
          <span className="w-8 text-end text-[11px] tabular-nums text-ink-2">{progress}%</span>
        </span>
        {assignees.length ? (
          <span className="flex items-center -space-x-1.5" title={assignees.map((a) => a.name).join(', ')}>
            {assignees.slice(0, 3).map((a) => <Avatar key={a.id} name={a.name} size="sm" />)}
            {assignees.length > 3 ? <span className="grid h-6 w-6 place-items-center rounded-full border border-line bg-ground text-[10px] font-semibold text-ink-2">+{assignees.length - 3}</span> : null}
          </span>
        ) : (
          <span className="text-xs text-ink-3">Unassigned</span>
        )}
        <span className={`w-24 flex-none text-xs tabular-nums sm:text-end ${overdue ? 'font-semibold text-danger' : 'text-ink-2'}`}>
          {overdue ? 'Overdue · ' : ''}{dueText || 'No due date'}
        </span>
      </span>
    </button>
  );
}

/**
 * Every task of the project by status column, narrowed to ongoing, pending, overdue, completed
 * or milestone tasks, or by words — with priority, people, progress and due date on each.
 */
export function TasksTab({
  groups,
  today,
  timeZone,
  loading,
  filter,
  onFilter,
  onOpen,
}: {
  groups: TaskGroup[];
  today: string;
  timeZone: string;
  loading: boolean;
  filter: TaskFilter;
  onFilter: (f: TaskFilter) => void;
  onOpen: (taskId: string) => void;
}) {
  const [q, setQ] = useState('');
  const all = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);
  const counts = useMemo(() => {
    const c: Record<TaskFilter, number> = { all: all.length, ongoing: 0, pending: 0, overdue: 0, completed: 0, milestones: 0 };
    for (const t of all) {
      c[taskPhase(t, today, timeZone)] += 1;
      if (t.isMilestone) c.milestones += 1;
    }
    return c;
  }, [all, today, timeZone]);
  const words = q.trim().toLocaleLowerCase();
  const keep = (t: ApiTask) =>
    (filter === 'all' || (filter === 'milestones' ? !!t.isMilestone : taskPhase(t, today, timeZone) === filter)) &&
    (!words || t.title.toLocaleLowerCase().includes(words) || t.key.toLocaleLowerCase().includes(words));
  const shown = groups.map((g) => ({ ...g, tasks: g.tasks.filter(keep) })).filter((g) => g.tasks.length > 0);

  if (loading) return <div className="skeleton h-40 rounded-xl" aria-label="Loading tasks" />;
  if (all.length === 0) return <div className="card p-8 text-center text-sm text-ink-2">No tasks in this project yet.</div>;

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
              className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${filter === f.v ? 'bg-surface text-ink shadow-soft' : 'text-ink-2 hover:text-ink'} ${f.v === 'overdue' && counts.overdue ? 'text-danger' : ''}`}
            >
              {f.label} <span className="tabular-nums text-ink-3">{counts[f.v]}</span>
            </button>
          ))}
        </div>
        <label className="relative sm:w-60">
          <span className="sr-only">Find a task</span>
          <input type="search" data-page-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a task…" className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
        </label>
      </div>
      {shown.length === 0 ? (
        <EmptyNote>No tasks match.</EmptyNote>
      ) : (
        shown.map((g) => (
          <section key={g.id} aria-label={`${g.name}, ${g.tasks.length}`}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} aria-hidden />
              <h2 className="text-sm font-bold text-ink">{g.name}</h2>
              <span className="rounded-full bg-ground px-2 text-xs font-semibold text-ink-2">{g.tasks.length}</span>
            </div>
            <div className="card divide-y divide-line overflow-hidden">
              {g.tasks.map((t) => (
                <TaskRow key={t.id} task={t} statusName={g.name} statusColor={g.color} phase={taskPhase(t, today, timeZone)} dueText={formatDueDay(t.dueDate, timeZone)} onOpen={() => onOpen(t.id)} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
