export interface AssigneeUser {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface AssigneeRepository {
  add(taskId: string, userId: string): Promise<void>;
  remove(taskId: string, userId: string): Promise<void>;
  list(taskId: string): Promise<AssigneeUser[]>;
  /**
   * The subset of `userIds` that may be assigned work in the project: active users who can see
   * it (members, owner, manager, creator, or admins). When absent, assignees aren't checked.
   */
  eligibleUserIds?(projectId: string, userIds: string[]): Promise<string[]>;
  /** The project of a live task (used to check assignees against it). */
  projectIdOfTask?(taskId: string): Promise<string | null>;
  /**
   * Takes one person off a task and puts another on, in one write. N12: in one step with the task's
   * version — refused (VERSION_CONFLICT) when `expectedVersion` is given and no longer current, or
   * (ASSIGNEE_GONE) when `fromId` is no longer on it — and the version moves on, as for any task edit.
   */
  swap?(taskId: string, fromId: string, toId: string, opts?: { expectedVersion?: number }): Promise<void>;
}

export interface TaskLookup {
  exists(taskId: string): Promise<boolean>;
  /** Its version (bumped on every change) and whether it is done; null once it is gone. */
  state?(taskId: string): Promise<{ version: number; done: boolean } | null>;
}
