import type { ApiClient } from '../lib/api-client';

export interface ApiNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

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
