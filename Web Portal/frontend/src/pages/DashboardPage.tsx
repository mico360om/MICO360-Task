import { useWorkingTime } from '../lib/useWorkingTime';
import { workingDaysLate, type WorkCalendar } from '../lib/working-days';
import { useEffectiveAdmin } from '../lib/manager-view';
import { dayText, instantDayText } from '../lib/day-words';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { TaskKey, TaskKeyButton } from '../components/TaskKey';
import { PriorityBadge } from '../components/ui/PriorityBadge';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { namedProjectOption } from '../components/project-option';
import { daysUntilDue, dueDayKey, todayKey } from '../lib/due-date';
import { useOpenTask } from '../lib/useOpenTask';
import { isTaskDone } from '../lib/due-display';
import { waitingDay } from '../lib/scheduled-start';
import { useCompanyTimeZone } from '../lib/company-clock';
import { LoadError } from '../components/ui/LoadError';
import { STATUS_META, STATUS_ORDER } from '../lib/taskStatus';
import { Icon } from '../components/meeting/kit';
import { FirstStepsActions, FirstStepsIcon, useNoProjectsYet } from '../components/FirstSteps';
import { ApprovalsCard } from '../components/approvals/ApprovalsCard';
import { useApprovals } from '../components/approvals/ToApproveSection';
import { PrioritiesWidget } from '../components/dashboard/PrioritiesWidget';
import { CustomizeIcon, CustomizePanel, type LayoutTarget } from '../components/dashboard/CustomizePanel';
import { dashboardApi, LAYOUT_DEFAULTS_KEY, MY_LAYOUT_KEY, type DashboardLayout, type LayoutGroup, type WidgetId, type WidgetSize } from '../api/dashboard';
import { builtInLayout, CUSTOMIZE_WORDS, layoutOrDefault, previewFor, sameLayout } from '../lib/dashboard-layout';
import { ApprovalChip } from '../components/approvals/ApprovalChip';
import { isWaitingForApproval } from '../lib/approvals';
import { myDueCounts } from '../lib/dashboard-tiles';
import { useCompanyWeekStart } from '../lib/useDatePrefs';
import { OVERDUE_CLASS, healthColour, statusColour } from '../lib/colour-classes';
import { dashboardColumns, dashboardSpans, rowsForHeight } from '../lib/dashboard-layout';
import { useElementWidth, useWindowHeight } from '../lib/useElementWidth';
import { OverdueTrainingLink } from '../components/training/OverdueTrainingLink';
import { InstallAppCard } from '../components/install/InstallAppCard';

/** Traffic-light colour for a completion percentage, so the bar reads its health at a glance (1.23.8: the health colours). */
const completionColor = (pct: number): string => healthColour(pct >= 67 ? 'ON_TRACK' : pct >= 34 ? 'AT_RISK' : 'LATE');

/** The welcome band's two links: a white focus ring (the brand-red one vanished on the band), finger-sized on touch. */
const BAND_LINK =
  'inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold transition-all hover:-translate-y-0.5 focus-visible:outline-white [@media(pointer:coarse)]:min-h-11';
/** A stat tile's link fills its grid cell, so the tiles in a row are one height even when a hint wraps. */
const TILE_LINK = 'block h-full';

const icon = {
  tasks: <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  layers: <path d="M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5" />,
  alert: <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>,
  week: <><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M16 2.5v4M8 2.5v4M3 10h18M8 14.5h3" /></>,
};

function StatIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const ACTION_LABEL: Record<string, string> = {
  CREATED: 'created', MOVED: 'moved', COMPLETED: 'completed', REOPENED: 'reopened', ASSIGNED: 'assigned',
  // Task approvals.
  APPROVAL_REQUESTED: 'asked for approval on', APPROVED: 'approved', SENT_BACK: 'sent back', APPROVAL_WITHDRAWN: 'withdrew the approval request on',
  // Companies: a project's companies changed (a line on the project, no task).
  PROJECT_COMPANIES_CHANGED: 'changed the companies of',
};
const actionLabel = (a: string) => ACTION_LABEL[a] ?? (a || '').toLowerCase().replace(/_/g, ' ');
const actionTone = (a: string): string =>
  a === 'COMPLETED' || a === 'APPROVED' ? 'text-success' : a === 'SENT_BACK' ? 'text-warning' : a === 'MOVED' ? 'text-info' : a === 'CREATED' ? 'text-brand' : a === 'REOPENED' ? 'text-warning' : 'text-ink-2';

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

/**
 * How a task's due date reads relative to today (company time zone). Overdue counts working days of the
 * company (Notification & Scheduling: weekends and holidays don't count, as on Management and in the
 * daily email) once its calendar is known.
 */
export function dueMeta(due: string, timeZone: string, cal: WorkCalendar | null = null, now: Date = new Date()): { label: string; overdue: boolean } {
  const days = daysUntilDue(due, timeZone, now) ?? 0;
  if (days < 0) {
    if (!cal) return { label: `${-days}d overdue`, overdue: true };
    const n = workingDaysLate(dueDayKey(due, timeZone)!, todayKey(timeZone, now), cal);
    return { label: n > 0 ? `${n} working day${n === 1 ? '' : 's'} overdue` : 'Overdue', overdue: true };
  }
  if (days === 0) return { label: 'Due today', overdue: false };
  if (days === 1) return { label: 'Due tomorrow', overdue: false };
  return { label: `Due in ${days}d`, overdue: false };
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin());
  // Manager View (owner, 10 Nov): the default arrangement for everyone is a setting — not offered then.
  const settingsAdmin = useEffectiveAdmin();
  const qc = useQueryClient();
  const [projectFilter, setProjectFilter] = useState('');
  // Tasks open in the app shell's task panel, through ?task= in the address (reload, Back, a shared link).
  const openTask = useOpenTask();
  const timeZone = useCompanyTimeZone();

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const myTasksQ = useQuery({ queryKey: ['my-tasks'], queryFn: () => tasksApi(apiClient).mine() });
  const allTasksQ = useQuery({ queryKey: ['tasks', 'all'], queryFn: () => tasksApi(apiClient).list() });
  const activityQ = useQuery({ queryKey: ['activity'], queryFn: () => activityApi(apiClient).recent() });
  const statusQ = useQuery({ queryKey: ['report-status'], queryFn: () => reportsApi(apiClient).status(), enabled: isAdmin });
  const perfQ = useQuery({ queryKey: ['report-projects'], queryFn: () => reportsApi(apiClient).projectPerformance(), enabled: isAdmin });
  // 1.23.4: whether the person can approve (the Approvals widget is theirs only) — the card's own query.
  const approvalsQ = useApprovals();

  // 1.23.4 Smarter Dashboard: the person's arrangement of the widgets (their own, else their group's default).
  const layoutQ = useQuery({ queryKey: MY_LAYOUT_KEY, queryFn: () => dashboardApi(apiClient).myLayout(), staleTime: 60_000 });
  // Only the widgets the person may see (the server's list; while it can't be read, today's visibility).
  const allowed = (w: { id: WidgetId }) => (Array.isArray(layoutQ.data?.widgets) ? layoutQ.data.widgets.includes(w.id) : w.id === 'status-chart' || w.id === 'completion' ? isAdmin : true);
  const savedRaw = layoutOrDefault(layoutQ.data?.layout, isAdmin);
  const saved = { widgets: savedRaw.widgets.filter(allowed) };
  const [editing, setEditing] = useState<{ target: LayoutTarget; draft: DashboardLayout; reset: boolean } | null>(null);
  const [said, setSaid] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const defaultsQ = useQuery({ queryKey: LAYOUT_DEFAULTS_KEY, queryFn: () => dashboardApi(apiClient).defaults(), enabled: settingsAdmin && !!editing && editing.target !== 'mine' });
  const defaultOf = (group: LayoutGroup) => layoutOrDefault(defaultsQ.data?.[group] ?? builtInLayout(group === 'admins'), group === 'admins');
  // While an administrator arranges a default that hasn't loaded yet, its draft waits for it.
  const waitingForDefault = !!editing && editing.target !== 'mine' && editing.draft.widgets.length === 0;
  useEffect(() => {
    if (!editing || editing.target === 'mine' || editing.draft.widgets.length > 0) return;
    if (defaultsQ.data) setEditing({ ...editing, draft: defaultOf(editing.target) });
    else if (defaultsQ.isError) setEditing({ ...editing, draft: builtInLayout(editing.target === 'admins') });
  }, [defaultsQ.data, defaultsQ.isError, editing]);
  const layout = editing ? previewFor(editing.draft, editing.target === 'everyone' ? 'everyone' : 'admins') : saved;

  // Focus goes back to "Customize dashboard" when the panel closes (it had moved into the panel).
  const customizeButton = useRef<HTMLButtonElement>(null);
  const [backToButton, setBackToButton] = useState(false);
  useEffect(() => {
    if (editing || !backToButton) return;
    customizeButton.current?.focus();
    setBackToButton(false);
  }, [editing, backToButton]);
  const closeEditing = () => {
    setEditing(null);
    setBackToButton(true);
  };

  const startEditing = () => {
    setEditError(null);
    setSaid('');
    setEditing({ target: 'mine', draft: saved, reset: false });
  };
  const chooseTarget = (target: LayoutTarget) => {
    setEditError(null);
    setEditing({ target, draft: target === 'mine' ? saved : defaultsQ.data ? defaultOf(target) : { widgets: [] }, reset: false });
    setSaid(`Arranging: ${CUSTOMIZE_WORDS[target]}.`);
  };
  const resetDraft = () => {
    if (!editing) return;
    const draft = editing.target === 'mine' ? layoutOrDefault(layoutQ.data?.defaultLayout ?? builtInLayout(isAdmin), isAdmin) : builtInLayout(editing.target === 'admins');
    setEditing({ ...editing, draft, reset: true });
    setSaid(`${CUSTOMIZE_WORDS.resetDone} ${editing.target === 'mine' ? CUSTOMIZE_WORDS.done : CUSTOMIZE_WORDS.saveDefault} keeps it.`);
  };
  async function finishEditing() {
    if (!editing) return;
    setSaving(true);
    setEditError(null);
    try {
      const api = dashboardApi(apiClient);
      if (editing.target === 'mine') {
        // Someone following the default who changed nothing keeps following it (future defaults reach them).
        const unchanged = !layoutQ.data?.customized && sameLayout(editing.draft, { widgets: layoutOrDefault(layoutQ.data?.defaultLayout, isAdmin).widgets.filter(allowed) });
        const answer = await api.saveMyLayout(editing.reset || unchanged ? null : editing.draft);
        qc.setQueryData(MY_LAYOUT_KEY, answer);
        setSaid(CUSTOMIZE_WORDS.saved);
      } else {
        const answer = await api.saveDefault(editing.target, editing.reset ? null : editing.draft);
        qc.setQueryData(LAYOUT_DEFAULTS_KEY, answer);
        await qc.invalidateQueries({ queryKey: MY_LAYOUT_KEY });
        setSaid(CUSTOMIZE_WORDS.savedDefault(editing.target));
      }
      closeEditing();
    } catch {
      setEditError(CUSTOMIZE_WORDS.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const perf = perfQ.data ?? [];
  const totals = perf.reduce(
    (acc, p) => ({ total: acc.total + p.total, completed: acc.completed + p.completed, overdue: acc.overdue + p.overdue }),
    { total: 0, completed: 0, overdue: 0 },
  );
  // Board order, named like everywhere else in the app (not the raw category codes).
  const statusRank = (category: string) => { const i = STATUS_ORDER.indexOf(category as (typeof STATUS_ORDER)[number]); return i < 0 ? STATUS_ORDER.length : i; };
  const statusData = Object.entries(statusQ.data ?? {})
    .sort(([a], [b]) => statusRank(a) - statusRank(b))
    .map(([category, count]) => ({
      label: STATUS_META[category]?.label ?? category, value: count, color: statusColour(category),
    }));
  const perfFiltered = projectFilter ? perf.filter((p) => p.projectId === projectFilter) : perf;
  const perfData = perfFiltered.map((p) => ({ label: p.projectName, value: p.completionPct, color: completionColor(p.completionPct) }));

  // 1.23.8: on a tall screen the lists show more rows instead of stopping early.
  const windowHeight = useWindowHeight();
  const gridRef = useRef<HTMLDivElement>(null);
  // Upcoming + overdue work needing attention, earliest first (finished work never counts).
  const dueSoon = useMemo(
    () =>
      [...(allTasksQ.data ?? [])]
        // Tasks scheduled for the future: one waiting for a later start day isn't today's (My Tasks' Upcoming).
        .filter((t) => t.dueDate && !isTaskDone(t) && !waitingDay(t, timeZone))
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '', 'en'))
        .slice(0, rowsForHeight(6, windowHeight)),
    [allTasksQ.data, windowHeight, timeZone],
  );
  const openTasks = useMemo(() => (myTasksQ.data ?? []).filter((t) => !isTaskDone(t) && !waitingDay(t, timeZone)), [myTasksQ.data, timeZone]);
  // Everyone else's Overdue and Due this week: their own tasks (already loaded for "Your open tasks"),
  // in company days and the company's week (its week start; Sunday until an administrator sets one).
  const companyWeekStart = useCompanyWeekStart();
  const mine = useMemo(() => myDueCounts(myTasksQ.data ?? [], { timeZone, weekStart: companyWeekStart }), [myTasksQ.data, timeZone, companyWeekStart]);
  const weekHint = mine.weekEnd === mine.today ? 'Today, the week’s last day' : `Today – ${dayText(mine.weekEnd, { weekday: 'short', year: false })}`;
  const recent = (activityQ.data ?? []).slice(0, rowsForHeight(6, windowHeight));
  // A company's (or a newcomer's) first day: no project and no task yet, as the server says (never
  // while loading or after a failed load). Empty charts and "nothing due" would say nothing useful:
  // the page welcomes them and points to the first steps instead.
  const noProjectsYet = useNoProjectsYet();
  const firstDay =
    noProjectsYet && myTasksQ.isSuccess && (myTasksQ.data ?? []).length === 0 && allTasksQ.isSuccess && (allTasksQ.data ?? []).length === 0;

  // "Friday 30 October", in the company zone.
  const today = instantDayText(new Date(), timeZone, { weekday: 'long', month: 'long', year: false });

  /** Whether a widget can show for this person now (today's visibility: the charts are an administrator's, Approvals an approver's). */
  const canShow = (id: WidgetId): boolean => {
    if (id === 'status-chart' || id === 'completion') return isAdmin;
    if (id === 'approvals') return !!approvalsQ.data?.canApprove;
    return true;
  };

  /** One widget, Small or Wide. */
  function widget(id: WidgetId, size: WidgetSize): ReactNode {
    switch (id) {
      case 'priorities':
        return <PrioritiesWidget onOpenTask={openTask} />;
      case 'stats':
        // Each links to the relevant page: an administrator's are the company's totals, everyone else's
        // their own overdue work and what is due this week. Two to a row on a phone (and when Small).
        return (
          <div data-testid="stat-tiles" data-count={4} className={`grid grid-cols-2 gap-3 ${size === 'wide' ? 'lg:grid-cols-4' : ''}`}>
            <Reveal delay={1} className="h-full"><Link to="/my-tasks" className={TILE_LINK}><StatTile label="My tasks" value={myTasksQ.data?.length ?? '—'} tone="brand" icon={<StatIcon>{icon.tasks}</StatIcon>} hint="Assigned to you" /></Link></Reveal>
            <Reveal delay={2} className="h-full"><Link to="/projects" className={TILE_LINK}><StatTile label="Projects" value={projectsQ.data?.length ?? '—'} tone="info" icon={<StatIcon>{icon.folder}</StatIcon>} hint="Active workspaces" /></Link></Reveal>
            {isAdmin ? <Reveal delay={3} className="h-full"><Link to="/reports" className={TILE_LINK}><StatTile label="All tasks" value={perfQ.data ? totals.total : '—'} tone="success" icon={<StatIcon>{icon.layers}</StatIcon>} hint={perfQ.data ? `${totals.completed} completed` : undefined} /></Link></Reveal> : null}
            {isAdmin ? <Reveal delay={4} className="h-full"><Link to="/reports" className={TILE_LINK}><StatTile label="Overdue" value={perfQ.data ? totals.overdue : '—'} tone="overdue" icon={<StatIcon>{icon.alert}</StatIcon>} hint={perfQ.data ? (totals.total ? `${Math.round((totals.overdue / totals.total) * 100)}% of tasks` : 'No tasks yet') : undefined} /></Link></Reveal> : null}
            {!isAdmin ? <Reveal delay={3} className="h-full"><Link to="/my-tasks" className={TILE_LINK}><StatTile label="Overdue" value={myTasksQ.data ? mine.overdue : '—'} tone="overdue" icon={<StatIcon>{icon.alert}</StatIcon>} hint={myTasksQ.data ? (mine.overdue ? 'Past their due day' : 'Nothing late') : undefined} /></Link></Reveal> : null}
            {!isAdmin ? <Reveal delay={4} className="h-full"><Link to="/my-tasks" className={TILE_LINK}><StatTile label="Due this week" value={myTasksQ.data ? mine.dueThisWeek : '—'} tone="soon" icon={<StatIcon>{icon.week}</StatIcon>} hint={myTasksQ.data ? weekHint : undefined} /></Link></Reveal> : null}
          </div>
        );
      case 'status-chart':
        return (
          <Reveal>
            <section className="card card-pad">
              <h2 className="eyebrow mb-3">Tasks by status</h2>
              {statusQ.isLoading ? (
                <div className="skeleton h-40 rounded-lg" aria-label="Loading the status chart" />
              ) : statusQ.isError ? (
                <LoadError what="the status chart" onRetry={() => void statusQ.refetch()} />
              ) : (
                <BarChart data={statusData} ariaLabel="Tasks by status" />
              )}
            </section>
          </Reveal>
        );
      case 'completion':
        return (
          <Reveal delay={1}>
            <section className="card card-pad">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="eyebrow">Project completion</h2>
                <div className="w-44">
                  <SearchableSelect
                    ariaLabel="Filter by project"
                    value={projectFilter}
                    onChange={(v) => setProjectFilter(v)}
                    options={[{ value: '', label: 'All projects' }, ...perf.map((p) => namedProjectOption(p.projectId, p.projectName, Array.isArray(projectsQ.data) ? projectsQ.data : null))]}
                  />
                </div>
              </div>
              {/* An outage must not read as "no data yet". */}
              {perfQ.isLoading ? (
                <div className="skeleton h-40 rounded-lg" aria-label="Loading project completion" />
              ) : perfQ.isError ? (
                <LoadError what="project completion" onRetry={() => void perfQ.refetch()} />
              ) : (
                <BarChart data={perfData} unit="%" max={100} ariaLabel="Project completion" />
              )}
            </section>
          </Reveal>
        );
      case 'open-tasks':
        return (
          <Reveal>
            <section className="card card-pad">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="eyebrow">Your open tasks</h2>
                <Link to="/my-tasks" className="tap text-xs font-semibold text-brand hover:underline">View all</Link>
              </div>
              {myTasksQ.isLoading ? (
                <RowsSkeleton label="Loading your tasks" rows={6} stacked={size === 'small'} />
              ) : myTasksQ.isError ? (
                <LoadError what="your tasks" onRetry={() => void myTasksQ.refetch()} className="py-4 text-center" />
              ) : openTasks.length === 0 ? (
                <EmptyState bare title="Nothing open assigned to you" description="Open tasks assigned to you will appear here." />
              ) : (
                <ul className="flex flex-col">
                  {openTasks.slice(0, rowsForHeight(8, windowHeight)).map((t) => (
                    <TaskRow key={t.id} task={t} timeZone={timeZone} onOpen={() => openTask(t.id)} stacked={size === 'small'} />
                  ))}
                </ul>
              )}
            </section>
          </Reveal>
        );
      case 'approvals':
        // For the people who can approve tasks (they run a project, or are an admin).
        return <ApprovalsCard onOpenTask={openTask} />;
      case 'due-soon':
        return (
          <Reveal delay={1}>
            <section className="card card-pad">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="eyebrow">Due soon</h2>
                <Link to="/calendar" className="tap text-xs font-semibold text-brand hover:underline">Calendar</Link>
              </div>
              {allTasksQ.isLoading ? (
                <RowsSkeleton label="Loading due tasks" rows={6} stacked={size === 'small'} />
              ) : allTasksQ.isError ? (
                // An outage must never read as "all clear".
                <LoadError what="due tasks" onRetry={() => void allTasksQ.refetch()} className="py-4 text-center" />
              ) : dueSoon.length === 0 ? (
                <p className="flex items-center justify-center gap-1.5 py-4 text-center text-sm text-ink-2"><span className="text-success">{Icon.checkCircle}</span>Nothing due — you’re all clear.</p>
              ) : (
                <ul className="flex flex-col">
                  {dueSoon.map((t) => (
                    <TaskRow key={t.id} task={t} timeZone={timeZone} onOpen={() => openTask(t.id)} showDue stacked={size === 'small'} />
                  ))}
                </ul>
              )}
            </section>
          </Reveal>
        );
      case 'activity':
        return (
          <Reveal delay={2}>
            <section className="card card-pad">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="eyebrow">Recent activity</h2>
                <Link to="/activity" className="tap text-xs font-semibold text-brand hover:underline">View all</Link>
              </div>
              {activityQ.isError ? (
                <LoadError what="recent activity" onRetry={() => void activityQ.refetch()} className="py-4 text-center" />
              ) : activityQ.isLoading ? (
                <RowsSkeleton label="Loading recent activity" rows={6} activity />
              ) : recent.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-2">No activity yet — new, moved and finished tasks show up here.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {recent.map((a) => (
                    <ActivityRow key={a.id} a={a} onOpenTask={openTask} />
                  ))}
                </ul>
              )}
            </section>
          </Reveal>
        );
    }
  }

  // The widgets in the person's order, the hidden ones and those they can't see left out; on day one only
  // the tiles, then the first steps.
  const visible = layout.widgets.filter((w) => !w.hidden && canShow(w.id) && (!firstDay || w.id === 'stats'));
  // 1.23.8: the grid's columns from the room it has (before it is measured, a guess from the window).
  const gridWidth = useElementWidth(gridRef);
  const columns = dashboardColumns(gridWidth ?? (typeof window !== 'undefined' && window.innerWidth >= 1024 ? 1000 : 600));
  const spans = dashboardSpans(visible.map((w) => w.size), columns);

  return (
    <div className="flex flex-col gap-6">
      {/* Welcome: one compact band — the greeting on the left, the ways in on the right. */}
      <div className="relative overflow-hidden rounded-2xl bg-brand-gradient px-5 py-4 text-white shadow-brand animate-fade-in-up sm:px-6">
        <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-16 right-24 h-32 w-32 rounded-full bg-black/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/90">{today}</div>
            <h1 className="font-display text-2xl font-extrabold tracking-tightish sm:text-[1.75rem]">
              {firstDay ? 'Welcome' : 'Welcome back'}, <bdi>{user?.username ?? 'there'}</bdi>.
            </h1>
            <p className="mt-0.5 hidden text-sm text-white sm:block">
              {firstDay
                ? 'Your workspace is ready. A few steps and your team’s work will show up here.'
                : 'Here’s a snapshot of your work. Jump into a board, review what’s due, and keep things moving.'}
            </p>
          </div>
          {/* On day one the board and My Tasks are empty: the first steps below take their place. */}
          {firstDay ? null : (
            <div className="flex flex-wrap gap-2">
              <Link to="/board" className={`${BAND_LINK} bg-white text-[#8B1E1E] shadow-soft hover:shadow-lift`}>
                Open board
              </Link>
              <Link to="/my-tasks" className={`${BAND_LINK} border border-white/30 bg-white/10 text-white backdrop-blur hover:bg-white/20`}>
                View my tasks
              </Link>
              <button
                ref={customizeButton}
                type="button"
                onClick={startEditing}
                aria-expanded={!!editing}
                aria-controls="customize-dashboard"
                // Not while the arrangement is unread: Done would save the built-in default over theirs.
                disabled={!!editing || !layoutQ.isSuccess}
                className={`${BAND_LINK} gap-1.5 border border-white/30 bg-white/10 text-white backdrop-blur hover:bg-white/20 disabled:opacity-70`}
              >
                <CustomizeIcon />
                {CUSTOMIZE_WORDS.open}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Training Center: courses past their due day (red), opening My training. */}
      <OverdueTrainingLink />

      {/* Installable website (13 Nov): "Install MICO360 Tasks on this device", until installed or Not now. */}
      <InstallAppCard />

      {editing ? (
        <div id="customize-dashboard">
          <CustomizePanel
            isAdmin={settingsAdmin}
            target={editing.target}
            onTarget={chooseTarget}
            draft={editing.target === 'everyone' ? previewFor(editing.draft, 'everyone') : editing.draft}
            onChange={(draft, text) => {
              setEditing({ ...editing, draft, reset: false });
              setSaid(text);
            }}
            status={said}
            error={editError}
            saving={saving}
            loading={waitingForDefault}
            onReset={resetDraft}
            onCancel={() => {
              closeEditing();
              setEditError(null);
              setSaid('');
            }}
            onDone={() => void finishEditing()}
          />
        </div>
      ) : (
        <p role="status" aria-live="polite" className="sr-only">
          {said}
        </p>
      )}

      {/* 1.23.8 The widgets in a responsive grid (lib/dashboard-layout): one column on a phone, two from 640px of
          room, three on a big monitor; Wide takes the whole row, Small one column, and the last in a row that
          isn't full stretches to fill it. Cards in a row end level (index.css .dash-cell). */}
      <div
        ref={gridRef}
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        data-testid="dashboard-widgets"
        data-columns={columns}
      >
        {visible.map((w, i) => (
          <div key={w.id} data-widget={w.id} data-size={w.size} data-span={spans[i]} className="dash-cell min-w-0" style={{ gridColumn: `span ${spans[i]} / span ${spans[i]}` }}>
            {widget(w.id, w.size)}
          </div>
        ))}
      </div>

      {firstDay ? (
        // Day one: the first steps where the charts and lists will be.
        <Reveal>
          <EmptyState
            titleAs="h2"
            icon={FirstStepsIcon}
            title={isAdmin ? 'Set up your workspace' : 'You’re not on a project yet'}
            description={
              isAdmin
                ? 'Create your first project, then add the people who will work in it. Their tasks, due dates and progress will show up here.'
                : 'Ask your administrator to add you to a project, or create your own to start adding tasks.'
            }
            action={<FirstStepsActions />}
          />
        </Reveal>
      ) : null}
    </div>
  );
}

