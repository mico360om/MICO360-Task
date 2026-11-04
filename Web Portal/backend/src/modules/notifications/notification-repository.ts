export interface NotificationRecord {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: Date | null;
  createdAt: Date;
  /** companies: the project it is about (null = none). */
  projectId?: string | null;
}

/** What the Notifications page shows of the project a notification is about (1.22). */
export interface NotificationProject {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  imageUrl: string | null;
}

/** One page of a person's list (1.22): newest first, by time and then id. */
export interface NotificationListOptions {
  /** Only rows older than this one (the previous page's last row). */
  before?: { createdAt: Date; id: string };
  /** How many (default 100). */
  limit?: number;
  /** Only unread ones. */
  unreadOnly?: boolean;
  /** Only these types (left out = every type). */
  types?: readonly string[];
}

/** What can be done to several notifications at once (1.22). */
export type NotificationBulkAction = 'read' | 'unread' | 'remove';

export interface CreateNotificationData {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /**
   * companies: the project it is about (the bell filters by it). Left out, the database repository
   * works it out from the entity — a task's project, a project, a project channel's project (as the
   * upgrade did for the old rows); anything else is about no project.
   */
  projectId?: string | null;
}

/**
 * companies: which of a person's notifications a list shows — those about no project, and those
 * about `projectIds` (the projects they see, in the picked company). null = all of them.
 */
export type NotificationScope = readonly string[] | null;

/** What a list or a count is limited to (companies): the person's projects, in the picked company. */
export interface ListScope {
  /** The project ids they may see in the pick; null = every project (an administrator without a pick). */
  projectIds: string[] | null;
  pick: string | null;
}

export interface NotificationRepository {
  create(data: CreateNotificationData): Promise<NotificationRecord>;
  findById(id: string): Promise<NotificationRecord | null>;
  list(userId: string, scope?: NotificationScope, opts?: NotificationListOptions): Promise<NotificationRecord[]>;
  markRead(id: string): Promise<NotificationRecord>;
  /** Read every unread one — only those that came in by `upTo` when it is given (what the reader saw), in `scope`, and of `types` when given. */
  markAllRead(userId: string, upTo?: Date, scope?: NotificationScope, types?: readonly string[]): Promise<void>;
  unreadCount(userId: string, scope?: NotificationScope): Promise<number>;
  /** The newest unread notification of this type about this thing, if one is waiting. */
  findUnread(userId: string, type: string, entityType: string, entityId: string): Promise<NotificationRecord | null>;
  /** Reword a waiting notification and bring it to the top of the list. */
  refresh(id: string, data: { title: string; body?: string | null }): Promise<NotificationRecord>;
  /** Mark every unread notification about this thing as read. Returns how many there were. */
  markEntityRead(userId: string, entityType: string, entityId: string): Promise<number>;
  /** 1.22: unread ones per type, in `scope` (the chips' counts). */
  unreadByType(userId: string, scope?: NotificationScope): Promise<Record<string, number>>;
  markUnread(id: string): Promise<NotificationRecord>;
  remove(id: string): Promise<void>;
  /** The person's own ones among `ids` only; how many changed (read: the unread ones; unread: the read ones). */
  bulk(userId: string, ids: readonly string[], action: NotificationBulkAction): Promise<number>;
  /** The projects a page of notifications is about (one that is gone or in the trash is left out). */
  projectLooks(ids: readonly string[]): Promise<NotificationProject[]>;
}
