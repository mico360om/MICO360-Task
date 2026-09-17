import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { projectsApi } from '../api/projects';
import { columnsApi } from '../api/columns';
import { tasksApi } from '../api/tasks';
import { membersApi } from '../api/members';
import { assigneesApi } from '../api/assignees';
import { configApi } from '../api/config';
import { dateKey, shiftKey, formatKeyLabel, relativeKeyHint } from '../lib/board-date';
import { ApiError } from '../lib/api-client';
import { enqueueOffline } from '../lib/offline-replay';
import { useCallback } from 'react';
import { composeBoard, moveTaskInBoard, reorderColumnInBoard } from '../lib/board';
import type { KanbanColumnData } from '../components/KanbanColumn';
import { KanbanBoard } from '../components/KanbanBoard';
import { ColumnManager } from '../components/ColumnManager';
import { QuickAddTaskForm } from '../components/QuickAddTaskForm';
import { TaskDrawerContainer } from '../components/TaskDrawerContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { FieldLabel } from '../components/ui/Field';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { useBoardRealtime } from '../lib/useBoardRealtime';
import { useAuthStore } from '../stores/auth-store';

type BoardData = { columns: KanbanColumnData[]; idByKey: Record<string, string> };

const PROJECT_KEY = 'mico360.board.projectId';
// Admin-triggered carry-forward runs at most once per app session (the server sweep handles the rest).
let carriedThisSession = false;

