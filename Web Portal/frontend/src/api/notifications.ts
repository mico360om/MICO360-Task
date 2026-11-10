import type { ApiClient, RequestOptions } from '../lib/api-client';
import type { InboxCounts, NotificationKind } from '../lib/notification-inbox';

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
  /** 1.22: the project it is about, with its look (none for a notice about no project). */
  projectId?: string | null;
  project?: { id: string; name: string; color: string | null; icon: string | null; imageUrl: string | null } | null;
  /** 1.22.3: the current number of the task it is about (shown as the chip; null for any other notice). */
  taskKey?: string | null;
}

/** One cache for the bell and the Notifications page, so read state always agrees. */
export const NOTIFICATIONS_KEY = ['notifications'] as const;
export const UNREAD_COUNT_KEY = ['notif-unread'] as const;
/** 1.22: the page's lists (per tab and chips) and its unread counts — under NOTIFICATIONS_KEY, so refreshing the bell refreshes them too. */
export const NOTIFICATION_PAGES_KEY = [...NOTIFICATIONS_KEY, 'pages'] as const;
export const NOTIFICATION_COUNTS_KEY = [...NOTIFICATIONS_KEY, 'counts'] as const;

/** A page of the list: newest first; `nextCursor` asks for the next (older) page, null at the end. */
export interface NotificationPage {
  data: ApiNotification[];
  nextCursor: string | null;
}

export interface NotificationPageQuery {
  cursor?: string;
  limit?: number;
  unread?: boolean;
  kinds?: readonly NotificationKind[];
}

export type NotificationBulkAction = 'read' | 'unread' | 'remove';

export interface NotificationPreferences {
  /** Notification type strings the user has muted (e.g. TASK_COMMENT). */
  muted: string[];
  /** Minutes before a task's due date to send a "due soon" reminder (omitted = default). */
  reminderLeadMinutes?: number;
  /** The daily email's parts and when it goes (HH:MM, the person's time zone); the server fills in the defaults. */
  dailyEmails?: DailyEmailPrefs;
  /** The weekly management summary (for the people who can see the Management page); the server says true unless turned off. */
  weeklySummary?: boolean;
}

/**
 * The daily email (1.22: one email, in parts; the redesign of Nov 2026 adds five). `pending` (other open
 * tasks) and `completed` (completed yesterday) keep the names of the two emails before 1.22, so older apps
 * still work.
 */
export interface DailyEmailPrefs {
  pending: boolean;
  completed: boolean;
  time: string;
  /** Today's meetings. */
  schedule: boolean;
  /** Overdue and due today. */
  urgent: boolean;
  /** Others' overdue and waiting tasks (people who run a project). */
  managed: boolean;
  /** Today at a glance (the tiles). */
  glance: boolean;
  /** This week (done of due, and the last 7 days). */
  week: boolean;
  /** By priority. */
  priority: boolean;
  /** Coming up (next 7 days, and tasks starting later). */
  comingUp: boolean;
  /** Your projects (people who run a project). */
  projects: boolean;
}
export type DailyEmailPart = 'glance' | 'week' | 'priority' | 'urgent' | 'comingUp' | 'pending' | 'schedule' | 'completed' | 'projects' | 'managed';

/** What "Send me a test" sent: an email with nothing in it isn't sent. `pending`/`completed` repeat `daily` for older apps. */
export interface DailyEmailTestResult {
  daily?: 'sent' | 'empty' | 'blocked';
  pending: 'sent' | 'empty' | 'blocked';
  completed: 'sent' | 'empty' | 'blocked';
}

export function notificationsApi(client: ApiClient) {
  return {
    list: () => client.get<{ data: ApiNotification[] }>('/notifications').then((r) => r.data),
    unreadCount: () => client.get<{ data: { count: number } }>('/notifications/unread-count').then((r) => r.data.count),
    markRead: (id: string) => client.put<{ data: ApiNotification }>(`/notifications/${id}/read`).then((r) => r.data),
    /** Read everything shown: `upTo` (the newest shown) leaves one that came in meanwhile unread. */
    /** With `kinds` (the page's chips), only those types are read. */
    markAllRead: (upTo?: string, kinds?: readonly NotificationKind[]) =>
      client.post<{ data: { ok: boolean } }>('/notifications/read-all', kinds?.length ? { ...(upTo ? { upTo } : {}), kinds } : upTo ? { upTo } : undefined),
    /** 1.22: a page of the Notifications page (50 at a time, the Unread tab, the chips). */
    page: (q: NotificationPageQuery = {}) => {
      const params = new URLSearchParams();
      if (q.limit) params.set('limit', String(q.limit));
      if (q.cursor) params.set('cursor', q.cursor);
      if (q.unread) params.set('unread', '1');
      if (q.kinds?.length) params.set('kinds', q.kinds.join(','));
      const qs = params.toString();
      return client.get<NotificationPage>(`/notifications${qs ? `?${qs}` : ''}`).then((r) => ({ data: r.data, nextCursor: r.nextCursor ?? null }));
    },
    /** Unread per type chip, and in all. */
    counts: () => client.get<{ data: InboxCounts }>('/notifications/counts').then((r) => r.data),
    markUnread: (id: string) => client.post<{ data: ApiNotification }>(`/notifications/${id}/unread`).then((r) => r.data),
    remove: (id: string, opts?: RequestOptions) => client.del<{ data: { ok: boolean } }>(`/notifications/${id}`, opts),
    /** Several of your own at once (at most 200 to a request). */
    bulk: (ids: readonly string[], action: NotificationBulkAction, opts?: RequestOptions) =>
      client.post<{ data: { count: number } }>('/notifications/bulk', { ids, action }, opts).then((r) => r.data),
    getPreferences: () => client.get<{ data: NotificationPreferences }>('/notifications/preferences').then((r) => r.data),
    /**
     * Saves what is sent; daily email settings left out are kept as they are. `knowsAllParts`: the save
     * has every part of the daily email (this website), so the server takes them as they are.
     */
    setPreferences: (prefs: Partial<Omit<NotificationPreferences, 'dailyEmails'>> & { dailyEmails?: DailyEmailPrefs & { knowsAllParts?: true } }) =>
      client.put<{ data: NotificationPreferences }>('/notifications/preferences', prefs).then((r) => r.data),
    sendDailyTest: () => client.post<{ data: DailyEmailTestResult }>('/notifications/daily-emails/test').then((r) => r.data),
  };
}
