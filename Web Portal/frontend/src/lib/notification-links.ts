import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { notificationsApi, NOTIFICATIONS_KEY, UNREAD_COUNT_KEY, type ApiNotification } from '../api/notifications';

export type NotificationTarget = { kind: 'task'; taskId: string } | { kind: 'path'; to: string } | null;

/** Where clicking a notification should take the user (null = nothing to open). */
export function notificationTarget(n: Pick<ApiNotification, 'entityType' | 'entityId'>): NotificationTarget {
  const type = (n.entityType ?? '').toLowerCase();
  if (type === 'task' && n.entityId) return { kind: 'task', taskId: n.entityId };
  // A chat notification opens the conversation it is about (ChatRoute reads ?conversation=).
  if (type === 'conversation') return { kind: 'path', to: n.entityId ? `/chat?conversation=${encodeURIComponent(n.entityId)}` : '/chat' };
  if (type === 'meeting' && n.entityId) return { kind: 'path', to: `/meetings/${n.entityId}` };
  // 1.22: a MICO AI answer written in the background (or one that failed): its chat.
  if (type === 'mico-ai-chat') return { kind: 'path', to: n.entityId ? `/mico-ai?chat=${encodeURIComponent(n.entityId)}` : '/mico-ai' };
  // "… added you to the project …": its page.
  if (type === 'project' && n.entityId) return { kind: 'path', to: `/projects/${encodeURIComponent(n.entityId)}` };
  // Project KPIs: "Time to enter October’s KPI values" opens the project's KPIs tab.
  if (type === 'project-kpis' && n.entityId) return { kind: 'path', to: `/projects/${encodeURIComponent(n.entityId)}?tab=kpis` };
  // Notification & Scheduling: several reminders of one kind in one notice ("5 tasks are overdue") open
  // the list they are about — My Tasks, its To approve list, or Management (projects you run).
  if (type === 'my-tasks') return { kind: 'path', to: '/my-tasks' };
  if (type === 'approvals') return { kind: 'path', to: '/my-tasks#to-approve' };
  if (type === 'management') return { kind: 'path', to: '/management' };
  // Training Center: a course (due, overdue, a certificate expiring, an answer), several courses assigned (My
  // training), an overdue escalation (the Training Center's reports) and a question or "outdated" report (its feedback).
  if (type === 'training-course' && n.entityId) return { kind: 'path', to: `/training/courses/${encodeURIComponent(n.entityId)}` };
  if (type === 'training-course' || type === 'training-my') return { kind: 'path', to: '/training' };
  if (type === 'training-overdue') return { kind: 'path', to: '/training/manage?tab=reports' };
  if (type === 'training-feedback') return { kind: 'path', to: '/training/manage?tab=feedback' };
  return null;
}

/**
 * Open a notification: mark it read (refreshing the one shared cache the bell and the page use) and
 * go to what it's about — a task opens in the global task drawer (`?task=<id>`) on the current page.
 */
export function useOpenNotification(): {
  open: (n: ApiNotification) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
} {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    void qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
  };
  const markOne = useMutation({ mutationFn: (id: string) => notificationsApi(apiClient).markRead(id), onSuccess: refresh });
  // Only what the bell and this page show is read: one that arrives meanwhile stays unread (5c review).
  const markAll = useMutation({ mutationFn: () => notificationsApi(apiClient).markAllRead(newestShown(qc.getQueryData<ApiNotification[]>(NOTIFICATIONS_KEY))), onSuccess: refresh });
  return {
    open: (n) => {
      if (!n.readAt) markOne.mutate(n.id);
      const target = notificationTarget(n);
      if (!target) return;
      if (target.kind === 'task') {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('task', target.taskId);
          return next;
        });
      } else {
        navigate(target.to);
      }
    },
    markRead: (id) => markOne.mutate(id),
    markAllRead: () => markAll.mutate(),
  };
}

/** The newest notification's time in the list shown (for "Mark all read" up to it), or undefined. */
export function newestShown(list: readonly Pick<ApiNotification, 'createdAt'>[] | null | undefined): string | undefined {
  let best: { t: number; iso: string } | null = null;
  for (const n of list ?? []) {
    const t = Date.parse(n.createdAt);
    if (!Number.isNaN(t) && (!best || t > best.t)) best = { t, iso: n.createdAt };
  }
  return best?.iso;
}
