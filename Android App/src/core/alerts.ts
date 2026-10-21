import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { useMarkNotificationRead, useUnreadCount } from './queries';
import { ALERTS_REFRESH, alertForPush } from '../lib/alerts';
import type { ApiNotification } from '../lib/types';
import { launcherBadge, onPushReceived } from '../adapters/alerts';

/** The unread alerts (undefined while not known): the Alerts tab's number. */
export function useAlertsCount(): number | undefined {
  return useUnreadCount().data?.count;
}

/**
 * Ask for the alerts again. A fetch already on its way (the app coming back to the front refreshes
 * out-of-date data too) is kept, not cancelled and sent a second time.
 */
function refreshAlerts(qc: QueryClient): void {
  for (const t of ALERTS_REFRESH) void qc.invalidateQueries({ queryKey: t.queryKey, exact: t.exact }, { cancelRefetch: false });
}

/**
 * Keeps the alerts current while signed in (5c, the badge rule in lib/alerts): the unread count is
 * asked for every 30 s while the app is in front, and the list and count again when a push comes in
 * and when the app comes back to the front (a push that came while it was away isn't heard). The
 * app icon shows the count. Mounted once, by the navigator.
 */
export function useAlertsLive(): void {
  const qc = useQueryClient();
  const count = useUnreadCount({ poll: true }).data?.count;

  useEffect(() => {
    const push = onPushReceived(() => {
      launcherBadge.pushArrived();
      refreshAlerts(qc);
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshAlerts(qc);
    });
    return () => {
      push.remove();
      app.remove();
    };
  }, [qc]);

  useEffect(() => {
    launcherBadge.count(count);
  }, [count]);
}

/**
 * A push opened from the phone's notification list reads its alert, as clicking it on the website
 * does: the newest unread alert about the same thing (lib/alerts alertForPush). Signed out, nothing
 * is read; without a connection the read is kept for later like any other.
 */
export function usePushOpened(): (data: Record<string, unknown>) => void {
  const { resources, currentUserId } = useServices();
  const qc = useQueryClient();
  const { mutate } = useMarkNotificationRead();
  const markRef = useRef(mutate);
  markRef.current = mutate;
  return useCallback(
    (data) => {
      if (!currentUserId()) return;
      void (async () => {
        const list = qc.getQueryData<ApiNotification[]>(['notifications']) ?? (await resources.notifications.list().catch(() => null));
        const alert = alertForPush(list, data);
        if (alert) markRef.current(alert);
      })();
    },
    [qc, resources, currentUserId],
  );
}
