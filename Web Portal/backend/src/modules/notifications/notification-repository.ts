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
}
