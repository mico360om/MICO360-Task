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
}

export interface CreateNotificationData {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export interface NotificationRepository {
  create(data: CreateNotificationData): Promise<NotificationRecord>;
  findById(id: string): Promise<NotificationRecord | null>;
  list(userId: string): Promise<NotificationRecord[]>;
  markRead(id: string): Promise<NotificationRecord>;
  markAllRead(userId: string): Promise<void>;
  unreadCount(userId: string): Promise<number>;
  /** The newest unread notification of this type about this thing, if one is waiting. */
  findUnread(userId: string, type: string, entityType: string, entityId: string): Promise<NotificationRecord | null>;
  /** Reword a waiting notification and bring it to the top of the list. */
  refresh(id: string, data: { title: string; body?: string | null }): Promise<NotificationRecord>;
  /** Mark every unread notification about this thing as read. Returns how many there were. */
  markEntityRead(userId: string, entityType: string, entityId: string): Promise<number>;
}
