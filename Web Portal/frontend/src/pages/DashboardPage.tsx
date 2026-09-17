import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { projectsApi } from '../api/projects';
import { reportsApi } from '../api/reports';
import { tasksApi, type ApiTask } from '../api/tasks';
import { activityApi, type ApiActivity } from '../api/activity';
import { useAuthStore } from '../stores/auth-store';
import { StatTile } from '../components/StatTile';
import { BarChart } from '../components/BarChart';
import { Reveal } from '../components/ui/Reveal';
import { EmptyState } from '../components/ui/EmptyState';
import { Avatar } from '../components/ui/Avatar';
import { PriorityBadge } from '../components/ui/PriorityBadge';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { TaskDrawerContainer } from '../components/TaskDrawerContainer';

// Category colours reference the shared design tokens (rgb(var(--…))) so the
// charts adapt to light/dark theme instead of being pinned to light-mode hex.
const CATEGORY_COLOR: Record<string, string> = {
  BACKLOG: 'rgb(var(--c-cat-backlog))', TODO: 'rgb(var(--c-cat-todo))',
  IN_PROGRESS: 'rgb(var(--c-cat-progress))', BLOCKED: 'rgb(var(--c-cat-blocked))',
  REVIEW: 'rgb(var(--c-cat-review))', DONE: 'rgb(var(--c-cat-done))',
};

/** Traffic-light colour for a completion percentage, so the bar reads its health at a glance. */
const completionColor = (pct: number): string =>
  pct >= 67 ? 'rgb(var(--c-success))' : pct >= 34 ? 'rgb(var(--c-warning))' : 'rgb(var(--c-danger))';

const icon = {
  tasks: <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  layers: <path d="M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5" />,
  alert: <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>,
};

function StatIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const ACTION_LABEL: Record<string, string> = {
  CREATED: 'created', MOVED: 'moved', COMPLETED: 'completed', REOPENED: 'reopened', ASSIGNED: 'assigned to',
};
const actionLabel = (a: string) => ACTION_LABEL[a] ?? (a || '').toLowerCase().replace(/_/g, ' ');
const actionTone = (a: string): string =>
  a === 'COMPLETED' ? 'text-success' : a === 'MOVED' ? 'text-info' : a === 'CREATED' ? 'text-brand' : a === 'REOPENED' ? 'text-warning' : 'text-ink-2';

