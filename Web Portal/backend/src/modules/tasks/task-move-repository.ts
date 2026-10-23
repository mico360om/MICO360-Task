import type { TaskRecord } from './task-repository';

/** A project as moving a task needs it: where it may go, its key code and its "due today" setting. */
export interface MoveProject {
  id: string;
  code: string;
  name: string;
  status: string;
  /** "New tasks are due today": an undated task moved in gets today's date (dueDateOnEntry). */
  defaultDueToday: boolean;
  color: string | null;
  icon: string | null;
  imageUrl: string | null;
}

/** One of a project's board columns. */
export interface MoveColumn {
  id: string;
  name: string;
  category: string;
  position: number;
  enabled: boolean;
}

/** Someone named in a move: an assignee who isn't on the new team, added to it or taken off the task. */
export interface MovePerson {
  id: string;
  name: string;
}

/** A task as a move reads it (live tasks of live projects only). */
export interface MovableTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  columnId: string;
  columnCategory: string | null;
  isMilestone: boolean;
  dueDate: Date | null;
  startDate: Date | null;
  boardDate: Date | null;
  completedAt: Date | null;
  /** Its version when read: the move is saved only if nobody changed it since. */
  version: number;
  /** Carries the repeat rule: the newest copy of its series, whose next copies follow it. */
  repeats: boolean;
  /** One of the copies of a repeating series (the newest or an earlier one). */
  inSeries: boolean;
  assignees: MovePerson[];
}

/** What a move writes, in one transaction. */
export interface ProjectMoveWrite {
  taskId: string;
  /** Its title, for the line the old project keeps ("moved RIG-4 to Operations (OPS-17)"). */
  title: string;
  /** The version it was read at: TaskChangedConflictError when it changed since. */
  version: number;
  /** Where the task is now: the move is refused (TaskMovedConflictError) if it has left it meanwhile. */
  from: { projectId: string; name: string; key: string };
  /** The new key is `code` and the project's next number, read in the move's own transaction. */
  to: { projectId: string; name: string; code: string };
  columnId: string;
  /** Field changes that go with the move: milestone cleared, due date set, completion following the column. */
  patch: { isMilestone?: boolean; dueDate?: Date; completedAt?: Date | null; progress?: number; boardDate?: Date };
  /** People added to the new project's team (as members). */
  addToTeam: string[];
  /** Assignees taken off the task (each gets an UNASSIGNED line). */
  unassign: MovePerson[];
  /** Who moved it (the activity lines are theirs). */
  actorId: string;
  /** The due day the move gave the task ('YYYY-MM-DD'), for its activity line. */
  dueDateSet?: string | null;
}

/** The task changed after it was read (an edit, or completed or re-opened): nothing was saved. */
export class TaskChangedConflictError extends Error {
  constructor(id: string) {
    super(`Task ${id} changed while it was being moved.`);
    this.name = 'TaskChangedConflictError';
  }
}

/** The task left the project it was read from before this move could be saved (another move won). */
export class TaskMovedConflictError extends Error {
  constructor(id: string) {
    super(`Task ${id} was moved by someone else.`);
    this.name = 'TaskMovedConflictError';
  }
}

export interface TaskMoveRepository {
  /** The live tasks among `ids` (in live projects), with their assignees. */
  findTasks(ids: string[]): Promise<MovableTask[]>;
  /** A live project, or null. */
  findProject(id: string): Promise<MoveProject | null>;
  /** Live projects that aren't completed or archived: where tasks may be moved to. */
  listOpenProjects(): Promise<MoveProject[]>;
  /** Projects the user manages (a MANAGER member — the same rule as ProjectAuthz). */
  managedProjectIds(userId: string): Promise<string[]>;
  listColumns(projectId: string): Promise<MoveColumn[]>;
  /** Of `userIds`, those on the project's team: its owner, manager, creator and members — and admins. */
  teamIds(projectId: string, userIds: string[]): Promise<string[]>;
  /** The number the project's next key gets: the highest it has used (old keys included) + 1. */
  nextKeyNumber(projectId: string): Promise<number>;
  /**
   * Move the task in one transaction: the new key, project, column and fields; the old key kept as an
   * alias; people added to the team or taken off; its history filed under the new project, with the
   * lines of task-move-history (the old project keeps one saying where it went).
   * TaskKeyConflictError when another task took the new key at the same moment (a new try reads the
   * next number afresh), TaskMovedConflictError when the task is no longer in `from`, and
   * TaskChangedConflictError when it changed since it was read. Resolves the task as it is now.
   */
  move(write: ProjectMoveWrite): Promise<TaskRecord>;
}
