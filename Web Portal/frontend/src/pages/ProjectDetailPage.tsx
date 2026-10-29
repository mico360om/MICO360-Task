import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
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
import { TaskDrawerContainer } from '../components/TaskDrawerContainer';
import { MeetingFormModal } from '../components/MeetingFormModal';
import { todayKey } from '../lib/due-date';
import { useCompanyTimeZone } from '../lib/company-clock';
import { taskStats } from '../lib/project-dashboard';
import { useProjectRealtime, type ProjectChange } from '../lib/useProjectRealtime';
import { PageProblem, isMissing } from '../components/ui/PageProblem';
import { ProjectAvatar } from '../components/ProjectAvatar';
import { ProjectFormDialog } from '../components/project-form/ProjectFormDialog';
import { SaveProjectTemplateDialog } from '../components/templates/SaveAsTemplate';
import { TemplateGlyph } from '../components/templates/TemplateCard';
import { ownerChoices } from '../components/project-form/owner-options';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { NewTaskModal } from '../components/NewTaskModal';
import { useCurrentProject } from '../components/CurrentProject';
import { ShortcutHint, useShortcut, useShortcutHint } from '../components/shortcuts/ShortcutProvider';
import { OverviewTab } from '../components/project-dashboard/OverviewTab';
import { TasksTab, type TaskFilter, type TaskGroup } from '../components/project-dashboard/TasksTab';
import { MeetingsTab } from '../components/project-dashboard/MeetingsTab';
import { usePageName } from '../lib/page-meta';
import { ApiError } from '../lib/api-client';
import { ClientSharePanel } from '../components/client-share/ClientSharePanel';
import { configApi } from '../api/config';
import { ProjectInspectionsTab } from '../components/inspections/ProjectInspectionsTab';
import { TOUCH_SQUARE, TOUCH_TALL } from '../lib/touch';

