import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { projectsApi } from '../api/projects';
import { columnsApi } from '../api/columns';
import { tasksApi, type NewTaskInput } from '../api/tasks';
import { membersApi } from '../api/members';
import { shiftKey, formatKeyLabel, relativeKeyHint } from '../lib/board-date';
import { todayKey as companyTodayKey } from '../lib/due-date';
import { useCompanyTimeZone } from '../lib/company-clock';
import { ApiError } from '../lib/api-client';
import { enqueueOffline } from '../lib/offline-replay';
import { newIdempotencyKey } from '../lib/offline-queue';
import { invalidateTaskQueries } from '../lib/task-cache';
import { readUserValue, writeUserValue } from '../lib/user-storage';
import { composeBoard, moveTaskInBoard, reorderColumnInBoard } from '../lib/board';
import type { KanbanColumnData } from '../components/KanbanColumn';
import { KanbanBoard } from '../components/KanbanBoard';
import { ColumnManager } from '../components/ColumnManager';
import { QuickAddTaskForm, type AssigneeOption, type QuickAddValues } from '../components/QuickAddTaskForm';
import { TaskDrawerContainer } from '../components/TaskDrawerContainer';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { FieldLabel } from '../components/ui/Field';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { useBoardRealtime, type BoardEvent } from '../lib/useBoardRealtime';
import { useDialog } from '../hooks/useDialog';
import { useAuthStore } from '../stores/auth-store';

type BoardData = { columns: KanbanColumnData[]; idByKey: Record<string, string> };
type CreateVars = { input: NewTaskInput; idempotencyKey: string };
type MoveVars = { id: string; toColumnId: string; taskKey: string; toIndex: number; orderedIds: string[] };