/**
 * One task. On a phone, and with `stacked` in the narrow right-hand column, the title takes the first
 * line and the key + due date (or priority) the second — on one line a phone left the title a dozen
 * letters between the key and the badge.
 */
function TaskRow({ task, onOpen, showDue, timeZone, stacked }: { task: ApiTask; onOpen: () => void; showDue?: boolean; timeZone: string; stacked?: boolean }) {
  // The scope's working days (one shared answer for every row).
  const { calendar } = useWorkingTime({ enabled: !!showDue });
  const meta = showDue && task.dueDate ? dueMeta(task.dueDate, timeZone, calendar) : null;
  // Past its day but waiting for approval: never "overdue" — its badge says it waits (owner, 30 Oct).
  const waitingLate = !!meta?.overdue && isWaitingForApproval(task);
  const due = waitingLate ? null : meta;
  return (
    <li>
      <button
        onClick={onOpen}
        className={`flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-ground sm:flex-nowrap ${stacked ? 'lg:flex-wrap 2xl:flex-nowrap' : ''}`}
      >
        <TaskKey value={task.key} />
        <span dir="auto" title={task.title} className={`order-first min-w-0 flex-1 basis-full truncate text-start text-ink sm:order-none sm:basis-0 ${stacked ? 'lg:order-first lg:basis-full 2xl:order-none 2xl:basis-0' : ''}`}>{task.title}</span>
        {waitingLate ? (
          <span className="ms-auto flex flex-none"><ApprovalChip /></span>
        ) : due ? (
          <span className={`ms-auto whitespace-nowrap text-xs font-medium ${due.overdue ? OVERDUE_CLASS.text : 'text-ink-2'}`}>{due.label}</span>
        ) : (
          <span className="ms-auto flex flex-none"><PriorityBadge priority={task.priority} /></span>
        )}
      </button>
    </li>
  );
}