export function BoardPage() {
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [manageColumns, setManageColumns] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskColumn, setNewTaskColumn] = useState('');
  const [moveError, setMoveError] = useState(false);
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  // Remember the last-viewed project across reloads/navigation (persisted per browser).
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    try { return localStorage.getItem(PROJECT_KEY) ?? ''; } catch { return ''; }
  });
  const chooseProject = (id: string) => {
    setSelectedProjectId(id);
    try { localStorage.setItem(PROJECT_KEY, id); } catch { /* storage may be unavailable */ }
  };
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const projects = projectsQ.data ?? [];
  // Board shows one project at a time; honour the remembered project if it still exists, else the first.
  const projectId = (selectedProjectId && projects.some((p) => p.id === selectedProjectId))
    ? selectedProjectId
    : projects[0]?.id;
  const project = projects.find((p) => p.id === projectId);

  // Per-date boards: view one calendar day at a time (default today, in the company time zone).
  const cfgQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  const timeZone = cfgQ.data?.timeZone ?? 'Asia/Muscat';
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const todayKey = dateKey(new Date(), timeZone);
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
    enabled: Boolean(projectId) && manageColumns,
    queryFn: () => columnsApi(apiClient).list(projectId as string),
  });

  const refreshBoard = () => {
    qc.invalidateQueries({ queryKey: ['columns', projectId] });
    qc.invalidateQueries({ queryKey: ['board', projectId] });
  };
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
    refreshBoard();
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
    refreshBoard();
  }

  const boardQ = useQuery({
    queryKey: ['board', projectId, boardDate],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const [columns, tasks] = await Promise.all([
        columnsApi(apiClient).list(projectId as string),
        tasksApi(apiClient).list(projectId, boardDate),
      ]);
      return { columns: composeBoard(columns, tasks), idByKey: Object.fromEntries(tasks.map((t) => [t.key, t.id])) };
    },
  });

  const moveMut = useMutation({
    mutationFn: ({ id, toColumnId }: { id: string; toColumnId: string; taskKey: string }) =>
      tasksApi(apiClient).move(id, toColumnId),
    // Optimistically move the card so it lands instantly instead of snapping back to its
    // origin column until the refetch returns; roll back and surface an error if it fails.
    onMutate: async ({ taskKey, toColumnId }) => {
      setMoveError(false);
      const key = ['board', projectId, boardDate];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardData>(key);
      if (prev) {
        qc.setQueryData<BoardData>(key, { ...prev, columns: moveTaskInBoard(prev.columns, taskKey, toColumnId) });
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
        setOfflineNote('You’re offline — the move was saved and will sync when you reconnect.');
      }
    },
    onSettled: (_d, e) => {
      // A network failure kept an optimistic move — don't clobber it by refetching a stale board.
      if (e instanceof ApiError || e == null) qc.invalidateQueries({ queryKey: ['board', projectId] });
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

  const boardColumns = boardQ.data?.columns ?? [];

  const membersQ = useQuery({
    queryKey: ['members', projectId],
    enabled: Boolean(projectId) && addingTask,
    queryFn: () => membersApi(apiClient).list(projectId as string),
  });
  const assigneeOptions = (membersQ.data ?? []).map((m) => ({
    id: m.id,
    label: [m.firstName, m.lastName].filter(Boolean).join(' ') || m.username,
  }));

  const createMut = useMutation({
    mutationFn: async (input: { title: string; priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; description: string; assigneeIds: string[] }) => {
      const task = await tasksApi(apiClient).create({
        projectId: projectId as string,
        columnId: newTaskColumn || boardColumns[0]?.id || '',
        title: input.title,
        priority: input.priority,
        boardDate, // land on the day currently being viewed
        ...(input.description ? { description: input.description } : {}),
      });
      if (input.assigneeIds.length) await assigneesApi(apiClient).assignMany(task.id, input.assigneeIds);
      return task;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['board', projectId] });
      setAddingTask(false);
    },
    onError: (e, vars) => {
      // Offline — queue the create so it appears after the next sync (server errors keep the banner).
      if (!(e instanceof ApiError)) {
        enqueueOffline('task.create', {
          projectId: projectId as string,
          columnId: newTaskColumn || boardColumns[0]?.id || '',
          title: vars.title,
          priority: vars.priority,
          boardDate,
          ...(vars.description ? { description: vars.description } : {}),
        });
        setAddingTask(false);
        setOfflineNote('You’re offline — the task was saved and will sync when you reconnect.');
      }
    },
  });

  function openAddTask() {
    setNewTaskColumn(boardColumns[0]?.id ?? '');
    setAddingTask(true);
  }

  // Live board: refetch when another client creates/moves/updates a task in this project (T7.4).
  const onLiveEvent = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['board', projectId] });
  }, [qc, projectId]);
  useBoardRealtime(projectId, onLiveEvent);

  function onMove(taskKey: string, toColumnId: string) {
    const id = boardQ.data?.idByKey[taskKey];
    if (id) moveMut.mutate({ id, toColumnId, taskKey });
  }

  function onReorder(columnId: string, orderedKeys: string[]) {
    const orderedIds = orderedKeys.map((k) => boardQ.data?.idByKey[k]).filter((x): x is string => Boolean(x));
    if (orderedIds.length) reorderMut.mutate({ columnId, orderedIds, orderedKeys });
  }

  const loading = projectsQ.isLoading || (Boolean(projectId) && boardQ.isLoading);
  const error = projectsQ.isError || boardQ.isError;

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Kanban Board"
        subtitle={project ? project.name : 'Drag tasks across columns to update their status.'}
        actions={
          projectId ? (
            <>
              {projects.length > 1 ? (
                <div className="w-52">
                  <SearchableSelect
                    ariaLabel="Select project"
                    value={projectId}
                    onChange={(v) => chooseProject(v)}
                    options={projects.map((p) => ({ value: p.id, label: p.name, hint: p.code }))}
                  />
                </div>
              ) : null}
              {isAdmin ? (
                <button
                  onClick={() => setManageColumns((v) => !v)}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:bg-ground"
                >
                  {manageColumns ? 'Done' : 'Manage columns'}
                </button>
              ) : null}
              <Button onClick={openAddTask} disabled={boardColumns.length === 0}>
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

      {manageColumns && projectId ? (
        <div className="card mb-4 p-5">
          <h2 className="eyebrow mb-3">Columns</h2>
          <ColumnManager
            columns={columnsQ.data ?? []}
            onAdd={async (name) => { await columnsApi(apiClient).add(projectId, { name }); refreshBoard(); }}
            onRename={async (id, name) => { await columnsApi(apiClient).update(id, { name }); refreshBoard(); }}
            onSetColor={async (id, color) => { await columnsApi(apiClient).update(id, { color }); refreshBoard(); }}
            onSetCategory={async (id, category) => { await columnsApi(apiClient).update(id, { category }); refreshBoard(); }}
            onToggleEnabled={async (id, enabled) => { await columnsApi(apiClient).update(id, { enabled }); refreshBoard(); }}
            onDelete={async (id) => { await columnsApi(apiClient).remove(id); refreshBoard(); }}
            onMove={reorderColumn}
            onReorder={reorderColumnsTo}
          />
        </div>
      ) : null}

      {moveError ? (
        <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          Couldn’t move that task — it was put back. Please try again.
        </p>
      ) : null}

      {offlineNote ? (
        <p role="status" className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <span>{offlineNote}</span>
          <button onClick={() => setOfflineNote(null)} className="text-xs font-semibold underline">Dismiss</button>
        </p>
      ) : null}

      {loading ? (
        <p className="text-ink-2">Loading…</p>
      ) : error ? (
        <p role="alert" className="text-danger">
          Couldn’t load the board. Is the API running?
        </p>
      ) : !projectId ? (
        <p className="text-ink-2">No projects yet — create one to get started.</p>
      ) : (
        <KanbanBoard
          columns={boardQ.data?.columns ?? []}
          onMove={onMove}
          onReorder={onReorder}
          onTaskClick={(key) => {
            const id = boardQ.data?.idByKey[key];
            if (id) setOpenTaskId(id);
          }}
        />
      )}

      {openTaskId ? <TaskDrawerContainer taskId={openTaskId} onClose={() => setOpenTaskId(null)} /> : null}

      {addingTask ? (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={() => setAddingTask(false)} aria-hidden="true" />
          <div role="dialog" aria-label="New task" className="card relative w-full max-w-md animate-scale-in p-6">
            <h2 className="mb-4 font-display text-xl font-bold text-ink">New task</h2>
            {createMut.isError ? (
              <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                Couldn’t create the task. Please try again.
              </p>
            ) : null}
            <div className="mb-3 flex flex-col gap-1.5">
              <FieldLabel>Column</FieldLabel>
              <SearchableSelect
                ariaLabel="Column"
                value={newTaskColumn}
                onChange={(v) => setNewTaskColumn(v)}
                options={boardColumns.map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>
            <QuickAddTaskForm submitting={createMut.isPending} assignees={assigneeOptions} onSubmit={(v) => createMut.mutate(v)} />
            <button
              onClick={() => setAddingTask(false)}
              className="mt-3 w-full rounded-lg py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-ground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
