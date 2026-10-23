import { TaskKeyConflictError, type TaskRecord } from './task-repository';
import { TaskChangedConflictError, TaskMovedConflictError, type MoveColumn, type MovePerson, type MoveProject, type ProjectMoveWrite, type TaskMoveRepository } from './task-move-repository';
import { moveHistory } from './task-move-history';
import { highestKeyNumberIn } from './task-keys';

/** A task held by the in-memory repository: the record plus what a move reads. */
export interface MemoryMoveTask extends TaskRecord {
  assigneeList: MovePerson[];
  repeats?: boolean;
}

export interface MemoryMoveState {
  projects: MoveProject[];
  columns: (MoveColumn & { projectId: string })[];
  tasks: MemoryMoveTask[];
  /** Old keys: key → { taskId, projectId }. */
  aliases: Map<string, { taskId: string; projectId: string }>;
  /** projectId → user ids on its team (owner, manager, creator, members). */
  teams: Map<string, Set<string>>;
  /** userId → project ids they manage. */
  managers: Map<string, Set<string>>;
  admins: Set<string>;
  /** Activity lines written by moves. */
  activity: { taskId: string | null; projectId: string; userId: string; action: string; meta: Record<string, unknown> }[];
}

/**
 * An in-memory TaskMoveRepository for unit tests, with the database's rules: keys are unique across
 * tasks and old keys; the next number follows the highest one the project used (old keys included);
 * a move only saves when the task is still where, and as, it was read; and it writes the same history,
 * in the same order (task-move-history).
 */
export function createMemoryTaskMoveRepository(state: MemoryMoveState): TaskMoveRepository & { state: MemoryMoveState } {
  const live = (id: string) => state.projects.find((p) => p.id === id) ?? null;
  const keyTaken = (key: string) => state.tasks.some((t) => t.key === key) || state.aliases.has(key);
  const nextKeyNumber = (projectId: string) =>
    highestKeyNumberIn([...state.tasks.filter((t) => t.projectId === projectId).map((t) => t.key), ...[...state.aliases].filter(([, a]) => a.projectId === projectId).map(([k]) => k)]) + 1;
  return {
    state,
    async findTasks(ids) {
      return state.tasks
        .filter((t) => ids.includes(t.id) && live(t.projectId))
        .map((t) => ({
          id: t.id,
          key: t.key,
          title: t.title,
          projectId: t.projectId,
          columnId: t.columnId,
          columnCategory: state.columns.find((c) => c.id === t.columnId)?.category ?? null,
          isMilestone: t.isMilestone ?? false,
          dueDate: t.dueDate,
          startDate: t.startDate,
          boardDate: t.boardDate,
          completedAt: t.completedAt,
          version: t.version,
          repeats: Boolean(t.repeats ?? t.recurrenceRule),
          inSeries: Boolean(t.recurrenceRule || t.recurrenceParentId),
          assignees: t.assigneeList,
        }));
    },
    async findProject(id) {
      return live(id);
    },
    async listOpenProjects() {
      return state.projects.filter((p) => p.status !== 'COMPLETED' && p.status !== 'ARCHIVED');
    },
    async managedProjectIds(userId) {
      return [...(state.managers.get(userId) ?? [])];
    },
    async listColumns(projectId) {
      return state.columns.filter((c) => c.projectId === projectId).map(({ projectId: _p, ...c }) => c);
    },
    async teamIds(projectId, userIds) {
      const team = state.teams.get(projectId) ?? new Set();
      return userIds.filter((id) => team.has(id) || state.admins.has(id));
    },
    async nextKeyNumber(projectId) {
      return nextKeyNumber(projectId);
    },
    async move(w: ProjectMoveWrite) {
      const task = state.tasks.find((t) => t.id === w.taskId);
      if (!task || task.projectId !== w.from.projectId) throw new TaskMovedConflictError(w.taskId);
      if (task.version !== w.version) throw new TaskChangedConflictError(w.taskId);
      const key = `${w.to.code}-${nextKeyNumber(w.to.projectId)}`;
      if (keyTaken(key)) throw new TaskKeyConflictError(key);
      state.aliases.set(w.from.key, { taskId: task.id, projectId: w.from.projectId });
      const inColumn = state.tasks.filter((t) => t.columnId === w.columnId);
      Object.assign(task, w.patch, {
        key,
        projectId: w.to.projectId,
        columnId: w.columnId,
        columnCategory: state.columns.find((c) => c.id === w.columnId)?.category ?? null,
        position: inColumn.length ? Math.max(...inColumn.map((t) => t.position)) + 1 : 0,
        version: task.version + 1,
      });
      const team = state.teams.get(w.to.projectId) ?? new Set<string>();
      for (const id of w.addToTeam) team.add(id);
      state.teams.set(w.to.projectId, team);
      const off = new Set(w.unassign.map((p) => p.id));
      task.assigneeList = task.assigneeList.filter((p) => !off.has(p.id));
      for (const line of state.activity) if (line.taskId === task.id) line.projectId = w.to.projectId;
      for (const line of moveHistory(w, key)) state.activity.push({ ...line, userId: w.actorId });
      const formerKeys = [...state.aliases.entries()].filter(([, a]) => a.taskId === task.id).map(([k]) => k);
      const record = Object.fromEntries(Object.entries(task).filter(([k]) => k !== 'assigneeList' && k !== 'repeats')) as unknown as TaskRecord;
      return { ...record, formerKeys, assignees: task.assigneeList.map((p) => ({ ...p })) };
    },
  };
}
