import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { projectsApi } from '../api/projects';
import { columnsApi } from '../api/columns';
import { tasksApi, type ApiTask } from '../api/tasks';
import { shiftKey, formatKeyLabel, relativeKeyHint } from '../lib/board-date';
import { todayKey as companyTodayKey } from '../lib/due-date';
import { useCompanyTimeZone } from '../lib/company-clock';
import { ApiError } from '../lib/api-client';
import { enqueueOffline } from '../lib/offline-replay';
import { invalidateTaskQueries } from '../lib/task-cache';
import { readUserValue, writeUserValue } from '../lib/user-storage';
import { ALL_PROJECTS, boardProjects, composeAllProjectsBoard, composeBoard, moveTaskInBoard, reorderColumnInBoard, statusOfBoardColumn, targetColumnFor } from '../lib/board';
import { STATUS_META, type TaskCategory } from '../lib/taskStatus';
import { ProjectFilter } from '../components/board/ProjectFilter';
import type { KanbanColumnData } from '../components/KanbanColumn';
import { KanbanBoard } from '../components/KanbanBoard';
import { ColumnManager } from '../components/ColumnManager';
import { TaskFormDialog } from '../components/task-form/TaskFormDialog';
import { useCurrentProject } from '../components/CurrentProject';
import { TaskDrawerContainer } from '../components/TaskDrawerContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { useBoardRealtime, type BoardEvent } from '../lib/useBoardRealtime';
import { useAuthStore } from '../stores/auth-store';
import { LoadError } from '../components/ui/LoadError';
import { projectOption } from '../components/project-option';
import { useShortcut } from '../components/shortcuts/ShortcutProvider';
import { MoveTaskDialog, useMoveTargets, type MoveTaskRef } from '../components/MoveTaskDialog';
import type { CardMenuItem } from '../components/board/CardMenu';
import { moveAvailability, movedText } from '../lib/task-move';

type BoardData = { columns: KanbanColumnData[]; idByKey: Record<string, string> };
type MoveVars = { id: string; toColumnId: string; taskKey: string; toIndex: number; orderedIds: string[] };

/** Per-user (see lib/user-storage) memory of the last project viewed on the board ('all': every project). */
const PROJECT_PREF = 'board.projectId';
/** Per-user memory of the projects left out of the All projects board (so a new project shows). */
const HIDDEN_PREF = 'board.hiddenProjects';

