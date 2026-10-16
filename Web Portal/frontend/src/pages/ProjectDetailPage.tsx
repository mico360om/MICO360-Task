import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { projectsApi } from '../api/projects';
import { membersApi } from '../api/members';
import { usersApi } from '../api/users';
import { tasksApi, type ApiTask } from '../api/tasks';
import { columnsApi } from '../api/columns';
import { meetingsApi } from '../api/meetings';
import { aiApi } from '../api/ai';
import { useAuthStore } from '../stores/auth-store';
import { ProjectMembers } from '../components/ProjectMembers';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { TaskDrawerContainer } from '../components/TaskDrawerContainer';
import { MeetingFormModal } from '../components/MeetingFormModal';
import { todayKey } from '../lib/due-date';
import { useCompanyTimeZone } from '../lib/company-clock';
import { taskStats } from '../lib/project-dashboard';
import { useProjectRealtime, type ProjectChange } from '../lib/useProjectRealtime';
import { PageProblem, isMissing } from '../components/ui/PageProblem';
import { ProjectAvatar } from '../components/ProjectAvatar';
import { ProjectFormDialog } from '../components/project-form/ProjectFormDialog';
import { NewTaskModal } from '../components/NewTaskModal';
import { ShortcutHint, useShortcut, useShortcutHint } from '../components/shortcuts/ShortcutProvider';
import { OverviewTab } from '../components/project-dashboard/OverviewTab';
import { TasksTab, type TaskFilter, type TaskGroup } from '../components/project-dashboard/TasksTab';
import { MeetingsTab } from '../components/project-dashboard/MeetingsTab';
import { usePageName } from '../lib/page-meta';
import { ApiError } from '../lib/api-client';

type Tab = 'overview' | 'tasks' | 'meetings' | 'team';
const TABS: Array<{ v: Tab; label: string }> = [
  { v: 'overview', label: 'Overview' },
  { v: 'tasks', label: 'Tasks' },
  { v: 'meetings', label: 'Meetings' },
  { v: 'team', label: 'Team' },
];

const PROJECT_STATUS_TONE: Record<string, BadgeTone> = {
  PLANNING: 'info',
  ACTIVE: 'success',
  ON_HOLD: 'warning',
  COMPLETED: 'brand',
  ARCHIVED: 'neutral',
};
const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ');

/**
 * A project's dashboard: its details, progress, milestones and deadlines (Overview); its tasks by
 * where they stand (Tasks); its meetings with minutes, decisions and action items (Meetings); and
 * its people (Team). Everything is this project's own, and it updates live as tasks and meetings
 * change anywhere.
 */
