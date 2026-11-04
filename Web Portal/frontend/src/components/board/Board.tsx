import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { columnsApi, type ApiColumn } from '../../api/columns';
import { tasksApi, type ApiTask } from '../../api/tasks';
import type { ApiProject } from '../../api/projects';
import { shiftKey, formatKeyLabel, relativeKeyHint } from '../../lib/board-date';
import { todayKey as companyTodayKey } from '../../lib/due-date';
import { useCompanyTimeZone } from '../../lib/company-clock';
import { useOpenTask } from '../../lib/useOpenTask';
import { ApiError } from '../../lib/api-client';
import { enqueueOffline } from '../../lib/offline-replay';
import { invalidateTaskQueries } from '../../lib/task-cache';
import { approvalNotice } from '../../lib/approvals';
import { ALL_PROJECTS, BOARD_FIT_QUERY, boardCompanies, boardProjects, composeAllProjectsBoard, composeBoard, filterBoardByCompany, fullColumnIndex, moveTaskInBoard, reorderColumnInBoard, statusOfBoardColumn, targetColumnFor } from '../../lib/board';
import { STATUS_META, type TaskCategory } from '../../lib/taskStatus';
import { BoardPeople } from './BoardPeople';
import type { KanbanColumnData } from '../KanbanColumn';
import { KanbanBoard } from '../KanbanBoard';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useFrameOffset } from '../../lib/useFrameOffset';
import { ColumnManager } from '../ColumnManager';
import { TaskFormDialog } from '../task-form/TaskFormDialog';
import { Button } from '../ui/Button';
import { SearchableSelect } from '../ui/SearchableSelect';
import { EXTERNAL_CONTACT_WORDS } from '../../lib/external-contacts';
import { useBoardRealtime, type BoardEvent } from '../../lib/useBoardRealtime';
import { useAuthStore } from '../../stores/auth-store';
import { LoadError } from '../ui/LoadError';
import { useShortcut } from '../shortcuts/ShortcutProvider';
import { MoveTaskDialog, useMoveTargets, type MoveTaskRef } from '../MoveTaskDialog';
import { EmptyState } from '../ui/EmptyState';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';
import type { CardMenuItem } from './CardMenu';
import { moveAvailability, movedText } from '../../lib/task-move';
import { useMyProjectsOnly } from '../../lib/useMyProjectsOnly';
import { MyProjectsLine } from '../projects/MyProjectsLine';
import { isArchivedRefusal } from '../../stores/archived-notice-store';
import { READ_ONLY_NOTICE, type ProjectReadOnly } from '../../lib/project-archive';
import { TaskTable } from '../data-table/TaskTable';
import { VIEW_ICONS, ViewSwitch } from '../data-table/ViewSwitch';
import { useViewChoice } from '../data-table/hooks';

/** The board's columns and cards — and (1.23.0, for its Table view) the project's columns and tasks as the server sent them. */
type BoardData = { columns: KanbanColumnData[]; idByKey: Record<string, string>; apiColumns?: ApiColumn[]; tasks?: ApiTask[] };
type MoveVars = { id: string; toColumnId: string; taskKey: string; toIndex: number; orderedIds: string[] };

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.message ? e.message : fallback);
// Admin-triggered carry-forward runs at most once per app session (the server sweep handles the rest).
let carriedThisSession = false;
const NO_PROJECTS: ReadonlySet<string> = new Set();
const VIEWS = [
  { value: 'board' as const, label: 'Board', icon: VIEW_ICONS.board },
  { value: 'table' as const, label: 'Table', icon: VIEW_ICONS.table },
];

export interface BoardProps {
  /** The project whose board this is, or ALL_PROJECTS (every project's, under six statuses); undefined: none (yet). */
  projectId: string | undefined;
  /** The projects the board knows: the shown project among them, and All projects shows these (less `hiddenProjects`). */
  projects: ApiProject[];
  /** The page's list of projects (the Board page's): still loading, failed. Absent: the project is already there. */
  list?: { loading: boolean; failed: boolean; retry: () => void };
  /** The page is still fetching the project its link named: no other board flashes up meanwhile. */
  linking?: boolean;
  /** All projects: the projects the person left out. */
  hiddenProjects?: ReadonlySet<string>;
  /**
   * The page's own header (the Board page: its title and project picker), given the board's buttons
   * (Manage columns, New task) to place among its actions. Without one — a project page's Board tab,
   * under the project's own header — the buttons sit at the end of the board's day row.
   */
  header?: (actions: ReactNode) => ReactNode;
  /** This person was taken off the board's project (after the board has said so). */
  onRemoved?: () => void;
  /**
   * 1.22.3 review: the project takes no changes — archived (or all its companies), or completed; the
   * same rule as the project page's New task (lib/project-archive projectReadOnly). Its board is there
   * to look at: no New task, column "+", Manage columns, card menu or dragging, and it says why.
   */
  readOnly?: ProjectReadOnly | null;
  /**
   * 1.23.0: where Board | Table is remembered for the person — the Board page's own (the default), or a
   * project page's Board tab's ('project-board'); its table remembers its sort, filters and columns there too.
   */
  viewPlace?: 'board' | 'project-board';
}

