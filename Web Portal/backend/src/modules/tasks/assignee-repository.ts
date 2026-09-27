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
}

export interface TaskLookup {
  exists(taskId: string): Promise<boolean>;
}
