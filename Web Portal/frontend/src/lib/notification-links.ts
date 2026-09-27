import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { notificationsApi, NOTIFICATIONS_KEY, UNREAD_COUNT_KEY, type ApiNotification } from '../api/notifications';

export type NotificationTarget = { kind: 'task'; taskId: string } | { kind: 'path'; to: string } | null;

/** Where clicking a notification should take the user (null = nothing to open). */
export function notificationTarget(n: Pick<ApiNotification, 'entityType' | 'entityId'>): NotificationTarget {
  const type = (n.entityType ?? '').toLowerCase();
  if (type === 'task' && n.entityId) return { kind: 'task', taskId: n.entityId };
  if (type === 'conversation') return { kind: 'path', to: '/chat' };
  if (type === 'meeting' && n.entityId) return { kind: 'path', to: `/meetings/${n.entityId}` };
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
  const markAll = useMutation({ mutationFn: () => notificationsApi(apiClient).markAllRead(), onSuccess: refresh });
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
