import { ConflictError, ForbiddenError, HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { dueDateOnEntry } from '../projects/project-task-settings';
import { boardDateFromKey, boardDateKey } from './board-date';
import { columnEntryChange, defaultCompanyTimeZone } from './task-status';
import { TaskKeyConflictError, type TaskRecord } from './task-repository';
import { TaskMovedConflictError, type MovableTask, type MoveColumn, type MovePerson, type MoveProject, type ProjectMoveWrite, type TaskMoveRepository } from './task-move-repository';
import { matchingColumn, notOnTeamMessage } from './task-move';

/** What happens to people assigned to a task who aren't on the new project's team. */
export type AssigneeChoice = 'ADD_TO_TEAM' | 'UNASSIGN';

/** Who is moving tasks. */
export interface MoveActor {
  id: string;
  roles?: string[];
}

export interface MoveInput {
  projectId: string;
  /** A column of the new project. Left out: each task goes to the same kind of column as now, else the first. */
  columnId?: string;
  /** Required when someone assigned isn't on the new project's team. */
  assignees?: AssigneeChoice;
}

export type MoveProjectSummary = Pick<MoveProject, 'id' | 'code' | 'name' | 'status' | 'color' | 'icon' | 'imageUrl'>;

/** Where someone may move tasks, and whose tasks. */
export interface MoveTargets {
  /** An administrator: any task, to any open project. */
  managesAll: boolean;
  /** The projects whose tasks they may move out (the ones they manage, whatever their status). */
  managedProjectIds: string[];
  /** The open projects they may move tasks into. */
  projects: MoveProjectSummary[];
}

/** What moving one task would change. */
export interface TaskMovePreview {
  id: string;
  key: string;
  title: string;
  from: { id: string; code: string; name: string } | null;
  canMove: boolean;
  /** Why it can't be moved, in words (null when it can). */
  reason: string | null;
  /**
   * The key it would get ("OPS-17"): the new project's next number now, in order for several tasks.
   * A task created there at the same moment can take a number; the move then takes the next one.
   */
  newKey: string | null;
  /** The stage (column category) it is in now: when `columnId` is of another kind, the new project has none of this one. */
  currentCategory: string | null;
  /** Where it goes unless another column is chosen: the same kind of column as now, else the first. */
  columnId: string | null;
  /** It is a milestone, and milestones belong to their project: moving clears it. */
  milestoneCleared: boolean;
  /** The due day it gets ('YYYY-MM-DD') by the new project's "New tasks are due today"; null if none. */
  dueDate: string | null;
  /** SERIES: the newest copy of a repeating task, whose later copies are made in the new project. COPY: an earlier copy, moving alone. */
  repeat: 'SERIES' | 'COPY' | null;
  /** People assigned to it who aren't on the new project's team. */
  outsiders: MovePerson[];
}

export interface MovePreview {
  project: MoveProjectSummary & { defaultDueToday: boolean };
  /** The new project's board columns (switched-on ones, in board order). */
  columns: MoveColumn[];
  tasks: TaskMovePreview[];
  /** Everyone assigned to the tasks that can move who isn't on the new team, once each. */
  outsiders: MovePerson[];
}

export interface MoveResult {
  /** The task as it is now: its new key, project and column. */
  task: TaskRecord;
  from: { projectId: string; name: string; key: string };
  to: { projectId: string; name: string; key: string };
  addedToTeam: MovePerson[];
  unassigned: MovePerson[];
  milestoneCleared: boolean;
  /** The due day the move gave it ('YYYY-MM-DD'), or null. */
  dueDateSet: string | null;
}

export type BulkMoveItem =
  | ({ taskId: string; ok: true } & MoveResult)
  | { taskId: string; ok: false; error: { code: string; message: string; details?: unknown } };

export interface BulkMoveResult {
  /** One per task asked for, in the order asked. */
  results: BulkMoveItem[];
  moved: number;
  failed: number;
}

export interface TaskMoveServiceDeps {
  repo: TaskMoveRepository;
  /** Company time zone: "today" for due dates and board days. */
  timeZone?: string;
  now?: () => Date;
  /** How far a task's checklist is (0-100): the progress a re-opened task goes back to. */
  checklistPercent?: (taskId: string) => Promise<number>;
  /** After each move: notifications (live boards are told by the routes). */
  onMoved?: (move: MoveResult & { actorId: string }) => void | Promise<void>;
  /** After a move that completed or re-opened the task: what a status change does (next repeat copy, action items, timeline). */
  onStatusChanged?: (task: TaskRecord, prevColumnId: string, actorId: string) => void | Promise<void>;
  /** A failure after a task already moved (a hook), or an unexpected one while moving several. */
  onError?: (err: unknown, taskId: string) => void;
}

/** How many consecutive numbers to try when other tasks take them at the same moment. */
const KEY_ATTEMPTS = 5;
const CLOSED: Record<string, string> = { COMPLETED: 'completed', ARCHIVED: 'archived' };

/** A refusal of one task (not of the whole request), with the preview's shorter wording. */
class TaskRefusal extends HttpError {
  readonly short: string;
  constructor(message: string, code: string, status: number, short?: string, details?: unknown) {
    super(message, code, status, details);
    this.short = short ?? message;
  }
}

const summary = (p: MoveProject): MoveProjectSummary => ({ id: p.id, code: p.code, name: p.name, status: p.status, color: p.color, icon: p.icon, imageUrl: p.imageUrl });
const unique = (ids: string[]) => [...new Set(ids)];
/** A stored due date (UTC midnight of its day) as 'YYYY-MM-DD'. */
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Moving tasks to another project (the website's "Move to another project…"). Administrators may
 * move any task; anyone else needs to manage both projects (a MANAGER member of each, as for deleting
 * tasks). Only into an open project: not completed or archived, and not the one it is in.
 *
 * A moved task gets the new project's next number (OPS-17); its old key (RIG-4) is kept as an alias so
 * search and "open RIG-4" still find it, and no task is ever given that number again. It goes to the
 * same kind of column as now unless another is chosen; its milestone is cleared (milestones belong to
 * their project); an undated task gets today where new tasks are due today (dueDateOnEntry); its board
 * day stays. People assigned who aren't on the new team are added to it or taken off the task — the
 * mover chooses, and a move with such people and no choice is refused. Comments, files, checklist,
 * history, watchers, blockers and the meeting link are the task's, so they go along. The newest copy
 * of a repeating task takes its series along (copies are made from it, in its project).
 */
export function createTaskMoveService(deps: TaskMoveServiceDeps) {
  const { repo, now = () => new Date(), timeZone = defaultCompanyTimeZone() } = deps;
  const isAdmin = (actor: MoveActor) => (actor.roles ?? []).includes('ADMIN');

  /** The projects the actor manages, or null for an administrator (every project). */
  async function scopeOf(actor: MoveActor): Promise<Set<string> | null> {
    return isAdmin(actor) ? null : new Set(await repo.managedProjectIds(actor.id));
  }
  const manages = (scope: Set<string> | null, projectId: string) => scope === null || scope.has(projectId);
  /** Reads each project once for one request, however many of its tasks are in it. */
  type FindProject = (id: string) => Promise<MoveProject | null>;
  const projectReader = (): FindProject => {
    const seen = new Map<string, Promise<MoveProject | null>>();
    return (id) => {
      let found = seen.get(id);
      if (!found) seen.set(id, (found = repo.findProject(id)));
      return found;
    };
  };

  async function targets(actor: MoveActor): Promise<MoveTargets> {
    const scope = await scopeOf(actor);
    const open = await repo.listOpenProjects();
    return { managesAll: scope === null, managedProjectIds: scope ? [...scope] : [], projects: open.filter((p) => manages(scope, p.id)).map(summary) };
  }

  /** The actor may move tasks into `to`, and it is open. */
  function assertDestination(scope: Set<string> | null, to: MoveProject): void {
    if (!manages(scope, to.id)) throw new ForbiddenError(`You need to manage ${to.name} to move tasks into it.`);
    const closed = CLOSED[to.status];
    if (closed) throw new HttpError(`${to.name} is ${closed}. Tasks can only be moved to open projects.`, 'PROJECT_CLOSED', 400);
  }
  async function destination(scope: Set<string> | null, projectId: string, find: FindProject): Promise<MoveProject> {
    const to = await find(projectId);
    if (!to) throw new NotFoundError('Project not found.');
    assertDestination(scope, to);
    return to;
  }

  /** The task's own refusals: it is already there, or the actor may not move tasks out of its project. */
  async function source(scope: Set<string> | null, task: MovableTask, to: MoveProject, find: FindProject): Promise<MoveProject> {
    if (task.projectId === to.id) throw new TaskRefusal(`This task is already in ${to.name}.`, 'SAME_PROJECT', 400, `Already in ${to.name}.`);
    const from = await find(task.projectId);
    if (!from) throw new NotFoundError('Task not found.');
    if (!manages(scope, from.id)) throw new TaskRefusal(`You need to manage ${from.name} to move its tasks.`, 'FORBIDDEN', 403);
    return from;
  }

  function columnFor(columns: MoveColumn[], to: MoveProject, task: MovableTask, columnId?: string): MoveColumn {
    if (columnId) {
      const chosen = columns.find((c) => c.id === columnId);
      if (!chosen) throw new ValidationError(`That column isn’t on the ${to.name} board.`);
      return chosen;
    }
    const column = matchingColumn(columns, task.columnCategory);
    if (!column) throw new HttpError(`${to.name} has no columns to move tasks into.`, 'NO_COLUMNS', 400);
    return column;
  }

  async function outsidersOf(task: MovableTask, to: MoveProject): Promise<MovePerson[]> {
    if (task.assignees.length === 0) return [];
    const team = new Set(await repo.teamIds(to.id, task.assignees.map((p) => p.id)));
    return task.assignees.filter((p) => !team.has(p.id));
  }

  /** The due date entering `to` gives the task, or null (it keeps the one it has, or stays undated). */
  function dueOnEntry(task: MovableTask, to: MoveProject): Date | null {
    if (task.dueDate) return null;
    return dueDateOnEntry({ dueDate: null, startDate: task.startDate, boardDate: task.boardDate }, to, timeZone, now()) ?? null;
  }

  const repeatOf = (task: MovableTask): TaskMovePreview['repeat'] => (task.repeats ? 'SERIES' : task.inSeries ? 'COPY' : null);

  async function preview(actor: MoveActor, taskIds: string[], projectId: string): Promise<MovePreview> {
    const scope = await scopeOf(actor);
    const find = projectReader();
    const to = await destination(scope, projectId, find);
    const ids = unique(taskIds);
    const [found, columns, next] = await Promise.all([repo.findTasks(ids), repo.listColumns(to.id), repo.nextKeyNumber(to.id)]);
    const byId = new Map(found.map((t) => [t.id, t]));
    const tasks: TaskMovePreview[] = [];
    const outsiders = new Map<string, MovePerson>();
    let numbered = 0;
    for (const id of ids) {
      const task = byId.get(id);
      const base = { id, key: task?.key ?? '', title: task?.title ?? '', from: null, newKey: null, currentCategory: task?.columnCategory ?? null, columnId: null, milestoneCleared: false, dueDate: null, repeat: null, outsiders: [] };
      if (!task) {
        tasks.push({ ...base, canMove: false, reason: 'Task not found.' });
        continue;
      }
      try {
        const from = await source(scope, task, to, find);
        const column = columnFor(columns, to, task);
        const people = await outsidersOf(task, to);
        for (const p of people) outsiders.set(p.id, p);
        const due = dueOnEntry(task, to);
        tasks.push({
          ...base,
          from: { id: from.id, code: from.code, name: from.name },
          canMove: true,
          reason: null,
          newKey: `${to.code}-${next + numbered++}`,
          columnId: column.id,
          milestoneCleared: task.isMilestone,
          dueDate: due ? dayOf(due) : null,
          repeat: repeatOf(task),
          outsiders: people,
        });
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        tasks.push({ ...base, canMove: false, reason: err instanceof TaskRefusal ? err.short : err.message });
      }
    }
    const shown = columns.filter((c) => c.enabled).sort((a, b) => a.position - b.position);
    return { project: { ...summary(to), defaultDueToday: to.defaultDueToday }, columns: shown, tasks, outsiders: [...outsiders.values()] };
  }

  /** Move one task into `to` (already checked as a destination), given the columns of `to`. */
  async function moveOne(actor: MoveActor, scope: Set<string> | null, taskId: string, to: MoveProject, columns: MoveColumn[], input: MoveInput, find: FindProject): Promise<MoveResult> {
    const [task] = await repo.findTasks([taskId]);
    if (!task) throw new NotFoundError('Task not found.');
    const from = await source(scope, task, to, find);
    const column = columnFor(columns, to, task, input.columnId);
    const outsiders = await outsidersOf(task, to);
    if (outsiders.length > 0 && !input.assignees) {
      throw new TaskRefusal(notOnTeamMessage(outsiders, to.name), 'ASSIGNEES_NOT_ON_TEAM', 409, undefined, { people: outsiders });
    }
    const addedToTeam = input.assignees === 'ADD_TO_TEAM' ? outsiders : [];
    const unassigned = input.assignees === 'UNASSIGN' ? outsiders : [];

    const at = now();
    const due = dueOnEntry(task, to);
    const dueDateSet = due ? dayOf(due) : null;
    const patch: ProjectMoveWrite['patch'] = {
      ...(task.isMilestone ? { isMilestone: false } : {}),
      ...(due ? { dueDate: due } : {}),
      // Completion follows the column, as when a card is moved between columns.
      ...(await columnEntryChange(task, column.category, { at, todayAnchor: boardDateFromKey(boardDateKey(at, timeZone)), reopenedProgress: deps.checklistPercent })),
    };

    // A task created or moved into the project at the same moment can take the number: each try
    // reads the next one afresh.
    let moved: TaskRecord | null = null;
    for (let attempt = 0; !moved; attempt++) {
      try {
        moved = await repo.move({
          taskId,
          from: { projectId: from.id, name: from.name, key: task.key },
          to: { projectId: to.id, name: to.name, code: to.code },
          columnId: column.id,
          patch,
          addToTeam: addedToTeam.map((p) => p.id),
          unassign: unassigned,
          actorId: actor.id,
          dueDateSet,
        });
      } catch (err) {
        if (err instanceof TaskMovedConflictError) throw new ConflictError('Someone else moved this task just now. Reload it and try again.', 'TASK_MOVED');
        if (!(err instanceof TaskKeyConflictError)) throw err;
        if (attempt >= KEY_ATTEMPTS - 1) throw new ConflictError('Another task took that number at the same moment. Please try again.', 'TASK_KEY_CONFLICT');
      }
    }

    const result: MoveResult = {
      task: moved,
      from: { projectId: from.id, name: from.name, key: task.key },
      to: { projectId: to.id, name: to.name, key: moved.key },
      addedToTeam,
      unassigned,
      milestoneCleared: task.isMilestone,
      dueDateSet,
    };
    // The move is saved: what follows it never turns it into a failure.
    try {
      if ((task.completedAt !== null) !== (moved.completedAt !== null)) await deps.onStatusChanged?.(moved, task.columnId, actor.id);
      await deps.onMoved?.({ ...result, actorId: actor.id });
    } catch (err) {
      deps.onError?.(err, taskId);
    }
    return result;
  }

  async function moveTask(actor: MoveActor, taskId: string, input: MoveInput): Promise<MoveResult> {
    const scope = await scopeOf(actor);
    const find = projectReader();
    const [task] = await repo.findTasks([taskId]);
    if (!task) throw new NotFoundError('Task not found.');
    const to = await find(input.projectId);
    if (!to) throw new NotFoundError('Project not found.');
    // The task's own refusals first (already there, not yours to move), then the destination's.
    await source(scope, task, to, find);
    assertDestination(scope, to);
    return moveOne(actor, scope, taskId, to, await repo.listColumns(to.id), input, find);
  }

  async function moveTasks(actor: MoveActor, taskIds: string[], input: MoveInput): Promise<BulkMoveResult> {
    const scope = await scopeOf(actor);
    const find = projectReader();
    const to = await destination(scope, input.projectId, find);
    const columns = await repo.listColumns(to.id);
    if (input.columnId && !columns.some((c) => c.id === input.columnId)) throw new ValidationError(`That column isn’t on the ${to.name} board.`);
    const results: BulkMoveItem[] = [];
    for (const taskId of unique(taskIds)) {
      try {
        results.push({ taskId, ok: true, ...(await moveOne(actor, scope, taskId, to, columns, input, find)) });
      } catch (err) {
        if (!(err instanceof HttpError)) deps.onError?.(err, taskId);
        const error =
          err instanceof HttpError
            ? { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) }
            : { code: 'INTERNAL', message: 'Something went wrong moving this task.' };
        results.push({ taskId, ok: false, error });
      }
    }
    const moved = results.filter((r) => r.ok).length;
    return { results, moved, failed: results.length - moved };
  }

  return { targets, preview, moveTask, moveTasks };
}

export type TaskMoveService = ReturnType<typeof createTaskMoveService>;