function readHidden(userId: string | undefined): Set<string> {
  try {
    const ids: unknown = JSON.parse(readUserValue(userId, HIDDEN_PREF) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

const ALL_OPTION = {
  value: ALL_PROJECTS,
  label: 'All projects',
  icon: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
};

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.message ? e.message : fallback);
// Admin-triggered carry-forward runs at most once per app session (the server sweep handles the rest).
let carriedThisSession = false;

export function BoardPage() {
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const userId = useAuthStore((s) => s.user?.id);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [manageColumns, setManageColumns] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskColumn, setNewTaskColumn] = useState('');
  const [newTaskStatus, setNewTaskStatus] = useState<TaskCategory | undefined>(undefined);
  const [moveError, setMoveError] = useState(false);
  const [columnError, setColumnError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A card's "Move to another project…": the task being moved, then what happened.
  const [movingTask, setMovingTask] = useState<MoveTaskRef | null>(null);
  const [movedToast, setMovedToast] = useState<string | null>(null);
  useEffect(() => {
    if (!movedToast) return;
    const t = setTimeout(() => setMovedToast(null), 6000);
    return () => clearTimeout(t);
  }, [movedToast]);
  // A link like /board?project=<id> (e.g. "Open board" on a project page) wins; otherwise the
  // last project this user viewed (remembered per user), else the first.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlProjectId = searchParams.get('project') ?? '';
  const [selectedProjectId, setSelectedProjectId] = useState(() => readUserValue(useAuthStore.getState().user?.id, PROJECT_PREF) ?? '');
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const projects = projectsQ.data ?? [];
  // One project at a time, or All projects (offered when there is more than one).
  const has = (id: string) => !!id && (id === ALL_PROJECTS ? projects.length > 1 : projects.some((p) => p.id === id));
  const projectId = has(urlProjectId) ? urlProjectId : has(selectedProjectId) ? selectedProjectId : projects[0]?.id;
  const isAll = projectId === ALL_PROJECTS;
  const project = isAll ? undefined : projects.find((p) => p.id === projectId);
  const shownProjects = useMemo(() => boardProjects(projects), [projects]);
  const [hiddenProjects, setHiddenProjects] = useState(() => readHidden(useAuthStore.getState().user?.id));
  const chooseHidden = (next: Set<string>) => {
    setHiddenProjects(next);
    writeUserValue(userId, HIDDEN_PREF, JSON.stringify([...next]));
  };
  // New task from the header starts in the board's project (on All projects, the one used last).
  useCurrentProject(isAll ? undefined : projectId);
  const urlProjectValid = has(urlProjectId);
  useEffect(() => {
    // Remember a project opened by link too, so returning to /board shows it again.
    if (projectId && urlProjectValid) writeUserValue(userId, PROJECT_PREF, projectId);
  }, [projectId, urlProjectValid, userId]);
  const chooseProject = (id: string) => {
    setSelectedProjectId(id);
    writeUserValue(userId, PROJECT_PREF, id);
    if (urlProjectId) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('project', id);
          return next;
        },
        { replace: true },
      );
    }
  };

  // Per-date boards: view one calendar day at a time (default today, in the company time zone).
  const timeZone = useCompanyTimeZone();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const todayKey = companyTodayKey(timeZone);
  const boardDate = selectedDate ?? todayKey;

  // Auto carry-forward: when an admin opens today's board, run the sweep once so any still-open tasks
  // from previous days appear immediately (the server also sweeps on start-up + hourly for everyone).
  useEffect(() => {
    if (!isAdmin || boardDate !== todayKey || carriedThisSession) return;
    carriedThisSession = true;
    tasksApi(apiClient)
      .runCarryForward()
      .then((res) => { if (res.carried > 0) qc.invalidateQueries({ queryKey: ['board'] }); })
      .catch(() => { carriedThisSession = false; });
  }, [isAdmin, boardDate, todayKey, qc]);

  const columnsQ = useQuery({
    queryKey: ['columns', projectId],
    enabled: Boolean(projectId) && !isAll && manageColumns,
    queryFn: () => columnsApi(apiClient).list(projectId as string),
  });

  const refreshBoard = () => {
    qc.invalidateQueries({ queryKey: ['columns', projectId] });
    qc.invalidateQueries({ queryKey: ['board', projectId] });
  };
  /** Run a column change; a rejection (e.g. deleting a column that still has tasks) is shown, never swallowed. */
  async function columnAction(fn: () => Promise<unknown>) {
    setColumnError(null);
    try {
      await fn();
    } catch (e) {
      setColumnError(errorText(e, 'Couldn’t save that column change. Check your connection and try again.'));
    } finally {
      refreshBoard();
    }
  }
  async function reorderColumn(id: string, dir: 'up' | 'down') {
    const cols = [...(columnsQ.data ?? [])].sort((a, b) => a.position - b.position);
    const idx = cols.findIndex((c) => c.id === id);
    const j = dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || j < 0 || j >= cols.length) return;
    const a = cols[idx]!;
    const b = cols[j]!;
    // Swap through a guaranteed-unique temp position (the [projectId,position] unique index forbids a direct swap).
    await columnsApi(apiClient).update(a.id, { position: -1 - a.position });
    await columnsApi(apiClient).update(b.id, { position: a.position });
    await columnsApi(apiClient).update(a.id, { position: b.position });
  }
  /** Persist a full drag-reorder. Two phases (park at unique negatives, then final indices) so the
      [projectId, position] unique index never collides mid-update. */
  async function reorderColumnsTo(orderedIds: string[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await columnsApi(apiClient).update(orderedIds[i]!, { position: -1000 - i });
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await columnsApi(apiClient).update(orderedIds[i]!, { position: i });
    }
  }

  const boardQ = useQuery({
    queryKey: ['board', projectId, boardDate],
    enabled: Boolean(projectId) && !isAll,
    queryFn: async () => {
      const [columns, tasks] = await Promise.all([
        columnsApi(apiClient).list(projectId as string),
        tasksApi(apiClient).list(projectId, boardDate),
      ]);
      return { columns: composeBoard(columns, tasks), idByKey: Object.fromEntries(tasks.map((t) => [t.key, t.id])) };
    },
  });

  const moveMut = useMutation({
    // Move to the column, then re-sequence it so the card stays where it was dropped.
    mutationFn: async ({ id, toColumnId, orderedIds }: MoveVars) => {
      await tasksApi(apiClient).move(id, toColumnId);
      if (orderedIds.length > 1) await tasksApi(apiClient).reorder(toColumnId, orderedIds);
    },
    // Optimistically move the card so it lands instantly (at the drop position) instead of snapping
    // back to its origin column until the refetch returns; roll back and surface an error if it fails.
    onMutate: async ({ taskKey, toColumnId, toIndex }) => {
      setMoveError(false);
      const key = ['board', projectId, boardDate];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      if (prev) {
        qc.setQueryData<BoardData>(key, { ...prev, columns: moveTaskInBoard(prev.columns, taskKey, toColumnId, toIndex) });
      }
      return { prev, key };
    },
    onError: (e, vars, ctx) => {
      if (e instanceof ApiError) {
        // Server rejected the move (e.g. a version conflict) — roll back + surface.
        if (ctx?.prev && ctx.key) qc.setQueryData(ctx.key, ctx.prev); // the key captured at mutate time — not the board the user may have navigated to since
        setMoveError(true);
      } else {
        // Offline (network failure) — keep the optimistic move and queue it to replay on reconnect.
        enqueueOffline('task.move', { id: vars.id, toColumnId: vars.toColumnId });
        setNotice('You’re offline — the move was saved and will sync when you reconnect.');
      }
    },
    onSettled: (_d, e) => {
      // A network failure kept an optimistic move — don't clobber it by refetching a stale board.
      if (e instanceof ApiError || e == null) void invalidateTaskQueries(qc);
    },
  });

  const reorderMut = useMutation({
    mutationFn: ({ columnId, orderedIds }: { columnId: string; orderedIds: string[]; orderedKeys: string[] }) =>
      tasksApi(apiClient).reorder(columnId, orderedIds),
    onMutate: async ({ columnId, orderedKeys }) => {
      const key = ['board', projectId, boardDate];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      if (prev) qc.setQueryData<BoardData>(key, { ...prev, columns: reorderColumnInBoard(prev.columns, columnId, orderedKeys) });
      return { prev, key };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev && ctx.key) qc.setQueryData(ctx.key, ctx.prev); // the key captured at mutate time — not the board the user may have navigated to since
      setMoveError(true);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['board', projectId] }),
  });

  // ── All projects: every project's tasks for the day, under the six statuses ──
  const allKey = ['board', ALL_PROJECTS, boardDate];
  const allQ = useQuery({
    queryKey: allKey,
    enabled: isAll,
    queryFn: () => tasksApi(apiClient).list(undefined, boardDate),
  });
  const allColumns = useMemo(
    () => (isAll ? composeAllProjectsBoard(allQ.data ?? [], projects, { hidden: hiddenProjects }) : []),
    [isAll, allQ.data, projects, hiddenProjects],
  );

  // A card dropped on a status moves into its own project's first column of that kind.
  const statusMoveMut = useMutation({
    mutationFn: ({ id, toColumnId }: { id: string; toColumnId: string; taskKey: string; status: TaskCategory }) => tasksApi(apiClient).move(id, toColumnId),
    onMutate: async ({ taskKey, toColumnId, status }) => {
      setMoveError(false);
      const key = allKey;
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ApiTask[]>(key);
      if (prev) {
        qc.setQueryData<ApiTask[]>(
          key,
          prev.map((t) => (t.key === taskKey ? { ...t, columnId: toColumnId, columnCategory: status, ...(status !== 'DONE' ? { completedAt: null } : {}) } : t)),
        );
      }
      return { prev, key };
    },
    onError: (e, vars, ctx) => {
      if (e instanceof ApiError) {
        if (ctx?.prev && ctx.key) qc.setQueryData(ctx.key, ctx.prev);
        setMoveError(true);
      } else {
        enqueueOffline('task.move', { id: vars.id, toColumnId: vars.toColumnId });
        setNotice('You’re offline — the move was saved and will sync when you reconnect.');
      }
    },
    onSettled: (_d, e) => {
      if (e instanceof ApiError || e == null) void invalidateTaskQueries(qc);
    },
  });

  async function onMoveToStatus(taskKey: string, toColumnId: string) {
    const status = statusOfBoardColumn(toColumnId);
    const t = allQ.data?.find((x) => x.key === taskKey);
    if (!status || !t || (t.columnCategory ?? 'TODO') === status) return;
    let columns;
    try {
      columns = await qc.fetchQuery({ queryKey: ['columns', t.projectId], queryFn: () => columnsApi(apiClient).list(t.projectId), staleTime: 60_000 });
    } catch {
      setMoveError(true);
      return;
    }
    const target = targetColumnFor(columns, status);
    if (!target) {
      const name = projects.find((p) => p.id === t.projectId)?.name ?? 'Its project';
      setNotice(`${name} has no “${STATUS_META[status]!.label}” column, so ${taskKey} stayed where it was.`);
      return;
    }
    statusMoveMut.mutate({ id: t.id, toColumnId: target, taskKey, status });
  }

  // Each card's menu: "Move to another project…", offered to those who may (and saying why to others).
  const moveTargets = useMoveTargets();
  const refByKey = useMemo(() => {
    const refs = new Map<string, MoveTaskRef>();
    if (isAll) {
      for (const t of allQ.data ?? []) refs.set(t.key, { id: t.id, key: t.key, title: t.title, projectId: t.projectId });
    } else if (boardQ.data && projectId) {
      for (const column of boardQ.data.columns) {
        for (const t of column.tasks) {
          const id = boardQ.data.idByKey[t.key];
          if (id) refs.set(t.key, { id, key: t.key, title: t.title, projectId });
        }
      }
    }
    return refs;
  }, [isAll, allQ.data, boardQ.data, projectId]);
  const cardMenu = (key: string): CardMenuItem[] | null => {
    const ref = refByKey.get(key);
    if (!ref) return null;
    const name = projects.find((p) => p.id === ref.projectId)?.name;
    return [{ label: 'Move to another project…', onSelect: () => setMovingTask(ref), unavailable: moveAvailability(ref.projectId, moveTargets, name).reason }];
  };

  const boardColumns = isAll ? allColumns : boardQ.data?.columns ?? [];
  const idByKey = useMemo(
    () => (isAll ? Object.fromEntries((allQ.data ?? []).map((t) => [t.key, t.id])) : boardQ.data?.idByKey ?? {}),
    [isAll, allQ.data, boardQ.data],
  );

  /**
   * New task, in the column it was started from (a column's "+" or empty box), else the first. On
   * All projects, in that kind of column of whichever project is chosen in the form.
   */
  function openAddTask(columnId?: string) {
    if (isAll) setNewTaskStatus(columnId ? statusOfBoardColumn(columnId) ?? undefined : undefined);
    else setNewTaskColumn(columnId ?? boardColumns[0]?.id ?? '');
    setAddingTask(true);
  }
  useShortcut('new', () => openAddTask(), { enabled: boardColumns.length > 0 });

  // Live board: refetch when another client creates/moves/updates/deletes/reassigns a task (T7.4).
  const onLiveEvent = useCallback(
    (event: BoardEvent, payload?: unknown) => {
      if (event === 'project:removed') {
        // This user was taken off a project: drop it from the list and leave its board if it's open.
        const removedId = (payload as { projectId?: string } | undefined)?.projectId;
        void qc.invalidateQueries({ queryKey: ['projects'] });
        if (projectId === ALL_PROJECTS) void qc.invalidateQueries({ queryKey: ['board', ALL_PROJECTS] });
        if (removedId && removedId === projectId) {
          setNotice(`You were removed from ${project?.name ?? 'this project'}, so its board was closed.`);
          setOpenTaskId(null);
          setAddingTask(false);
          setSelectedProjectId('');
          writeUserValue(userId, PROJECT_PREF, null);
          if (urlProjectId) {
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.delete('project');
                return next;
              },
              { replace: true },
            );
          }
        }
        return;
      }
      void qc.invalidateQueries({ queryKey: ['board', projectId] });
      const p = (payload ?? {}) as { id?: string; taskId?: string };
      // A deleted/changed task open in a drawer refetches (and shows "not found" once deleted).
      if (p.id && event !== 'task:created') void qc.invalidateQueries({ queryKey: ['task', p.id] });
      if (event === 'task:assignees' && p.taskId) void qc.invalidateQueries({ queryKey: ['assignees', p.taskId] });
      // After a reconnect we may have missed anything — refresh every task view.
      if (event === 'resync') void invalidateTaskQueries(qc);
    },
    [qc, projectId, project?.name, userId, urlProjectId, setSearchParams],
  );
  // All projects: live updates from every project it shows, on one connection.
  const liveRooms = useMemo(() => (isAll ? shownProjects.map((p) => p.id) : projectId), [isAll, shownProjects, projectId]);
  useBoardRealtime(liveRooms, onLiveEvent);

  function onMove(taskKey: string, toColumnId: string, toIndex: number) {
    if (isAll) {
      void onMoveToStatus(taskKey, toColumnId);
      return;
    }
    const data = boardQ.data;
    const id = data?.idByKey[taskKey];
    if (!data || !id) return;
    const after = moveTaskInBoard(data.columns, taskKey, toColumnId, toIndex);
    const orderedIds = (after.find((c) => c.id === toColumnId)?.tasks ?? [])
      .map((t) => data.idByKey[t.key])
      .filter((x): x is string => Boolean(x));
    moveMut.mutate({ id, toColumnId, taskKey, toIndex, orderedIds });
  }

  function onReorder(columnId: string, orderedKeys: string[]) {
    const orderedIds = orderedKeys.map((k) => boardQ.data?.idByKey[k]).filter((x): x is string => Boolean(x));
    if (orderedIds.length) reorderMut.mutate({ columnId, orderedIds, orderedKeys });
  }

  const loading = projectsQ.isLoading || (Boolean(projectId) && (isAll ? allQ.isLoading : boardQ.isLoading));
  const error = projectsQ.isError || (isAll ? allQ.isError : boardQ.isError);

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Kanban Board"
        subtitle={
          isAll ? 'All projects — drag a card to change its status in its own project.'
          : project ? <span dir="auto">{project.name}</span>
          : 'Drag tasks across columns to update their status.'
        }
        actions={
          projectId ? (
            <>
              {projects.length > 1 ? (
                <div className="w-52">
                  <SearchableSelect
                    ariaLabel="Select project"
                    value={projectId}
                    onChange={(v) => chooseProject(v)}
                    options={[ALL_OPTION, ...projects.map(projectOption)]}
                  />
                </div>
              ) : null}
              {isAll ? <ProjectFilter projects={shownProjects} hidden={hiddenProjects} onChange={chooseHidden} /> : null}
              {isAdmin && !isAll ? (
                <button
                  onClick={() => setManageColumns((v) => !v)}
                  aria-expanded={manageColumns}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:bg-ground"
                >
                  {manageColumns ? 'Done' : 'Manage columns'}
                </button>
              ) : null}
              <Button onClick={() => openAddTask()} disabled={boardColumns.length === 0} title="New task" shortcut="new">
                + New task
              </Button>
            </>
          ) : undefined
        }
      />

      {projectId ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-xl border border-line bg-surface p-0.5">
            <button
              onClick={() => setSelectedDate(shiftKey(boardDate, -1))}
              aria-label="Previous day"
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <input
              type="date"
              aria-label="Board date"
              value={boardDate}
              onChange={(e) => setSelectedDate(e.target.value || null)}
              className="border-0 bg-transparent px-1 text-sm text-ink outline-none"
            />
            <button
              onClick={() => setSelectedDate(shiftKey(boardDate, 1))}
              aria-label="Next day"
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
          <span className="text-sm font-semibold text-ink">{formatKeyLabel(boardDate)}</span>
          {relativeKeyHint(boardDate, todayKey) ? (
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">{relativeKeyHint(boardDate, todayKey)}</span>
          ) : null}
          {boardDate !== todayKey ? (
            <button
              onClick={() => setSelectedDate(null)}
              className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-brand/30 hover:bg-ground"
            >
              Jump to today
            </button>
          ) : null}
        </div>
      ) : null}

      {manageColumns && projectId && !isAll ? (
        <div className="card mb-4 p-5">
          <h2 className="eyebrow mb-3">Columns</h2>
          <ColumnManager
            columns={columnsQ.data ?? []}
            onAdd={(name) => void columnAction(() => columnsApi(apiClient).add(projectId, { name }))}
            onRename={(id, name) => void columnAction(() => columnsApi(apiClient).update(id, { name }))}
            onSetColor={(id, color) => void columnAction(() => columnsApi(apiClient).update(id, { color }))}
            onSetCategory={(id, category) => void columnAction(() => columnsApi(apiClient).update(id, { category }))}
            onToggleEnabled={(id, enabled) => void columnAction(() => columnsApi(apiClient).update(id, { enabled }))}
            onDelete={(id) => void columnAction(() => columnsApi(apiClient).remove(id))}
            onMove={(id, dir) => void columnAction(() => reorderColumn(id, dir))}
            onReorder={(ids) => void columnAction(() => reorderColumnsTo(ids))}
          />
          {columnError ? (
            <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {columnError}
            </p>
          ) : null}
        </div>
      ) : null}

      {moveError ? (
        <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          Couldn’t move that task — it was put back. Please try again.
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-xs font-semibold underline">Dismiss</button>
        </p>
      ) : null}

      {loading ? (
        <p className="text-ink-2">Loading…</p>
      ) : error ? (
        <LoadError what="the board" onRetry={() => { void projectsQ.refetch(); void (isAll ? allQ.refetch() : boardQ.refetch()); }} />
      ) : !projectId ? (
        <p className="text-ink-2">No projects yet — create one to get started.</p>
      ) : (
        <KanbanBoard
          columns={boardColumns}
          timeZone={timeZone}
          onMove={onMove}
          // On All projects a status mixes projects: cards keep their order (due date, then priority).
          onReorder={isAll ? undefined : onReorder}
          onAddTask={(columnId) => openAddTask(columnId)}
          cardMenu={cardMenu}
          onTaskClick={(key) => {
            const id = idByKey[key];
            if (id) setOpenTaskId(id);
          }}
        />
      )}

      {openTaskId ? <TaskDrawerContainer taskId={openTaskId} onClose={() => setOpenTaskId(null)} /> : null}

      {movingTask ? (
        <MoveTaskDialog
          tasks={[movingTask]}
          onClose={() => setMovingTask(null)}
          onMoved={(result) => {
            setMovingTask(null);
            setMovedToast(movedText(result));
            // Off this board, onto the other project's (live boards elsewhere hear it too).
            void invalidateTaskQueries(qc);
          }}
        />
      ) : null}
      {movedToast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <p role="status" className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink shadow-lift">
            <span>{movedToast}</span>
            <button type="button" onClick={() => setMovedToast(null)} aria-label="Dismiss" className="text-ink-2 hover:text-ink">
              ✕
            </button>
          </p>
        </div>
      ) : null}

      {addingTask && projectId ? (
        // One request creates the task with its people; the board day keeps it on the day being viewed.
        // On All projects the project is chosen in the form.
        <TaskFormDialog
          {...(isAll ? { defaultColumnCategory: newTaskStatus } : { projectId, defaultColumnId: newTaskColumn })}
          boardDate={boardDate}
          onClose={() => setAddingTask(false)}
          onQueued={() => setNotice('You’re offline — the task was saved and will sync when you reconnect.')}
        />
      ) : null}
    </div>
  );
}
