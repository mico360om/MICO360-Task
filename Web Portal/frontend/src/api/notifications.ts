import type { ApiClient } from '../lib/api-client';

export interface ApiNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  /** What the notification is about (e.g. 'task', 'conversation') — used to open it on click. */
  entityType?: string | null;
  entityId?: string | null;
  readAt: string | null;
  createdAt: string;
}

/** One cache for the bell and the Notifications page, so read state always agrees. */
export const NOTIFICATIONS_KEY = ['notifications'] as const;
export const UNREAD_COUNT_KEY = ['notif-unread'] as const;

export interface NotificationPreferences {
  /** Notification type strings the user has muted (e.g. TASK_COMMENT). */
  muted: string[];
  /** Minutes before a task's due date to send a "due soon" reminder (omitted = default). */
  reminderLeadMinutes?: number;
}

export function notificationsApi(client: ApiClient) {
  return {
    list: () => client.get<{ data: ApiNotification[] }>('/notifications').then((r) => r.data),
    unreadCount: () => client.get<{ data: { count: number } }>('/notifications/unread-count').then((r) => r.data.count),
    markRead: (id: string) => client.put<{ data: ApiNotification }>(`/notifications/${id}/read`).then((r) => r.data),
    markAllRead: () => client.post<{ data: { ok: boolean } }>('/notifications/read-all'),
    getPreferences: () => client.get<{ data: NotificationPreferences }>('/notifications/preferences').then((r) => r.data),
    setPreferences: (prefs: NotificationPreferences) =>
      client.put<{ data: NotificationPreferences }>('/notifications/preferences', prefs).then((r) => r.data),
  };
}