/**
 * The Kanban board (1.22.3: one board for the Board page and a project page's Board tab): a project's
 * columns for a day — cards dragged between them, a task added to a column, a card opening in the
 * task panel (Previous / Next follow the columns), the people strip, column management, live
 * updates and the N shortcut — or, on the Board page, All projects under six shared statuses.
 */
export function Board({ projectId, projects, list, linking = false, hiddenProjects = NO_PROJECTS, header, onRemoved, readOnly = null, viewPlace = 'board' }: BoardProps) {
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  // A card's task opens in the app shell's task panel, through ?task= in the address (reload, Back, a shared link).
  const openTask = useOpenTask();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const [manageColumns, setManageColumns] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskColumn, setNewTaskColumn] = useState('');
  const [newTaskStatus, setNewTaskStatus] = useState<TaskCategory | undefined>(undefined);
  const [moveError, setMoveError] = useState(false);
  // 1.23.0: the board, or its day's tasks as a table (changed in place).
  const [view, setView] = useViewChoice(`${viewPlace}.view`, ['board', 'table'] as const, 'board');
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
  const myOnly = useMyProjectsOnly();
  const isAll = projectId === ALL_PROJECTS;
  const project = isAll ? undefined : projects.find((p) => p.id === projectId);
  // A read-only project's board (never All projects, whose projects are all open ones).
  const locked = !isAll && Boolean(projectId) && readOnly !== null;
  const shownProjects = useMemo(() => boardProjects(projects), [projects]);
  const listLoading = list?.loading ?? false;
  const removed = useRef(onRemoved);
  removed.current = onRemoved;

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
      return { columns: composeBoard(columns, tasks), idByKey: Object.fromEntries(tasks.map((t) => [t.key, t.id])), apiColumns: columns, tasks };
    },
  });

  const moveMut = useMutation({
    // Move to the column, then re-sequence it so the card stays where it was dropped.
    mutationFn: async ({ id, toColumnId, orderedIds }: MoveVars) => {
      const moved = await tasksApi(apiClient).move(id, toColumnId);
      // It went to wait for approval instead: no reorder of the column it never reached.
      if (orderedIds.length > 1 && moved.columnId === toColumnId) await tasksApi(apiClient).reorder(toColumnId, orderedIds);
      return moved;
    },
    // A task that needs approval, finished by someone who can't approve, waits (it snaps back to where it waits).
    onSuccess: (moved, vars) => {
      const waits = approvalNotice(vars.toColumnId, moved);
      if (waits) setNotice(waits);
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
        // An archived project's refusal is said across the page ("reopen it first"); trying again can't help.
        if (!isArchivedRefusal(e)) setMoveError(true);
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
    onError: (e, _vars, ctx) => {
      if (ctx?.prev && ctx.key) qc.setQueryData(ctx.key, ctx.prev); // the key captured at mutate time — not the board the user may have navigated to since
      if (!isArchivedRefusal(e)) setMoveError(true);
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
    onSuccess: (moved, vars) => {
      const waits = approvalNotice(vars.toColumnId, moved);
      if (waits) setNotice(waits);
    },
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
        if (!isArchivedRefusal(e)) setMoveError(true);
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
  // Only for someone who may move the task: others (members who don't manage it) see no ⋯ at all.
  const cardMenu = (key: string): CardMenuItem[] | null => {
    const ref = refByKey.get(key);
    if (!ref) return null;
    const name = projects.find((p) => p.id === ref.projectId)?.name;
    if (!moveAvailability(ref.projectId, moveTargets, name).canMove) return null;
    return [{ label: 'Move to another project…', onSelect: () => setMovingTask(ref) }];
  };

  /** Where keyboard focus goes once a moved card has left the board: the next card in its column (else the one before), else the board. */
  function focusAfterMove(movedKey: string) {
    const column = boardColumns.find((c) => c.tasks.some((t) => t.key === movedKey));
    const at = column ? column.tasks.findIndex((t) => t.key === movedKey) : -1;
    const neighbour = column ? (column.tasks[at + 1] ?? column.tasks[at - 1]) : undefined;
    return () => {
      const card = neighbour ? document.querySelector<HTMLElement>(`[data-card-key="${CSS.escape(neighbour.key)}"]`) : null;
      (card ?? document.querySelector<HTMLElement>('[role="region"][aria-label="Board columns"]'))?.focus();
    };
  }

  // Filter by external company: only the cards with a contact from it (in memory; the choices are the board's own).
  const [company, setCompany] = useState('');
  const fullColumns = isAll ? allColumns : boardQ.data?.columns ?? [];
  const companies = useMemo(() => boardCompanies(fullColumns), [fullColumns]);
  // The chosen company stays a choice on a day without it, so it can be seen (and cleared).
  const companyChoices = company && !companies.includes(company) ? [company, ...companies] : companies;
  const boardColumns = useMemo(() => filterBoardByCompany(fullColumns, company), [fullColumns, company]);
  const idByKey = useMemo(
    () => (isAll ? Object.fromEntries((allQ.data ?? []).map((t) => [t.key, t.id])) : boardQ.data?.idByKey ?? {}),
    [isAll, allQ.data, boardQ.data],
  );

  // The Table view's rows: the board's cards in its order, as the server sent them.
  const tableTasks = useMemo(() => {
    const raw = new Map((isAll ? allQ.data ?? [] : boardQ.data?.tasks ?? []).map((t) => [t.key, t]));
    return boardColumns.flatMap((c) => c.tasks.map((card) => raw.get(card.key)).filter((t): t is ApiTask => Boolean(t)));
  }, [isAll, allQ.data, boardQ.data, boardColumns]);

  /**
   * New task, in the column it was started from (a column's "+" or empty box), else the first. On
   * All projects, in that kind of column of whichever project is chosen in the form.
   */
  function openAddTask(columnId?: string) {
    if (isAll) setNewTaskStatus(columnId ? statusOfBoardColumn(columnId) ?? undefined : undefined);
    else setNewTaskColumn(columnId ?? boardColumns[0]?.id ?? '');
    setAddingTask(true);
  }
  useShortcut('new', () => openAddTask(), { enabled: boardColumns.length > 0 && !locked });

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
          setAddingTask(false);
          removed.current?.();
          // Close an open task with the board (and leave the project named in the address).
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.delete('task');
              next.delete('project');
              return next;
            },
            { replace: true },
          );
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
    [qc, projectId, project?.name, setSearchParams],
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
    // Filtered by company, the drop position is among the shown cards: place it in the whole column.
    const at = company ? fullColumnIndex(data.columns, boardColumns, toColumnId, toIndex, taskKey) : toIndex;
    const after = moveTaskInBoard(data.columns, taskKey, toColumnId, at);
    const orderedIds = (after.find((c) => c.id === toColumnId)?.tasks ?? [])
      .map((t) => data.idByKey[t.key])
      .filter((x): x is string => Boolean(x));
    moveMut.mutate({ id, toColumnId, taskKey, toIndex: at, orderedIds });
  }

  function onReorder(columnId: string, orderedKeys: string[]) {
    const orderedIds = orderedKeys.map((k) => boardQ.data?.idByKey[k]).filter((x): x is string => Boolean(x));
    if (orderedIds.length) reorderMut.mutate({ columnId, orderedIds, orderedKeys });
  }

  const loading = listLoading || linking || (Boolean(projectId) && (isAll ? allQ.isLoading : boardQ.isLoading));
  const error = (list?.failed ?? false) || (isAll ? allQ.isError : boardQ.isError);
  // A day with nothing on it says so once, above the columns (each column only says "No tasks").
  // (Not on a read-only board: its notice says why nothing can be added.)
  const emptyDay = !locked && !loading && !error && Boolean(projectId) && fullColumns.length > 0 && fullColumns.every((c) => c.tasks.length === 0);
  // The company filter leaves no card on a board that has some.
  const noneFromCompany = !emptyDay && Boolean(company) && boardColumns.length > 0 && boardColumns.every((c) => c.tasks.length === 0);

  // A laptop, or a tablet with room: the board is the rest of the window's height and each column
  // scrolls by itself, its header always in view. A phone scrolls the page. So does the page while
  // columns are being managed: that list sits above the board and can be long.
  // (The table scrolls in its own box: the page scrolls as on a phone.)
  const fit = useMediaQuery(BOARD_FIT_QUERY) && !manageColumns && view === 'board';
  const pageRef = useRef<HTMLDivElement>(null);
  const pageTop = useFrameOffset(pageRef, fit);

  // The board's own buttons: in the page's header, or (no header: a project page's Board tab) in the day row.
  // A read-only project's board has none.
  const actions = projectId && !locked ? (
    <>
      {/* Whoever runs the project (the server says) and admins change its columns. */}
      {(isAdmin || project?.canManage === true) && !isAll ? (
        <button
          onClick={() => setManageColumns((v) => !v)}
          aria-expanded={manageColumns}
          className={`rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand/30 hover:bg-ground ${TOUCH_TALL}`}
        >
          {manageColumns ? 'Done' : 'Manage columns'}
        </button>
      ) : null}
      <Button onClick={() => openAddTask()} disabled={boardColumns.length === 0} title="New task" shortcut="new" className={TOUCH_TALL}>
        + New task
      </Button>
    </>
  ) : null;

  return (
    <div
      ref={pageRef}
      className={fit ? 'page-fill flex flex-col' : undefined}
      style={fit && pageTop !== null ? ({ '--page-top': `${pageTop}px` } as CSSProperties) : undefined}
    >
      {header?.(actions)}

      {listLoading ? (
        <div className="mb-4 flex h-9 items-center [@media(pointer:coarse)]:h-[2.875rem]" aria-hidden="true">
          <span className="skeleton block h-full w-64 rounded-xl" />
        </div>
      ) : projectId ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-xl border border-line bg-surface p-0.5 [@media(pointer:coarse)]:p-0">
            <button
              onClick={() => setSelectedDate(shiftKey(boardDate, -1))}
              aria-label="Previous day"
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <input
              type="date"
              aria-label="Board date"
              value={boardDate}
              onChange={(e) => setSelectedDate(e.target.value || null)}
              className="border-0 bg-transparent px-1 text-sm text-ink outline-none [@media(pointer:coarse)]:h-11"
            />
            <button
              onClick={() => setSelectedDate(shiftKey(boardDate, 1))}
              aria-label="Next day"
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
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
              className={`rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-brand/30 hover:bg-ground ${TOUCH_TALL}`}
            >
              Jump to today
            </button>
          ) : null}
          <ViewSwitch label="Show the board as" value={view} onChange={setView} options={VIEWS} />
          {companies.length > 0 || company ? (
            <div className="w-48" title={company || EXTERNAL_CONTACT_WORDS.anyCompany}>
              <SearchableSelect
                ariaLabel={`Filter by ${EXTERNAL_CONTACT_WORDS.filter.toLowerCase()}`}
                value={company}
                onChange={setCompany}
                options={[{ value: '', label: `${EXTERNAL_CONTACT_WORDS.filter}: ${EXTERNAL_CONTACT_WORDS.anyCompany}` }, ...companyChoices.map((c) => ({ value: c, label: c }))]}
              />
            </div>
          ) : null}
          {isAll && myOnly ? <MyProjectsLine /> : null}
          {isAll ? <p className="ms-auto hidden text-sm text-ink-2 lg:block">All projects — drag a card to change its status in its own project.</p> : null}
          {/* 1.22: who can open this project's board (not on All projects). */}
          {!isAll && project ? <div className="ms-auto"><BoardPeople project={project} /></div> : null}
          {header ? null : <div className={`flex flex-wrap items-center gap-2 ${!isAll && project ? '' : 'ms-auto'}`}>{actions}</div>}
        </div>
      ) : null}

      {manageColumns && projectId && !isAll && !locked ? (
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

      {locked && readOnly ? (
        <p role="status" data-read-only={readOnly} className="mb-3 flex flex-none items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-2">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-ink-3">
            <rect x="3" y="4" width="18" height="5" rx="1" />
            <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
          </svg>
          <span>{READ_ONLY_NOTICE[readOnly]}</span>
        </p>
      ) : null}

      {moveError ? (
        <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          Couldn’t move that task — it was put back. Please try again.
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className={`flex-none text-xs font-semibold underline ${TOUCH_TALL}`}>Dismiss</button>
        </p>
      ) : null}

      {loading ? (
        <BoardSkeleton fit={fit} />
      ) : error ? (
        <LoadError what="the board" onRetry={() => { list?.retry(); void (isAll ? allQ.refetch() : boardQ.refetch()); }} />
      ) : !projectId ? (
        <EmptyState
          title="No projects yet"
          description="Create a project to get started: its board shows here."
          action={<Button onClick={() => navigate('/projects?new=1')} className={TOUCH_TALL}>+ New project</Button>}
        />
      ) : (
        <div className={fit ? 'flex min-h-0 flex-1 flex-col' : undefined}>
        {emptyDay ? (
          <p role="status" className="mb-3 flex flex-none items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-2">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 flex-none text-ink-3"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
            <span>{emptyDayText(boardDate, todayKey)}</span>
          </p>
        ) : null}
        {noneFromCompany ? (
          <p role="status" className="mb-3 flex flex-none items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-2">
            <span dir="auto">No cards on this board have an external contact from {company}.</span>
            <button type="button" onClick={() => setCompany('')} className={`flex-none text-xs font-semibold text-brand underline ${TOUCH_TALL}`}>
              Show every card
            </button>
          </p>
        ) : null}
        {view === 'table' ? (
          // The day's cards as rows, column by column (the board's order), the company filter applied.
          <TaskTable
            page={viewPlace}
            label={isAll ? `All projects on ${formatKeyLabel(boardDate)}` : `${project?.name ?? 'Board'} on ${formatKeyLabel(boardDate)}`}
            tasks={tableTasks}
            projects={isAll ? shownProjects : projects}
            columns={isAll ? undefined : boardQ.data?.apiColumns}
            showProject={isAll}
            readOnly={locked ? readOnly : null}
            filterBar
            onOpen={(id, ids) => openTask(id, ids)}
            empty={<span />}
          />
        ) : (
        <div className={fit ? 'min-h-0 flex-1' : undefined}>
        <KanbanBoard
          fit={fit}
          columns={boardColumns}
          timeZone={timeZone}
          // A read-only project's board: cards only open (no dragging, no "+", no card menu).
          onMove={locked ? undefined : onMove}
          // On All projects a status mixes projects: cards keep their order (due date, then priority).
          // Filtered by company, some cards are hidden: a column's order can't be set from what is shown.
          onReorder={isAll || company || locked ? undefined : onReorder}
          onAddTask={locked ? undefined : (columnId) => openAddTask(columnId)}
          cardMenu={locked ? undefined : cardMenu}
          onTaskClick={(key) => {
            const id = idByKey[key];
            // The board as shown is its list for Previous / Next: column by column, top to bottom.
            if (id) openTask(id, boardColumns.flatMap((c) => c.tasks.map((t) => idByKey[t.key]).filter((x): x is string => Boolean(x))));
          }}
        />
        </div>
        )}
        </div>
      )}


      {movingTask ? (
        <MoveTaskDialog
          tasks={[movingTask]}
          onClose={() => setMovingTask(null)}
          onMoved={(result) => {
            const refocus = focusAfterMove(movingTask.key);
            setMovingTask(null);
            setMovedToast(movedText(result));
            // Off this board, onto the other project's (live boards elsewhere hear it too). Its card —
            // and the ⋯ button focus went back to — leaves: focus moves on to its neighbour.
            void invalidateTaskQueries(qc).then(() => setTimeout(refocus, 0));
          }}
        />
      ) : null}
      {movedToast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <p role="status" className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink shadow-lift">
            <span>{movedToast}</span>
            <button type="button" onClick={() => setMovedToast(null)} aria-label="Dismiss" className={`text-ink-2 hover:text-ink ${TOUCH_SQUARE}`}>
              ✕
            </button>
          </p>
        </div>
      ) : null}

      {addingTask && projectId && !locked ? (
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

/** What a board day with no tasks on it says: why it may be empty, and what to do. */
export function emptyDayText(day: string, today: string): string {
  if (day === today) return 'Nothing on today’s board yet. Add a task with “New task” or a column’s +.';
  if (day > today) return 'Nothing planned for this day yet. A task added here waits on this day’s board.';
  return 'Nothing was on the board this day. Tasks still open move on to the next day by themselves.';
}

/** The board's place while it loads: columns of card-shaped placeholders, as tall as the board's lanes. */
function BoardSkeleton({ fit }: { fit: boolean }) {
  return (
    <div role="status" aria-label="Loading the board" className={`flex gap-3 overflow-hidden pb-3 ${fit ? 'min-h-0 flex-1' : 'h-[calc(100dvh-12rem)] min-h-[20rem]'}`}>
      {[3, 2, 2, 1].map((cards, i) => (
        <div key={i} className="flex min-w-[15rem] flex-1 basis-0 flex-col gap-2.5 rounded-2xl border border-line bg-surface/70 p-2.5" aria-hidden="true">
          <span className="skeleton block h-5 w-28" />
          {Array.from({ length: cards }).map((_, j) => (
            <span key={j} className="skeleton block h-24 rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  );
}
