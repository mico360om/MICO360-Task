import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { projectsApi } from '../api/projects';
import { tasksApi, type ApiTask, type Priority } from '../api/tasks';
import { groupTasksByDueDate, monthGrid, weekDays } from '../lib/calendar';
import { PageHeader } from '../components/ui/PageHeader';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { TaskDrawerContainer } from '../components/TaskDrawerContainer';

type View = 'month' | 'week' | 'agenda';

const PRIORITY_DOT: Record<Priority, string> = {
  LOW: 'bg-ink-3',
  NORMAL: 'bg-info',
  HIGH: 'bg-warning',
  URGENT: 'bg-danger',
};
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n: number) => String(n).padStart(2, '0');
const localTodayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const keyLabel = (key: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${key}T00:00:00`).toLocaleDateString('en-US', opts);
const isDone = (t: ApiTask) => t.completedAt != null;

/** A task chip used across the calendar views: project-colour bar + priority dot + title, click to open. */
function TaskChip({ task, dayKey, color, onOpen }: { task: ApiTask; dayKey: string; color?: string; onOpen: (id: string) => void }) {
  const overdue = dayKey < localTodayKey() && !isDone(task);
  const leftBar = !overdue && color ? { borderLeftColor: color, borderLeftWidth: '3px' } : undefined;
  return (
    <button
      onClick={() => onOpen(task.id)}
      title={`${task.key} · ${task.title}`}
      style={leftBar}
      className={`flex w-full items-center gap-1.5 truncate rounded-md border px-1.5 py-1 text-left text-[11px] transition-colors hover:border-brand/40 hover:bg-brand/5 ${
        overdue ? 'border-danger/30 bg-danger/10 text-danger' : 'border-line bg-surface text-ink'
      } ${isDone(task) ? 'opacity-60' : ''}`}
    >
      <span className={`h-1.5 w-1.5 flex-none rounded-full ${PRIORITY_DOT[task.priority]}`} aria-hidden="true" title={task.priority} />
      <span className={`truncate ${isDone(task) ? 'line-through' : ''}`}>{task.title}</span>
    </button>
  );
}

export function CalendarPage() {
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [projectFilter, setProjectFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const tasksQ = useQuery({ queryKey: ['calendar-tasks'], queryFn: () => tasksApi(apiClient).list() });

  const allTasks = tasksQ.data ?? [];
  const tasks = useMemo(
    () =>
      allTasks.filter(
        (t) =>
          (!projectFilter || t.projectId === projectFilter) &&
          (!assigneeFilter || (t.assignees ?? []).some((a) => a.id === assigneeFilter)),
      ),
    [allTasks, projectFilter, assigneeFilter],
  );

  const byDate = useMemo(() => {
    const m = new Map<string, ApiTask[]>();
    for (const g of groupTasksByDueDate(tasks)) m.set(g.date, g.tasks);
    return m;
  }, [tasks]);

  const assigneeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of allTasks) for (const a of t.assignees ?? []) m.set(a.id, a.name);
    return [{ value: '', label: 'Everyone' }, ...[...m].map(([value, label]) => ({ value, label }))];
  }, [allTasks]);
  const projectOptions = [
    { value: '', label: 'All projects' },
    ...(projectsQ.data ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.code })),
  ];
  const projectColor = useMemo(() => {
    const m = new Map((projectsQ.data ?? []).map((p) => [p.id, p.color] as const));
    return (id: string) => m.get(id);
  }, [projectsQ.data]);

  const today = localTodayKey();
  const shift = (days: number, months = 0) => {
    const d = new Date(cursor);
    if (months) d.setMonth(d.getMonth() + months);
    if (days) d.setDate(d.getDate() + days);
    setCursor(d);
  };

  const periodLabel =
    view === 'month'
      ? cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : view === 'week'
        ? (() => {
            const wd = weekDays(`${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`);
            return `${keyLabel(wd[0]!, { month: 'short', day: 'numeric' })} – ${keyLabel(wd[6]!, { month: 'short', day: 'numeric', year: 'numeric' })}`;
          })()
        : 'Upcoming';

  const btn = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${active ? 'bg-brand text-white shadow-brand' : 'text-ink-2 hover:bg-ground'}`;

  return (
    <div>
      <PageHeader eyebrow="Workspace" title="Calendar" subtitle="Task due dates across your projects." />

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-xl border border-line bg-surface p-0.5">
          {(['month', 'week', 'agenda'] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)} className={btn(view === v)}>
              {v[0]!.toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        {view !== 'agenda' ? (
          <div className="flex items-center gap-1">
            <button onClick={() => shift(view === 'week' ? -7 : 0, view === 'month' ? -1 : 0)} aria-label="Previous" className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-2 transition-colors hover:bg-ground">‹</button>
            <button onClick={() => setCursor(new Date())} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-ground">Today</button>
            <button onClick={() => shift(view === 'week' ? 7 : 0, view === 'month' ? 1 : 0)} aria-label="Next" className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-2 transition-colors hover:bg-ground">›</button>
          </div>
        ) : null}
        <span className="font-display text-lg font-bold text-ink">{periodLabel}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="w-40"><SearchableSelect ariaLabel="Filter by project" value={projectFilter} onChange={setProjectFilter} options={projectOptions} /></div>
          <div className="w-40"><SearchableSelect ariaLabel="Filter by assignee" value={assigneeFilter} onChange={setAssigneeFilter} options={assigneeOptions} /></div>
        </div>
      </div>

      {tasksQ.isLoading || projectsQ.isLoading ? (
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-lg" />)}
        </div>
      ) : tasksQ.isError ? (
        <p role="alert" className="text-danger">Couldn’t load the calendar. <button className="font-semibold underline" onClick={() => tasksQ.refetch()}>Retry</button></p>
      ) : view === 'month' ? (
        <div className="card overflow-hidden p-0">
          {/* On narrow screens the 7-column grid would crush cells; scroll horizontally instead. */}
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
          <div className="grid grid-cols-7 border-b border-line bg-ground/40">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} className="px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-2">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthGrid(cursor.getFullYear(), cursor.getMonth()).flat().map((cell) => {
              const dayTasks = byDate.get(cell.key) ?? [];
              const isToday = cell.key === today;
              return (
                <div key={cell.key} className={`min-h-[92px] border-b border-r border-line p-1 ${cell.inMonth ? '' : 'bg-ground/30'}`}>
                  <div className="mb-1 flex justify-end">
                    <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${isToday ? 'bg-brand text-white' : cell.inMonth ? 'text-ink-2' : 'text-ink-3'}`}>{cell.day}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {dayTasks.slice(0, 3).map((t) => <TaskChip key={t.id} task={t} dayKey={cell.key} color={projectColor(t.projectId)} onOpen={setOpenTaskId} />)}
                    {dayTasks.length > 3 ? <span className="px-1 text-[10px] font-medium text-ink-2">+{dayTasks.length - 3} more</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
            </div>
          </div>
        </div>
      ) : view === 'week' ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
          {weekDays(`${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`).map((key) => {
            const dayTasks = byDate.get(key) ?? [];
            const isToday = key === today;
            return (
              <div key={key} className="card min-h-[140px] p-2">
                <div className={`mb-2 flex items-center justify-between rounded-md px-1.5 py-0.5 ${isToday ? 'bg-brand/10 text-brand' : 'text-ink-2'}`}>
                  <span className="text-xs font-bold">{keyLabel(key, { weekday: 'short' })}</span>
                  <span className="text-xs font-semibold">{keyLabel(key, { day: 'numeric' })}</span>
                </div>
                <div className="flex flex-col gap-1">
                  {dayTasks.length === 0 ? <span className="px-1 text-[11px] text-ink-3">—</span> : dayTasks.map((t) => <TaskChip key={t.id} task={t} dayKey={key} color={projectColor(t.projectId)} onOpen={setOpenTaskId} />)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // Agenda
        <div className="flex flex-col gap-4">
          {(() => {
            const groups = groupTasksByDueDate(tasks).filter((g) => g.date >= today || g.tasks.some((t) => !isDone(t)));
            if (groups.length === 0) return <div className="card p-8 text-center text-ink-2">No tasks with due dates match these filters.</div>;
            return groups.map((g) => (
              <div key={g.date}>
                <div className={`mb-1 text-xs font-semibold uppercase tracking-wide ${g.date < today ? 'text-danger' : g.date === today ? 'text-brand' : 'text-ink-2'}`}>
                  {g.date === today ? 'Today · ' : ''}{keyLabel(g.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <div className="flex flex-col gap-1">
                  {g.tasks.map((t) => (
                    <button key={t.id} onClick={() => setOpenTaskId(t.id)} className="flex items-center gap-2 rounded-lg border border-line bg-surface p-2 text-left text-sm transition-colors hover:border-brand/40 hover:bg-brand/5">
                      <span className={`h-2 w-2 flex-none rounded-full ${PRIORITY_DOT[t.priority]}`} aria-hidden="true" />
                      <span className="font-mono text-xs text-ink-2">{t.key}</span>
                      <span className={`truncate text-ink ${isDone(t) ? 'line-through opacity-60' : ''}`}>{t.title}</span>
                      {(t.assignees ?? [])[0] ? <span className="ml-auto flex-none text-xs text-ink-2">{t.assignees![0]!.name}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            ));
          })()}
        </div>
      )}

      {openTaskId ? <TaskDrawerContainer taskId={openTaskId} onClose={() => setOpenTaskId(null)} /> : null}
    </div>
  );
}
