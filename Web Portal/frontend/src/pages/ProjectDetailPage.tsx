import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, assetUrl } from '../api/client';
import { projectsApi } from '../api/projects';
import { membersApi } from '../api/members';
import { usersApi } from '../api/users';
import { tasksApi, type ApiTask } from '../api/tasks';
import { columnsApi } from '../api/columns';
import { aiApi } from '../api/ai';
import { useAuthStore } from '../stores/auth-store';
import { ProjectMembers } from '../components/ProjectMembers';
import { AiSummaryCard } from '../components/AiSummaryCard';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { PriorityBadge } from '../components/ui/PriorityBadge';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { TaskDrawerContainer } from '../components/TaskDrawerContainer';

type Tab = 'overview' | 'tasks' | 'team';

const PROJECT_STATUS_TONE: Record<string, BadgeTone> = {
  PLANNING: 'info',
  ACTIVE: 'success',
  ON_HOLD: 'warning',
  COMPLETED: 'brand',
  ARCHIVED: 'neutral',
};
const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ');

const fmtDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const myId = useAuthStore((s) => s.user?.id);
  const [tab, setTab] = useState<Tab>('overview');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const projectQ = useQuery({ queryKey: ['project', id], queryFn: () => projectsApi(apiClient).get(id), enabled: !!id });
  const columnsQ = useQuery({ queryKey: ['columns', id], queryFn: () => columnsApi(apiClient).list(id), enabled: !!id });
  const tasksQ = useQuery({ queryKey: ['project-tasks', id], queryFn: () => tasksApi(apiClient).list(id), enabled: !!id });
  const membersQ = useQuery({ queryKey: ['members', id], queryFn: () => membersApi(apiClient).list(id), enabled: !!id });
  const usersQ = useQuery({ queryKey: ['users'], queryFn: () => usersApi(apiClient).list(), enabled: isAdmin && tab === 'team' });
  const directoryQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });

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
  const members = Array.isArray(membersQ.data) ? membersQ.data : [];
  const canManage = isAdmin || members.some((m) => m.id === myId && m.role === 'MANAGER');

  const directory = Array.isArray(directoryQ.data) ? directoryQ.data : [];
  const ownerName = (ownerId: string | null) => {
    if (!ownerId) return 'No owner';
    const u = directory.find((d) => d.id === ownerId);
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Unknown';
  };
  const ownerOptions = [
    { value: '', label: 'No owner' },
    ...directory.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username, hint: `@${u.username}` })),
  ];
  const ownerMut = useMutation({
    mutationFn: (ownerId: string | null) => projectsApi(apiClient).update(id, { ownerId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project', id] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  // ---- Tasks + status ----------------------------------------------------
  const columns = useMemo(
    () => (Array.isArray(columnsQ.data) ? [...columnsQ.data].sort((a, b) => a.position - b.position) : []),
    [columnsQ.data],
  );
  const columnById = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  const tasks = useMemo(() => (Array.isArray(tasksQ.data) ? tasksQ.data : []), [tasksQ.data]);

  const stats = useMemo(() => {
    const now = Date.now();
    let completed = 0;
    let inProgress = 0;
    let overdue = 0;
    for (const t of tasks) {
      const cat = columnById.get(t.columnId)?.category ?? 'TODO';
      if (cat === 'DONE') {
        completed += 1;
        continue;
      }
      if (cat === 'IN_PROGRESS') inProgress += 1;
      if (t.dueDate && new Date(t.dueDate).getTime() < now) overdue += 1;
    }
    const total = tasks.length;
    return { total, completed, inProgress, overdue, pct: total ? Math.round((completed / total) * 100) : 0 };
  }, [tasks, columnById]);

  // Tasks grouped by their status column (in board order), plus any orphaned tasks.
  const groups = useMemo(() => {
    const known = new Set(columns.map((c) => c.id));
    const base = columns.map((c) => ({ id: c.id, name: c.name, color: c.color, tasks: tasks.filter((t) => t.columnId === c.id) }));
    const orphans = tasks.filter((t) => !known.has(t.columnId));
    if (orphans.length) base.push({ id: '__orphan', name: 'Uncategorized', color: 'rgb(var(--c-ink-3))', tasks: orphans });
    return base;
  }, [columns, tasks]);

  const isOverdue = (t: ApiTask) =>
    !!t.dueDate && new Date(t.dueDate).getTime() < Date.now() && (columnById.get(t.columnId)?.category ?? 'TODO') !== 'DONE';

  // AI: a plain-language status summary from the live task stats + a few open task titles.
  const summarizeProject = () => {
    const openTitles = tasks
      .filter((t) => (columnById.get(t.columnId)?.category ?? 'TODO') !== 'DONE')
      .slice(0, 8)
      .map((t) => t.title);
    return aiApi(apiClient).summary(
      project?.name ?? 'Project',
      { total: stats.total, completed: stats.completed, inProgress: stats.inProgress, overdue: stats.overdue },
      openTitles,
    );
  };

  // ---- Project image -----------------------------------------------------
  const imageRef = useRef<HTMLInputElement>(null);
  const [imageBusy, setImageBusy] = useState(false);
  async function onImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !id) return;
    setImageBusy(true);
    try {
      await projectsApi(apiClient).uploadImage(id, file);
      await qc.invalidateQueries({ queryKey: ['project', id] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    } finally {
      setImageBusy(false);
    }
  }
  async function onImageRemove() {
    if (!id) return;
    setImageBusy(true);
    try {
      await projectsApi(apiClient).removeImage(id);
      await qc.invalidateQueries({ queryKey: ['project', id] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    } finally {
      setImageBusy(false);
    }
  }

  return (
    <div>
      <Link to="/projects" className="text-sm text-ink-2 hover:text-brand">← Projects</Link>

      {/* Header */}
      <div className="mt-1 flex items-start gap-4">
        {project?.imageUrl ? (
          <img src={assetUrl(project.imageUrl)} alt={project.name} className="h-16 w-16 flex-none rounded-2xl border border-line object-cover shadow-soft" />
        ) : (
          <span
            className="grid h-16 w-16 flex-none place-items-center rounded-2xl text-xl font-bold text-white shadow-soft"
            style={{ background: project?.color ?? 'rgb(var(--c-brand))' }}
            aria-hidden="true"
          >
            {(project?.name ?? '?').slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold text-ink">{project?.name ?? 'Project'}</h1>
            {project ? <Badge tone={PROJECT_STATUS_TONE[project.status] ?? 'neutral'} dot>{statusLabel(project.status)}</Badge> : null}
          </div>
          {project ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
              <span className="font-mono">{project.code}</span>
              {project.clientName ? <><span aria-hidden>·</span><span>{project.clientName}</span></> : null}
              <span aria-hidden>·</span>
              <span>Owner: {ownerName(project.ownerId)}</span>
            </p>
          ) : null}
          {canManage && project ? (
            <div className="mt-1 flex items-center gap-3">
              <input ref={imageRef} type="file" accept="image/*" hidden onChange={onImagePick} />
              <button type="button" onClick={() => imageRef.current?.click()} disabled={imageBusy} className="text-xs font-semibold text-brand hover:underline disabled:opacity-50">
                {imageBusy ? 'Uploading…' : project.imageUrl ? 'Change image' : 'Upload image'}
              </button>
              {project.imageUrl ? (
                <button type="button" onClick={onImageRemove} disabled={imageBusy} className="text-xs text-ink-2 hover:text-danger hover:underline disabled:opacity-50">
                  Remove
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Stat tiles — a snapshot of every task by status */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Total tasks" value={stats.total} />
        <StatTile label="Completed" value={stats.completed} tone="success" />
        <StatTile label="In progress" value={stats.inProgress} tone="info" />
        <StatTile label="Overdue" value={stats.overdue} tone="danger" />
        <StatTile label="Completion" value={`${stats.pct}%`} tone="brand" />
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-ground">
        <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${stats.pct}%` }} />
      </div>

      {/* Tabs */}
      <div role="tablist" className="mt-5 flex gap-1 border-b border-line">
        {(['overview', 'tasks', 'team'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium capitalize ${tab === t ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:text-ink'}`}
          >
            {t}
            {t === 'tasks' && stats.total ? <span className="rounded-full bg-ground px-1.5 text-xs text-ink-2">{stats.total}</span> : null}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {/* ---- OVERVIEW ---- */}
        {tab === 'overview' ? (
          projectQ.isError ? (
            <p role="alert" className="text-danger">
              Couldn’t load this project. <button className="font-semibold underline" onClick={() => projectQ.refetch()}>Retry</button>
            </p>
          ) : !project ? (
            <div className="skeleton h-28 rounded-xl" aria-label="Loading project" />
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              {/* Details */}
              <div className="space-y-4 lg:col-span-2">
                <section className="card p-5">
                  <h2 className="eyebrow mb-2">About</h2>
                  <p className="text-sm text-ink-2">{project.description || 'No description yet.'}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Owner</span>
                    {canManage ? (
                      <div className="w-60">
                        <SearchableSelect
                          ariaLabel="Project owner"
                          placeholder="No owner"
                          value={project.ownerId ?? ''}
                          options={ownerOptions}
                          onChange={(v) => ownerMut.mutate(v || null)}
                        />
                      </div>
                    ) : (
                      <span className="text-sm font-medium text-ink">{ownerName(project.ownerId)}</span>
                    )}
                    <span className="text-xs text-ink-3">New tasks default-assign to the owner.</span>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Link to="/board" className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-brand hover:border-brand">Open board</Link>
                    <button onClick={() => setTab('tasks')} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-ground">View all tasks</button>
                  </div>
                </section>
                <AiSummaryCard onSummarize={summarizeProject} title="AI status summary" />
              </div>

              {/* Status breakdown + facts */}
              <div className="space-y-4">
                <section className="card p-5">
                  <h2 className="eyebrow mb-3">Tasks by status</h2>
                  {columnsQ.isLoading || tasksQ.isLoading ? (
                    <div className="skeleton h-24 rounded-lg" />
                  ) : stats.total === 0 ? (
                    <p className="text-sm text-ink-2">No tasks in this project yet.</p>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {groups.map((g) => {
                        const pct = stats.total ? Math.round((g.tasks.length / stats.total) * 100) : 0;
                        return (
                          <div key={g.id} className="flex items-center gap-3">
                            <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: g.color }} aria-hidden />
                            <span className="w-28 flex-none truncate text-sm text-ink" title={g.name}>{g.name}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-ground">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: g.color }} />
                            </div>
                            <span className="w-6 flex-none text-right text-sm font-semibold tabular-nums text-ink-2">{g.tasks.length}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
                <section className="card p-5">
                  <h2 className="eyebrow mb-3">Details</h2>
                  <dl className="text-sm">
                    <Fact label="Priority" value={statusLabel(project.priority)} />
                    <Fact label="Client" value={project.clientName || '—'} />
                    <Fact label="Start date" value={fmtDate(project.startDate)} />
                    <Fact label="Target date" value={fmtDate(project.targetDate)} />
                    <Fact label="Members" value={String(members.length)} />
                  </dl>
                </section>
              </div>
            </div>
          )
        ) : null}

        {/* ---- TASKS: every task with its status ---- */}
        {tab === 'tasks' ? (
          tasksQ.isLoading || columnsQ.isLoading ? (
            <div className="skeleton h-40 rounded-xl" aria-label="Loading tasks" />
          ) : stats.total === 0 ? (
            <div className="card p-8 text-center text-sm text-ink-2">No tasks in this project yet.</div>
          ) : (
            <div className="space-y-5">
              {groups.filter((g) => g.tasks.length > 0).map((g) => (
                <section key={g.id}>
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} aria-hidden />
                    <h3 className="text-sm font-bold text-ink">{g.name}</h3>
                    <span className="rounded-full bg-ground px-2 text-xs font-semibold text-ink-2">{g.tasks.length}</span>
                  </div>
                  <div className="card divide-y divide-line overflow-hidden">
                    {g.tasks.map((t) => (
                      <TaskRow key={t.id} task={t} statusName={g.name} statusColor={g.color} overdue={isOverdue(t)} onOpen={() => setOpenTaskId(t.id)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )
        ) : null}

        {/* ---- TEAM ---- */}
        {tab === 'team' ? (
          <section className="card p-5">
            <h2 className="eyebrow mb-3">Team members</h2>
            <ProjectMembers
              members={members.map((m) => ({ id: m.id, name: name(m), role: m.role }))}
              addableUsers={(usersQ.data ?? []).map((u) => ({ id: u.id, name: name(u), role: 'MEMBER' as const }))}
              canManage={canManage}
              onAdd={(userId) => addM.mutate(userId)}
              onRemove={(userId) => removeM.mutate(userId)}
              onSetRole={(userId, role) => roleM.mutate({ userId, role })}
            />
          </section>
        ) : null}
      </div>

      {openTaskId ? <TaskDrawerContainer taskId={openTaskId} onClose={() => setOpenTaskId(null)} /> : null}
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
function StatTile({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: keyof typeof TILE_TONE }) {
  return (
    <div className="card p-4">
      <p className={`font-display text-2xl font-bold ${TILE_TONE[tone]}`}>{value}</p>
      <p className="mt-0.5 text-xs font-medium text-ink-2">{label}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-0">
      <dt className="text-ink-2">{label}</dt>
      <dd className="truncate font-medium text-ink">{value}</dd>
    </div>
  );
}

interface TaskRowProps {
  task: ApiTask;
  statusName: string;
  statusColor: string;
  overdue: boolean;
  onOpen: () => void;
}
function TaskRow({ task, statusName, statusColor, overdue, onOpen }: TaskRowProps) {
  const assignees = task.assignees ?? [];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ground/60"
    >
      <span className="w-16 flex-none font-mono text-xs text-ink-3">{task.key}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{task.title}</span>

      {/* Status pill */}
      <span className="hidden items-center gap-1.5 rounded-md bg-ground px-2 py-0.5 text-xs font-medium text-ink-2 sm:inline-flex">
        <span className="h-2 w-2 rounded-full" style={{ background: statusColor }} aria-hidden />
        {statusName}
      </span>

      <PriorityBadge priority={task.priority} />

      {/* Assignees */}
      {assignees.length ? (
        <span className="hidden items-center -space-x-1.5 md:flex">
          {assignees.slice(0, 3).map((a) => (
            <Avatar key={a.id} name={a.name} size="sm" />
          ))}
          {assignees.length > 3 ? <span className="grid h-6 w-6 place-items-center rounded-full border border-line bg-ground text-[10px] font-semibold text-ink-2">+{assignees.length - 3}</span> : null}
        </span>
      ) : null}

      {/* Due date */}
      <span className={`hidden w-24 flex-none text-right text-xs tabular-nums sm:block ${overdue ? 'font-semibold text-danger' : 'text-ink-2'}`}>
        {task.dueDate ? fmtDate(task.dueDate) : '—'}
      </span>
    </button>
  );
}