function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s) || s < 0) return '';
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** How a task's due date reads relative to today. */
function dueMeta(due: string): { label: string; overdue: boolean } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due);
  d.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { label: `${-days}d overdue`, overdue: true };
  if (days === 0) return { label: 'Due today', overdue: false };
  if (days === 1) return { label: 'Due tomorrow', overdue: false };
  return { label: `Due in ${days}d`, overdue: false };
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [projectFilter, setProjectFilter] = useState('');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const myTasksQ = useQuery({ queryKey: ['my-tasks'], queryFn: () => tasksApi(apiClient).mine() });
  const allTasksQ = useQuery({ queryKey: ['tasks', 'all'], queryFn: () => tasksApi(apiClient).list() });
  const activityQ = useQuery({ queryKey: ['activity'], queryFn: () => activityApi(apiClient).recent() });
  const statusQ = useQuery({ queryKey: ['report-status'], queryFn: () => reportsApi(apiClient).status(), enabled: isAdmin });
  const perfQ = useQuery({ queryKey: ['report-projects'], queryFn: () => reportsApi(apiClient).projectPerformance(), enabled: isAdmin });

  const perf = perfQ.data ?? [];
  const totals = perf.reduce(
    (acc, p) => ({ total: acc.total + p.total, completed: acc.completed + p.completed, overdue: acc.overdue + p.overdue }),
    { total: 0, completed: 0, overdue: 0 },
  );
  const statusData = Object.entries(statusQ.data ?? {}).map(([category, count]) => ({
    label: category, value: count, color: CATEGORY_COLOR[category] ?? 'rgb(var(--c-brand))',
  }));
  const perfFiltered = projectFilter ? perf.filter((p) => p.projectId === projectFilter) : perf;
  const perfData = perfFiltered.map((p) => ({ label: p.projectName, value: p.completionPct, color: completionColor(p.completionPct) }));

  // Upcoming + overdue work needing attention, earliest first.
  const dueSoon = useMemo(
    () =>
      [...(allTasksQ.data ?? [])]
        .filter((t) => t.dueDate && !t.completedAt)
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
        .slice(0, 6),
    [allTasksQ.data],
  );
  const recent = (activityQ.data ?? []).slice(0, 6);

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="flex flex-col gap-6">
      {/* Welcome hero */}
      <div className="relative overflow-hidden rounded-3xl bg-brand-gradient p-6 text-white shadow-brand animate-fade-in-up sm:p-8">
        <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-black/10 blur-2xl" />
        <div className="relative">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{today}</div>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tightish sm:text-4xl">
            Welcome back, {user?.username ?? 'there'}.
          </h1>
          <p className="mt-2 max-w-xl text-sm text-white/80 sm:text-[15px]">
            Here’s a snapshot of your work. Jump into a board, review what’s due, and keep things moving.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/board" className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-brand shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift">
              Open board
            </Link>
            <Link to="/my-tasks" className="rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-white/20">
              View my tasks
            </Link>
          </div>
        </div>
      </div>

      {/* Stat tiles — each links to the relevant page */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Reveal delay={1}><Link to="/my-tasks" className="block"><StatTile label="My tasks" value={myTasksQ.data?.length ?? '—'} tone="brand" icon={<StatIcon>{icon.tasks}</StatIcon>} hint="Assigned to you" /></Link></Reveal>
        <Reveal delay={2}><Link to="/projects" className="block"><StatTile label="Projects" value={projectsQ.data?.length ?? '—'} tone="info" icon={<StatIcon>{icon.folder}</StatIcon>} hint="Active workspaces" /></Link></Reveal>
        {isAdmin ? <Reveal delay={3}><Link to="/reports" className="block"><StatTile label="All tasks" value={perfQ.data ? totals.total : '—'} tone="success" icon={<StatIcon>{icon.layers}</StatIcon>} hint={perfQ.data ? `${totals.completed} completed` : undefined} /></Link></Reveal> : null}
        {isAdmin ? <Reveal delay={4}><Link to="/reports" className="block"><StatTile label="Overdue" value={perfQ.data ? totals.overdue : '—'} tone="danger" icon={<StatIcon>{icon.alert}</StatIcon>} hint={perfQ.data && totals.total ? `${Math.round((totals.overdue / totals.total) * 100)}% of tasks` : undefined} /></Link></Reveal> : null}
      </div>

      {/* Main content: charts / open tasks (left) + due soon & activity (right rail) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {isAdmin ? (
            <>
              <Reveal>
                <section className="card p-5">
                  <h2 className="eyebrow mb-3">Tasks by status</h2>
                  {statusQ.isError ? <p className="text-sm text-danger">Couldn’t load (admin only).</p> : <BarChart data={statusData} />}
                </section>
              </Reveal>
              <Reveal delay={1}>
                <section className="card p-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="eyebrow">Project completion</h2>
                    <div className="w-44">
                      <SearchableSelect
                        ariaLabel="Filter by project"
                        value={projectFilter}
                        onChange={(v) => setProjectFilter(v)}
                        options={[{ value: '', label: 'All projects' }, ...perf.map((p) => ({ value: p.projectId, label: p.projectName }))]}
                      />
                    </div>
                  </div>
                  <BarChart data={perfData} unit="%" />
                </section>
              </Reveal>
            </>
          ) : (
            <Reveal>
              <section className="card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="eyebrow">Your open tasks</h2>
                  <Link to="/my-tasks" className="text-xs font-semibold text-brand hover:underline">View all</Link>
                </div>
                {(myTasksQ.data ?? []).length === 0 ? (
                  <EmptyState bare title="Nothing assigned to you" description="Tasks assigned to you will appear here." />
                ) : (
                  <ul className="flex flex-col">
                    {(myTasksQ.data ?? []).slice(0, 8).map((t) => (
                      <TaskRow key={t.id} task={t} onOpen={() => setOpenTaskId(t.id)} />
                    ))}
                  </ul>
                )}
              </section>
            </Reveal>
          )}
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4">
          <Reveal delay={1}>
            <section className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="eyebrow">Due soon</h2>
                <Link to="/calendar" className="text-xs font-semibold text-brand hover:underline">Calendar</Link>
              </div>
              {dueSoon.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-2">Nothing due — you’re all clear. 🎉</p>
              ) : (
                <ul className="flex flex-col">
                  {dueSoon.map((t) => (
                    <TaskRow key={t.id} task={t} onOpen={() => setOpenTaskId(t.id)} showDue />
                  ))}
                </ul>
              )}
            </section>
          </Reveal>

          <Reveal delay={2}>
            <section className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="eyebrow">Recent activity</h2>
                <Link to="/activity" className="text-xs font-semibold text-brand hover:underline">View all</Link>
              </div>
              {recent.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-2">No activity yet.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {recent.map((a) => (
                    <ActivityRow key={a.id} a={a} onOpenTask={(id) => setOpenTaskId(id)} />
                  ))}
                </ul>
              )}
            </section>
          </Reveal>
        </div>
      </div>

      {openTaskId ? <TaskDrawerContainer taskId={openTaskId} onClose={() => setOpenTaskId(null)} /> : null}
    </div>
  );
}

function TaskRow({ task, onOpen, showDue }: { task: ApiTask; onOpen: () => void; showDue?: boolean }) {
  const due = showDue && task.dueDate ? dueMeta(task.dueDate) : null;
  return (
    <li>
      <button
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-ground"
      >
        <span className="rounded-md bg-ground px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{task.key}</span>
        <span className="min-w-0 flex-1 truncate text-ink">{task.title}</span>
        {due ? (
          <span className={`whitespace-nowrap text-xs font-medium ${due.overdue ? 'text-danger' : 'text-ink-2'}`}>{due.label}</span>
        ) : (
          <PriorityBadge priority={task.priority} />
        )}
      </button>
    </li>
  );
}

function ActivityRow({ a, onOpenTask }: { a: ApiActivity; onOpenTask: (taskId: string) => void }) {
  const who = a.actor?.name ?? 'Someone';
  return (
    <li className="flex gap-2 text-sm">
      <Avatar name={who} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="leading-snug text-ink">
          <span className="font-semibold">{who}</span> <span className={actionTone(a.action)}>{actionLabel(a.action)}</span>{' '}
          {a.task ? (
            <button onClick={() => onOpenTask(a.task!.id)} className="font-mono text-xs text-brand hover:underline">{a.task.key}</button>
          ) : a.project ? (
            <span className="text-ink-2">{a.project.name}</span>
          ) : null}
        </p>
        <p className="text-[11px] text-ink-2">{timeAgo(a.createdAt)}</p>
      </div>
    </li>
  );
}
