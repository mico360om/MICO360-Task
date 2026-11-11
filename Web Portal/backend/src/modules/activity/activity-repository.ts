export interface ActivityRecord {
  id: string;
  taskId: string | null;
  projectId: string | null;
  userId: string;
  action: string;
  meta: unknown;
  createdAt: Date;
  /** The user who performed the action (joined on list; the feed's "who"), with their photo (null: initials). */
  actor?: { id: string; name: string; avatarUrl?: string | null } | null;
  /** The task the action was on (joined on list). */
  task?: { id: string; key: string; title: string } | null;
  /** The project the action was in (joined on list). */
  project?: { id: string; name: string } | null;
}

export interface CreateActivityData {
  taskId?: string | null;
  projectId?: string | null;
  userId: string;
  action: string;
  meta?: unknown;
}

/** Which changes a calendar question covers: these projects (`null` = an administrator's, unscoped) and, with a filter, these actions. */
export interface ActivityScope {
  projectIds: string[] | null;
  actions?: string[] | null;
}

export interface ActivityRepository {
  create(data: CreateActivityData): Promise<ActivityRecord>;
  listForTask(taskId: string): Promise<ActivityRecord[]>;
  /**
   * The newest activity, newest first. With `projectIds`, only activity in those projects — the
   * filter runs in the query, before the limit, so quiet projects still fill their feed.
   */
  listRecent(limit?: number, projectIds?: string[] | null): Promise<ActivityRecord[]>;
  /** When each change in the scope happened, from `from` up to (not including) `to` — the calendar counts them per day. */
  timesBetween(from: Date, to: Date, scope: ActivityScope): Promise<Date[]>;
  /**
   * The changes in the scope from `from` up to `to`, newest first (ties by id), at most `limit`;
   * `before`: carry on after that change (the last one already shown).
   */
  listBetween(from: Date, to: Date, scope: ActivityScope, page: { limit: number; before?: string | null }): Promise<ActivityRecord[]>;
}
