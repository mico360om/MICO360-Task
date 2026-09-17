/** A user watching (following) a task they may not be assigned to. */
export interface WatcherUser {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface WatcherRepository {
  add(taskId: string, userId: string): Promise<void>;
  remove(taskId: string, userId: string): Promise<void>;
  list(taskId: string): Promise<WatcherUser[]>;
  isWatching(taskId: string, userId: string): Promise<boolean>;
  /** Just the user ids — used when fanning out notifications. */
  listWatcherIds(taskId: string): Promise<string[]>;
}
