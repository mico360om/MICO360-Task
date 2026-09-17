export interface ActivityRecord {
  id: string;
  taskId: string | null;
  projectId: string | null;
  userId: string;
  action: string;
  meta: unknown;
  createdAt: Date;
  /** The user who performed the action (joined on list; the feed's "who"). */
  actor?: { id: string; name: string } | null;
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

export interface ActivityRepository {
  create(data: CreateActivityData): Promise<ActivityRecord>;
  listForTask(taskId: string): Promise<ActivityRecord[]>;
  listRecent(limit?: number): Promise<ActivityRecord[]>;
}