/** Per-user (see lib/user-storage) memory of the last project viewed on the board. */
const PROJECT_PREF = 'board.projectId';

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
  const [moveError, setMoveError] = useState(false);
  const [columnError, setColumnError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A link like /board?project=<id> (e.g. "Open board" on a project page) wins; otherwise the
  // last project this user viewed (remembered per user), else the first.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlProjectId = searchParams.get('project') ?? '';
  const [selectedProjectId, setSelectedProjectId] = useState(() => readUserValue(useAuthStore.getState().user?.id, PROJECT_PREF) ?? '');
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const projects = projectsQ.data ?? [];
  const has = (id: string) => !!id && projects.some((p) => p.id === id);
  // Board shows one project at a time.
  const projectId = has(urlProjectId) ? urlProjectId : has(selectedProjectId) ? selectedProjectId : projects[0]?.id;
  const project = projects.find((p) => p.id === projectId);
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
    enabled: Boolean(projectId) && manageColumns,
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

  const boardColumns = boardQ.data?.columns ?? [];

  const membersQ = useQuery({
    queryKey: ['members', projectId],
    enabled: Boolean(projectId) && addingTask,
    queryFn: () => membersApi(apiClient).list(projectId as string),
  });
  const assigneeOptions: AssigneeOption[] = (membersQ.data ?? []).map((m) => ({
    id: m.id,
    label: [m.firstName, m.lastName].filter(Boolean).join(' ') || m.username,
  }));

  // One request creates the task with its due date and assignees (no second call that can fail
  // half-way, and no project-owner default when people were picked). The Idempotency-Key is shared
  // with the offline queue, so if the request did reach the server a replay can't duplicate it.
  const createMut = useMutation({
    mutationFn: ({ input, idempotencyKey }: CreateVars) => tasksApi(apiClient).create(input, { idempotencyKey }),
    onSuccess: () => {
      void invalidateTaskQueries(qc);
      setAddingTask(false);
    },
    onError: (e, vars) => {
      // Offline — queue the create so it appears after the next sync (server errors keep the banner).
      if (!(e instanceof ApiError)) {
        enqueueOffline('task.create', vars.input, { idempotencyKey: vars.idempotencyKey });
        setAddingTask(false);
        setNotice('You’re offline — the task was saved and will sync when you reconnect.');
      }
    },
  });

  function submitNewTask(v: QuickAddValues) {
    const input: NewTaskInput = {
      projectId: projectId as string,
      columnId: newTaskColumn || boardColumns[0]?.id || '',
      title: v.title,
      priority: v.priority,
      boardDate, // land on the day currently being viewed
      ...(v.description ? { description: v.description } : {}),
      ...(v.dueDate ? { dueDate: v.dueDate } : {}),
      ...(v.recurrenceRule ? { recurrenceRule: v.recurrenceRule } : {}),
      // Only when someone was picked — otherwise the project's default (its owner) applies.
      ...(v.assigneeIds.length ? { assigneeIds: v.assigneeIds } : {}),
    };
    createMut.mutate({ input, idempotencyKey: newIdempotencyKey() });
  }

  function openAddTask() {
    setNewTaskColumn(boardColumns[0]?.id ?? '');
    setAddingTask(true);
  }

  // Live board: refetch when another client creates/moves/updates/deletes/reassigns a task (T7.4).
  const onLiveEvent = useCallback(
    (event: BoardEvent, payload?: unknown) => {
      if (event === 'project:removed') {
        // This user was taken off a project: drop it from the list and leave its board if it's open.
        const removedId = (payload as { projectId?: string } | undefined)?.projectId;
        void qc.invalidateQueries({ queryKey: ['projects'] });
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
  useBoardRealtime(projectId, onLiveEvent);

  function onMove(taskKey: string, toColumnId: string, toIndex: number) {
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

  const loading = projectsQ.isLoading || (Boolean(projectId) && boardQ.isLoading);
  const error = projectsQ.isError || boardQ.isError;

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Kanban Board"
        subtitle={project ? <span dir="auto">{project.name}</span> : 'Drag tasks across columns to update their status.'}
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
        <p role="alert" className="text-danger">
          Couldn’t load the board. Is the API running?
        </p>
      ) : !projectId ? (
        <p className="text-ink-2">No projects yet — create one to get started.</p>
      ) : (
        <KanbanBoard
          columns={boardQ.data?.columns ?? []}
          timeZone={timeZone}
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
        <NewTaskDialog
          columns={boardColumns.map((c) => ({ value: c.id, label: c.name }))}
          column={newTaskColumn}
          onColumnChange={setNewTaskColumn}
          assignees={assigneeOptions}
          submitting={createMut.isPending}
          error={createMut.isError ? errorText(createMut.error, 'Couldn’t create the task. Please try again.') : null}
          onSubmit={submitNewTask}
          onClose={() => setAddingTask(false)}
        />
      ) : null}
    </div>
  );
}

interface NewTaskDialogProps {
  columns: { value: string; label: string }[];
  column: string;
  onColumnChange: (id: string) => void;
  assignees: AssigneeOption[];
  submitting: boolean;
  error: string | null;
  onSubmit: (v: QuickAddValues) => void;
  onClose: () => void;
}

/** The board's "New task" dialog: focus moves in, Tab stays inside, Escape closes, focus returns. */
function NewTaskDialog({ columns, column, onColumnChange, assignees, submitting, error, onSubmit, onClose }: NewTaskDialogProps) {
  const dialogRef = useDialog(onClose);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="New task" className="card relative max-h-[calc(100dvh-2rem)] w-full max-w-md animate-scale-in overflow-y-auto p-6">
        <h2 className="mb-4 font-display text-xl font-bold text-ink">New task</h2>
        {error ? (
          <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="mb-3 flex flex-col gap-1.5">
          <FieldLabel>Column</FieldLabel>
          <SearchableSelect ariaLabel="Column" value={column} onChange={onColumnChange} options={columns} />
        </div>
        <QuickAddTaskForm submitting={submitting} assignees={assignees} onSubmit={onSubmit} />
        <button
          onClick={onClose}
          className="mt-3 w-full rounded-lg py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-ground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