/**
 * A list's place while it loads: rows as tall as the real ones, so the cards below don't jump when
 * it arrives. `stacked` = task rows that take two lines in the narrow column (see TaskRow; they take
 * two on a phone anyway); `activity` = the avatar rows of Recent activity.
 */
function RowsSkeleton({ label, rows, stacked = false, activity = false }: { label: string; rows: number; stacked?: boolean; activity?: boolean }) {
  const row = activity ? 'h-10' : `h-14 sm:h-9 ${stacked ? 'lg:h-14 2xl:h-9' : ''}`;
  return (
    <div role="status" aria-label={label} className={`flex flex-col ${activity ? 'gap-3' : 'gap-1 px-2 py-1'}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} data-skeleton-row className={`skeleton ${row}`} />
      ))}
    </div>
  );
}

function ActivityRow({ a, onOpenTask }: { a: ApiActivity; onOpenTask: (taskId: string) => void }) {
  const who = a.actor?.name ?? 'Someone';
  // "Aisha Khan assigned MICO-3 to Omar Ahmed" (it read "assigned to MICO-3").
  const assignee = a.action === 'ASSIGNED' && typeof a.meta?.assignee === 'string' ? a.meta.assignee : null;
  return (
    <li className="flex gap-2 text-sm">
      <Avatar name={who} src={a.actor?.avatarUrl} size="sm" decorative />
      <div className="min-w-0 flex-1">
        <p className="leading-snug text-ink">
          <bdi className="font-semibold">{who}</bdi> <span className={actionTone(a.action)}>{actionLabel(a.action)}</span>{' '}
          {a.task ? (
            <TaskKeyButton value={a.task.key} onClick={() => onOpenTask(a.task!.id)} className="align-middle" />
          ) : a.project ? (
            <bdi className="text-ink-2">{a.project.name}</bdi>
          ) : null}
          {assignee ? (
            <>
              {' '}to <bdi className="font-medium">{assignee}</bdi>
            </>
          ) : null}
        </p>
        <p className="text-[11px] text-ink-2">{timeAgo(a.createdAt)}</p>
      </div>
    </li>
  );
}