type Tab = 'overview' | 'tasks' | 'meetings' | 'inspections' | 'team';
const TABS: Array<{ v: Tab; label: string }> = [
  { v: 'overview', label: 'Overview' },
  { v: 'tasks', label: 'Tasks' },
  { v: 'meetings', label: 'Meetings' },
  { v: 'inspections', label: 'Inspections' },
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
  // New task (the header button too) starts in this project.
  useCurrentProject(id);
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
      // Due checks and schedules are tasks too.
      void qc.invalidateQueries({ queryKey: ['project-inspections', id] });
    }
    if (any('meetings', 'all')) void qc.invalidateQueries({ queryKey: ['meetings', 'project', id] });
    if (any('inspections', 'all')) void qc.invalidateQueries({ queryKey: ['project-inspections', id] });
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
  // A team change can change who may run the project (someone stepping down loses its controls at
  // once), so the project and the lists that say so are read again too.
  const afterTeamChange = () => {
    void invalidateMembers();
    void qc.invalidateQueries({ queryKey: ['project', id] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
  };
  // A refused team change says why, in the server's words (the last manager, an inactive person…).
  const [teamProblem, setTeamProblem] = useState<string | null>(null);
  const teamRefused = (e: unknown) =>
    setTeamProblem(
      e instanceof ApiError && e.status === 403
        ? 'Only this project’s owner, its managers or an administrator can change its team.'
        : e instanceof ApiError && e.message && !/^Request failed/.test(e.message)
          ? e.message
          : 'Couldn’t change the team. Please try again.',
    );
  const teamChange = { onMutate: () => setTeamProblem(null), onError: teamRefused, onSuccess: afterTeamChange };
  const addM = useMutation({ mutationFn: (userId: string) => membersApi(apiClient).add(id, userId), ...teamChange });
  const removeM = useMutation({ mutationFn: (userId: string) => membersApi(apiClient).remove(id, userId), ...teamChange });
  const roleM = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'MEMBER' | 'MANAGER' }) => membersApi(apiClient).setRole(id, userId, role),
    ...teamChange,
  });

  const name = (u: { firstName: string; lastName: string; username: string }) =>
    [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

  const project = projectQ.data;
  usePageName(project?.name);
  const members = Array.isArray(membersQ.data) ? membersQ.data : [];
  // Who runs the project — an admin, or its owner, named manager or a manager on its team — changes
  // its details, picture, status and owner, and runs its team. The server says (canManage); an
  // older one that doesn't let MANAGER members run the team only.
  const canManage = isAdmin || (project?.canManage ?? members.some((m) => m.id === myId && m.role === 'MANAGER'));
  const canEditProject = isAdmin || project?.canManage === true;
  const [detailsProblem, setDetailsProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Share with client: whoever runs the project (the server checks too). Archived: read-only, Remove still there.
  const [sharing, setSharing] = useState(false);
  // Save as template: whoever runs the project (the server checks too).
  const [savingTemplate, setSavingTemplate] = useState(false);
  const canShare = canEditProject && !!project;
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false, enabled: canShare });

  const directory = Array.isArray(directoryQ.data) ? directoryQ.data : [];
  const personById = (userId: string) => {
    const u = directory.find((d) => d.id === userId);
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Unknown';
  };
  const ownerName = (ownerId: string | null) => (ownerId ? personById(ownerId) : 'No owner');
  // The named manager runs the project too: shown wherever the owner is.
  const managerName = project?.managerId ? personById(project.managerId) : null;
  // Everyone active (and the current owner, even after they've left).
  const ownerOptions = ownerChoices(directory, project?.ownerId, { allowNone: true });
  const ownerMut = useMutation({
    mutationFn: (ownerId: string | null) => projectsApi(apiClient).update(id, { ownerId }),
    onMutate: () => setDetailsProblem(null),
    onError: (e) =>
      setDetailsProblem(
        e instanceof ApiError && e.status === 403
          ? 'Only this project’s owner, its managers or an administrator can change its owner.'
          : e instanceof ApiError && e.status === 400 && e.message
            ? e.message
            : 'Couldn’t change the owner. Please try again.',
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project', id] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      // Someone who hands over a project they own stays on its team as a manager.
      void invalidateMembers();
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
  // Until its first data is in, the page is one placeholder of about its size; then the header, tiles,
  // tabs and overview appear together, filled. Drawn part by part, each arrival (the owner's and
  // manager's names, a long name wrapping, the overview's lists) pushed everything under it down.
  const firstLoad = !project || directoryQ.isLoading || membersQ.isLoading || !statsReady || meetingsQ.isLoading;
  const tabCount = (t: Tab) => (t === 'tasks' ? stats.total : t === 'meetings' ? overview?.stats.upcoming ?? 0 : t === 'team' ? members.length : 0);

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Projects', to: '/projects' }, { label: project && !firstLoad ? <bdi>{project.name}</bdi> : '…' }]} />

      {firstLoad || !project ? (
        <ProjectPageSkeleton key="loading" />
      ) : (
      <div key="page">
      {/* Header */}
      {/* The title (with its picture) keeps at least 20rem: when the buttons would squeeze it more (a
          tablet, three labelled buttons), they move to their own row under it — a long name never
          breaks mid-word. */}
      <div className="mt-2 flex flex-wrap items-start gap-3 sm:gap-4">
        <div className="flex min-w-0 flex-1 basis-80 items-start gap-3 sm:gap-4">
        <ProjectAvatar project={project} size="lg" label className="shadow-soft" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 dir="auto" className="min-w-0 break-words font-display text-2xl font-bold text-ink">
              {project.name}
            </h1>
            <Badge tone={PROJECT_STATUS_TONE[project.status] ?? 'neutral'} dot>{statusLabel(project.status)}</Badge>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
              <span className="font-mono">{project.code}</span>
              {project.number ? <><span aria-hidden>·</span><span>Project no. <span className="font-mono">{project.number}</span></span></> : null}
              {project.clientName ? <><span aria-hidden>·</span><span dir="auto">{project.clientName}</span></> : null}
              <span aria-hidden>·</span>
              <span>Owner: {ownerName(project.ownerId)}</span>
              {managerName ? <><span aria-hidden>·</span><span>Project manager: {managerName}</span></> : null}
            </p>
          {detailsProblem ? <p role="alert" className="mt-1 text-xs font-medium text-danger">{detailsProblem}</p> : null}
        </div>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-2">
        {canShare ? (
          <button
            type="button"
            onClick={() => setSharing(true)}
            title="Share this project with a client (read-only)"
            className={`inline-flex flex-none items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand ${TOUCH_SQUARE}`}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
            </svg>
            <span className="max-sm:sr-only">Share with client</span>
          </button>
        ) : null}
        {canEditProject && project ? (
          <button
            type="button"
            onClick={() => setSavingTemplate(true)}
            title="Save this project’s board and tasks as a template for new projects"
            className={`inline-flex flex-none items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand ${TOUCH_SQUARE}`}
          >
            {TemplateGlyph.save}
            <span className="max-sm:sr-only">Save as template</span>
          </button>
        ) : null}
        {canEditProject && project ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title={editHint?.title('Edit project')}
            aria-keyshortcuts={editHint?.aria}
            className={`inline-flex flex-none items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand ${TOUCH_SQUARE}`}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            <span className="max-sm:sr-only">Edit project</span>
            <ShortcutHint action="edit" />
          </button>
        ) : null}
        </div>
      </div>
      {editing && project ? <ProjectFormDialog project={project} onClose={() => setEditing(false)} /> : null}
      {sharing && project ? (
        <ClientSharePanel projectId={id} projectName={project.name} emailEnabled={configQ.data?.emailEnabled ?? true} archived={project.status === 'ARCHIVED'} onClose={() => setSharing(false)} />
      ) : null}
      {newTask ? <NewTaskModal projectId={id} onClose={() => setNewTask(false)} /> : null}
      {savingTemplate && project ? <SaveProjectTemplateDialog projectId={id} projectName={project.name} onClose={() => setSavingTemplate(false)} /> : null}

      {/* Stat tiles — a snapshot of every task by where it stands */}
      <div className={TILE_GRID}>
        {/* "—" until the tasks arrive: a zero would read as "this project has no tasks". */}
        <StatTile label="Total tasks" value={statsReady ? stats.total : '—'} hint={statsReady && stats.pending ? `${stats.pending} not started` : ''} className={TILE_SPAN[0]} />
        <StatTile label="Completed" value={statsReady ? stats.completed : '—'} tone="success" className={TILE_SPAN[1]} />
        <StatTile label="Ongoing" value={statsReady ? stats.ongoing : '—'} tone="info" className={TILE_SPAN[2]} />
        <StatTile label="Overdue" value={statsReady ? stats.overdue : '—'} tone="danger" className={TILE_SPAN[3]} />
        <StatTile label="Completion" value={statsReady ? `${stats.pct}%` : '—'} tone="brand" className={TILE_SPAN[4]} />
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
              className={`flex flex-none items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${TOUCH_TALL} ${tab === t.v ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:text-ink'}`}
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
              namedManager={project.managerId && managerName ? { id: project.managerId, name: managerName } : null}
              createdByName={project.createdById ? personById(project.createdById) : null}
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

        {tab === 'inspections' ? <ProjectInspectionsTab projectId={id} tasks={tasks.map((t) => ({ id: t.id, key: t.key, title: t.title }))} onOpenTask={setOpenTaskId} /> : null}

        {tab === 'team' ? (
          <section className="card p-5">
            <h2 className="eyebrow mb-3">Team members</h2>
            {project ? (
              <p className="mb-3 flex flex-wrap gap-x-2 text-sm text-ink-2">
                <span>Owner: {ownerName(project.ownerId)}</span>
                {managerName ? <><span aria-hidden>·</span><span>Project manager: {managerName}</span></> : null}
              </p>
            ) : null}
            {teamProblem ? (
              <p role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                <span>{teamProblem}</span>
                <button type="button" onClick={() => setTeamProblem(null)} aria-label="Dismiss" className="shrink-0 rounded px-1 opacity-80 hover:opacity-100">✕</button>
              </p>
            ) : null}
            <ProjectMembers
              members={members.map((m) => ({ id: m.id, name: name(m), role: m.role }))}
              addableUsers={canManage ? directory.filter((u) => u.active !== false).map((u) => ({ id: u.id, name: name(u), role: 'MEMBER' as const })) : []}
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
      )}
    </div>
  );
}

/**
 * The five numbers. On a phone: one compact strip, the five side by side in a single card (three rows
 * of tiles took a screenful before the tabs). From a small tablet: tiles, three then two wider ones
 * (no empty slot); all five in a row from a laptop.
 */
const TILE_SPAN = ['sm:col-span-2 lg:col-span-1', 'sm:col-span-2 lg:col-span-1', 'sm:col-span-2 lg:col-span-1', 'sm:col-span-3 lg:col-span-1', 'sm:col-span-3 lg:col-span-1'];
const TILE_GRID = 'mt-4 grid grid-cols-5 sm:grid-cols-6 sm:gap-3 lg:grid-cols-5 max-sm:card max-sm:divide-x max-sm:divide-line max-sm:overflow-hidden rtl:max-sm:divide-x-reverse';

/** The page's shape while its first data loads: header, tiles (no zero counters), tabs and a panel. */
function ProjectPageSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mt-2 flex items-start gap-3 sm:gap-4" aria-hidden="true">
        <span className="skeleton h-11 w-11 flex-none rounded-xl" />
        <div className="min-w-0 flex-1">
          <span className="skeleton block h-7 w-56 max-w-full" />
          <span className="skeleton mt-2 block h-3.5 w-72 max-w-full" />
        </div>
      </div>
      <div className={TILE_GRID}>
        {['Total tasks', 'Completed', 'Ongoing', 'Overdue', 'Completion'].map((label, i) => (
          <StatTile key={label} label={label} value="—" hint={i === 0 ? '' : undefined} className={TILE_SPAN[i]} />
        ))}
      </div>
      <div className="mt-3 h-2 rounded-full bg-ground" />
      <div className="mt-5 flex gap-1 border-b border-line pb-2" aria-hidden="true">
        {[16, 12, 16, 18, 12].map((w, i) => (
          <span key={i} className="skeleton h-6 rounded-md" style={{ width: `${w * 0.25}rem` }} />
        ))}
      </div>
      {/* About a screen tall, so the page footer stays out of view until the page is drawn. */}
      <div className="skeleton mt-4 h-[60vh] min-h-[16rem] rounded-2xl" role="status" aria-label="Loading project" />
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
    // A tile; on a phone, a cell of the strip (no card of its own, the number over its label).
    <div title={hint || undefined} className={`card p-4 max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:px-1 max-sm:py-2.5 max-sm:text-center max-sm:shadow-none ${className}`}>
      <p className={`font-display text-2xl font-bold tabular-nums max-sm:text-lg max-sm:leading-tight ${TILE_TONE[tone]}`}>{value}</p>
      <p className="mt-0.5 text-xs font-medium text-ink-2 max-sm:text-[11px] max-sm:leading-tight">{label}</p>
      {/* An empty hint still keeps its line, so the tiles don't grow when the numbers arrive. */}
      {hint !== undefined ? <p className="min-h-[1rem] text-[11px] leading-4 text-ink-2 max-sm:hidden">{hint}</p> : null}
    </div>
  );
}
