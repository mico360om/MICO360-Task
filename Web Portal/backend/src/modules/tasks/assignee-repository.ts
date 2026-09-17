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
}

export interface TaskLookup {
  exists(taskId: string): Promise<boolean>;
}