export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const myId = useAuthStore((s) => s.user?.id);
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = TABS.some((t) => t.v === tabParam) ? tabParam! : 'overview';
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [newMeeting, setNewMeeting] = useState(false);
  const timeZone = useCompanyTimeZone();
  const today = todayKey(timeZone);

  const show = (next: Tab, filter?: TaskFilter) => {
    if (filter) setTaskFilter(filter);
    const p = new URLSearchParams(params);
    if (next === 'overview') p.delete('tab');
    else p.set('tab', next);
    setParams(p, { replace: true });
  };

  const projectQ = useQuery({ queryKey: ['project', id], queryFn: () => projectsApi(apiClient).get(id), enabled: !!id });
  const columnsQ = useQuery({ queryKey: ['columns', id], queryFn: () => columnsApi(apiClient).list(id), enabled: !!id });
  const tasksQ = useQuery({ queryKey: ['project-tasks', id], queryFn: () => tasksApi(apiClient).list(id), enabled: !!id });
  const membersQ = useQuery({ queryKey: ['members', id], queryFn: () => membersApi(apiClient).list(id), enabled: !!id });
  // Under ['meetings'], so any meeting saved anywhere in the app refreshes it too.
  const meetingsQ = useQuery({ queryKey: ['meetings', 'project', id], queryFn: () => meetingsApi(apiClient).projectOverview(id), enabled: !!id });
  // The people directory (any signed-in user may read it) — powers owner names and, for admins and this
  // project's managers, the "Add a member" picker (the admin-only /users list would fail for managers).
  const directoryQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });

  // Live: another person's change to this project's tasks or meetings shows up here at once. A
  // burst of events (a whole series changed: one per meeting) makes one refresh, a moment later.
  const pendingChanges = useRef(new Set<ProjectChange>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshChanged = () => {
    const changes = pendingChanges.current;
    pendingChanges.current = new Set();
    refreshTimer.current = null;
    const any = (...kinds: ProjectChange[]) => kinds.some((k) => changes.has(k));
    if (any('tasks', 'all')) {
      void qc.invalidateQueries({ queryKey: ['project-tasks', id] });
      void qc.invalidateQueries({ queryKey: ['columns', id] });
    }
    if (any('meetings', 'all')) void qc.invalidateQueries({ queryKey: ['meetings', 'project', id] });
    if (any('all', 'removed')) {
      void qc.invalidateQueries({ queryKey: ['project', id] });
      void qc.invalidateQueries({ queryKey: ['members', id] });
    }
  };
  const { live } = useProjectRealtime(id || undefined, (change) => {
    pendingChanges.current.add(change);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refreshChanged, 250);
  });
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  const invalidateMembers = () => qc.invalidateQueries({ queryKey: ['members', id] });
  const addM = useMutation({ mutationFn: (userId: string) => membersApi(apiClient).add(id, userId), onSuccess: invalidateMembers });
  const removeM = useMutation({ mutationFn: (userId: string) => membersApi(apiClient).remove(id, userId), onSuccess: invalidateMembers });
  const roleM = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'MEMBER' | 'MANAGER' }) => membersApi(apiClient).setRole(id, userId, role),
    onSuccess: invalidateMembers,
  });

  const name = (u: { firstName: string; lastName: string; username: string }) =>
    [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

  const project = projectQ.data;
  usePageName(project?.name);
  const members = Array.isArray(membersQ.data) ? membersQ.data : [];
  const canManage = isAdmin || members.some((m) => m.id === myId && m.role === 'MANAGER');
  // The project's own details (name, look, owner…) are an admin's to change — the server refuses anyone
  // else, so a manager is not shown controls that would fail. Managers run the team (see the Team tab).
  const canEditProject = isAdmin;
  const [detailsProblem, setDetailsProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const directory = Array.isArray(directoryQ.data) ? directoryQ.data : [];
  const ownerName = (ownerId: string | null) => {
    if (!ownerId) return 'No owner';
    const u = directory.find((d) => d.id === ownerId);
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Unknown';
  };
  const ownerOptions = [
    { value: '', label: 'No owner' },
    ...directory.map((u) => {
      const label = `${u.firstName} ${u.lastName}`.trim() || u.username;
      return { value: u.id, label, hint: `@${u.username}`, icon: <Avatar name={label} size="sm" src={u.avatarUrl} /> };
    }),
  ];
  const ownerMut = useMutation({
    mutationFn: (ownerId: string | null) => projectsApi(apiClient).update(id, { ownerId }),
    onMutate: () => setDetailsProblem(null),
    onError: (e) => setDetailsProblem(e instanceof ApiError && e.status === 403 ? 'Only an administrator can change the project owner.' : 'Couldn’t change the owner. Please try again.'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project', id] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  // ---- Tasks ---------------------------------------------------------------
  const columns = useMemo(
    () => (Array.isArray(columnsQ.data) ? [...columnsQ.data].sort((a, b) => a.position - b.position) : []),
    [columnsQ.data],
  );
  const columnById = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  // Each task with its column's stage (the board's columns decide what "done" or "in progress" is).
  const tasks = useMemo<ApiTask[]>(
    () => (Array.isArray(tasksQ.data) ? tasksQ.data : []).map((t) => ({ ...t, columnCategory: columnById.get(t.columnId)?.category ?? t.columnCategory ?? 'TODO' })),
    [tasksQ.data, columnById],
  );
  const stats = useMemo(() => taskStats(tasks, today, timeZone), [tasks, today, timeZone]);

  // Tasks grouped by their status column (in board order), plus any orphaned tasks.
  const groups = useMemo<TaskGroup[]>(() => {
    const known = new Set(columns.map((c) => c.id));
    const base: TaskGroup[] = columns.map((c) => ({ id: c.id, name: c.name, color: c.color, tasks: tasks.filter((t) => t.columnId === c.id) }));
    const orphans = tasks.filter((t) => !known.has(t.columnId));
    if (orphans.length) base.push({ id: '__orphan', name: 'Uncategorized', color: 'rgb(var(--c-ink-3))', tasks: orphans });
    return base;
  }, [columns, tasks]);

  const overview = meetingsQ.data && Array.isArray(meetingsQ.data.meetings) ? meetingsQ.data : null;
  const canSchedule = !!project && project.status !== 'ARCHIVED' && project.status !== 'COMPLETED';
  // N adds a task to this project (a meeting on the Meetings tab); E edits the project.
  const [newTask, setNewTask] = useState(false);
  useShortcut('new', () => (tab === 'meetings' ? setNewMeeting(true) : setNewTask(true)), { enabled: canSchedule });
  useShortcut('edit', () => setEditing(true), { enabled: canEditProject && !!project });
  const editHint = useShortcutHint('edit');

  // AI: a plain-language status summary from the live task stats + a few open task titles.
  const summarizeProject = () => {
    const openTitles = tasks
      .filter((t) => t.columnCategory !== 'DONE')
      .slice(0, 8)
      .map((t) => t.title);
    return aiApi(apiClient).summary(
      project?.name ?? 'Project',
      { total: stats.total, completed: stats.completed, inProgress: stats.ongoing, overdue: stats.overdue },
      openTitles,
    );
  };

  // No project to show: say which problem it is instead of rendering an empty shell of the page.
  if (projectQ.isError && !project) {
    const missing = isMissing(projectQ.error);
    return (
      <PageProblem
        title={missing ? 'Project not found' : 'Couldn’t load this project'}
        message={missing ? 'It may have been deleted, or the link is wrong.' : 'Check your connection and try again.'}
        backTo="/projects"
        backLabel="Back to projects"
        onRetry={missing ? undefined : () => void projectQ.refetch()}
        retrying={projectQ.isFetching}
      />
    );
  }

  const statsReady = !tasksQ.isLoading && !columnsQ.isLoading;
  const tabCount = (t: Tab) => (t === 'tasks' ? stats.total : t === 'meetings' ? overview?.stats.upcoming ?? 0 : t === 'team' ? members.length : 0);

  return (
    <div>
      <Link to="/projects" className="tap text-sm text-ink-2 hover:text-brand">← Projects</Link>

      {/* Header */}
      <div className="mt-1 flex items-start gap-3 sm:gap-4">
        {!project ? (
          <span className="skeleton h-16 w-16 flex-none rounded-2xl" aria-hidden="true" />
        ) : (
          <ProjectAvatar project={project} size="xl" label className="shadow-soft" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 dir="auto" className="min-w-0 break-words font-display text-2xl font-bold text-ink">
              {project ? project.name : <><span className="sr-only">Loading project…</span><span className="skeleton inline-block h-7 w-56 max-w-full align-middle" aria-hidden="true" /></>}
            </h1>
            {project ? <Badge tone={PROJECT_STATUS_TONE[project.status] ?? 'neutral'} dot>{statusLabel(project.status)}</Badge> : null}
          </div>
          {project ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
              <span className="font-mono">{project.code}</span>
              {project.number ? <><span aria-hidden>·</span><span>Project no. <span className="font-mono">{project.number}</span></span></> : null}
              {project.clientName ? <><span aria-hidden>·</span><span dir="auto">{project.clientName}</span></> : null}
              <span aria-hidden>·</span>
              <span>Owner: {ownerName(project.ownerId)}</span>
            </p>
          ) : null}
          {detailsProblem ? <p role="alert" className="mt-1 text-xs font-medium text-danger">{detailsProblem}</p> : null}
        </div>
        {canEditProject && project ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title={editHint?.title('Edit project')}
            aria-keyshortcuts={editHint?.aria}
            className="inline-flex flex-none items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            <span className="max-sm:sr-only">Edit project</span>
            <ShortcutHint action="edit" />
          </button>
        ) : null}
      </div>
      {editing && project ? <ProjectFormDialog project={project} onClose={() => setEditing(false)} /> : null}
      {newTask ? <NewTaskModal projectId={id} onClose={() => setNewTask(false)} /> : null}

      {/* Stat tiles — a snapshot of every task by where it stands */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {/* "—" until the tasks arrive: a zero would read as "this project has no tasks". */}
        <StatTile label="Total tasks" value={statsReady ? stats.total : '—'} hint={statsReady && stats.pending ? `${stats.pending} not started` : undefined} />
        <StatTile label="Completed" value={statsReady ? stats.completed : '—'} tone="success" />
        <StatTile label="Ongoing" value={statsReady ? stats.ongoing : '—'} tone="info" />
        <StatTile label="Overdue" value={statsReady ? stats.overdue : '—'} tone="danger" />
        {/* Two to a row on a phone: the fifth fills its row. */}
        <StatTile label="Completion" value={statsReady ? `${stats.pct}%` : '—'} tone="brand" className="max-sm:col-span-2" />
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-ground">
        <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${stats.pct}%` }} />
      </div>

      {/* Tabs */}
      <div className="mt-5 flex items-end justify-between gap-3 border-b border-line">
        <div role="tablist" aria-label="Project dashboard" className="-mb-px flex min-w-0 gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.v}
              type="button"
              role="tab"
              aria-selected={tab === t.v}
              onClick={() => show(t.v)}
              className={`flex flex-none items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${tab === t.v ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:text-ink'}`}
            >
              {t.label}
              {tabCount(t.v) ? <span className="rounded-full bg-ground px-1.5 text-xs text-ink-2">{tabCount(t.v)}</span> : null}
            </button>
          ))}
        </div>
        {live ? (
          <span className="mb-2 hidden flex-none items-center gap-1.5 text-xs text-ink-2 sm:inline-flex" title="Changes by others appear here as they happen">
            <span className="h-2 w-2 animate-pulse rounded-full bg-success" aria-hidden="true" />
            Live
          </span>
        ) : null}
      </div>

      <div className="mt-4" role="tabpanel" aria-label={TABS.find((t) => t.v === tab)!.label}>
        {tab === 'overview' ? (
          projectQ.isError ? (
            <p role="alert" className="text-danger">
              Couldn’t load this project. <button className="font-semibold underline" onClick={() => projectQ.refetch()}>Retry</button>
            </p>
          ) : !project ? (
            <div className="skeleton h-28 rounded-xl" aria-label="Loading project" />
          ) : (
            <OverviewTab
              project={project}
              tasks={tasks}
              groups={groups}
              today={today}
              timeZone={timeZone}
              statsReady={statsReady}
              members={members.map((m) => ({ id: m.id, name: name(m), role: m.role }))}
              ownerName={ownerName(project.ownerId)}
              ownerControl={
                canEditProject ? (
                  <div className="w-60 max-w-full">
                    <SearchableSelect ariaLabel="Project owner" placeholder="No owner" value={project.ownerId ?? ''} options={ownerOptions} onChange={(v) => ownerMut.mutate(v || null)} />
                  </div>
                ) : null
              }
              meetings={overview}
              meetingsLoading={meetingsQ.isLoading}
              onOpenTask={setOpenTaskId}
              onShow={show}
              onNewMeeting={canSchedule ? () => setNewMeeting(true) : undefined}
              onSummarize={summarizeProject}
            />
          )
        ) : null}

        {tab === 'tasks' ? (
          <TasksTab groups={groups} today={today} timeZone={timeZone} loading={tasksQ.isLoading || columnsQ.isLoading} filter={taskFilter} onFilter={setTaskFilter} onOpen={setOpenTaskId} />
        ) : null}

        {tab === 'meetings' ? (
          <MeetingsTab
            data={overview}
            loading={meetingsQ.isLoading}
            failed={meetingsQ.isError}
            onRetry={() => void meetingsQ.refetch()}
            timeZone={timeZone}
            onNew={canSchedule ? () => setNewMeeting(true) : undefined}
          />
        ) : null}

        {tab === 'team' ? (
          <section className="card p-5">
            <h2 className="eyebrow mb-3">Team members</h2>
            <ProjectMembers
              members={members.map((m) => ({ id: m.id, name: name(m), role: m.role }))}
              addableUsers={canManage ? directory.map((u) => ({ id: u.id, name: name(u), role: 'MEMBER' as const })) : []}
              canManage={canManage}
              onAdd={(userId) => addM.mutate(userId)}
              onRemove={(userId) => removeM.mutate(userId)}
              onSetRole={(userId, role) => roleM.mutate({ userId, role })}
            />
          </section>
        ) : null}
      </div>

      {openTaskId ? <TaskDrawerContainer taskId={openTaskId} onClose={() => setOpenTaskId(null)} /> : null}
      {newMeeting ? <MeetingFormModal defaultProjectId={id} onClose={() => setNewMeeting(false)} /> : null}
    </div>
  );
}

const TILE_TONE: Record<string, string> = {
  default: 'text-ink',
  success: 'text-success',
  info: 'text-info',
  danger: 'text-danger',
  brand: 'text-brand',
};
function StatTile({ label, value, tone = 'default', hint, className = '' }: { label: string; value: string | number; tone?: keyof typeof TILE_TONE; hint?: string; className?: string }) {
  return (
    <div className={`card p-4 ${className}`}>
      <p className={`font-display text-2xl font-bold ${TILE_TONE[tone]}`}>{value}</p>
      <p className="mt-0.5 text-xs font-medium text-ink-2">{label}</p>
      {hint ? <p className="text-[11px] text-ink-3">{hint}</p> : null}
    </div>
  );
}
