import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { useMarkNotificationRead, useUnreadCount } from './queries';
import { ALERTS_REFRESH, alertForPush, listBehindCount, pushNotificationId, serverCount, whenShown } from '../lib/alerts';
import { appCovered, subscribeViewing } from '../lib/chat-viewing';
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
 * app icon shows the count — from the server's own answers only, each one (5c review #1, #3): the
 * app's quick local updates (one fewer as an alert is opened) never move it, so they can't clear the
 * phone's notifications. A higher count than the last means alerts the list doesn't have: it is
 * asked for again (#11). Mounted once, by the navigator, while someone is signed in.
 */
export function useAlertsLive(): void {
  const qc = useQueryClient();
  useUnreadCount({ poll: true });

  useEffect(() => {
    // Signed in: this person's counts reach the icon (sign-out stopped them, #5).
    launcherBadge.start();
    let last: number | undefined;
    const offCache = qc.getQueryCache().subscribe((event) => {
      const count = serverCount(event as Parameters<typeof serverCount>[0]);
      if (count === undefined) return;
      if (listBehindCount(last, count)) void qc.invalidateQueries({ queryKey: ['notifications'], exact: true }, { cancelRefetch: false });
      last = count;
      launcherBadge.count(count);
    });
    const push = onPushReceived(() => {
      launcherBadge.pushArrived();
      refreshAlerts(qc);
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      launcherBadge.resumed();
      refreshAlerts(qc);
    });
    return () => {
      offCache();
      push.remove();
      app.remove();
    };
  }, [qc]);
}

/**
 * A push opened from the phone's notification list reads its alert, as clicking it on the website
 * does: the one the push names (servers since the 5c review), else the newest unread alert about the
 * same thing in a fresh list (lib/alerts alertForPush; the cached list may not have it — a push that
 * came while the app was away was never heard). Nothing is read while the fingerprint lock covers
 * the app (#8): it waits until it is unlocked. Signed out (or someone else signed in meanwhile),
 * nothing is read; without a connection the read is kept for later like any other.
 */
export function usePushOpened(): (data: Record<string, unknown>) => void {
  const { resources, currentUserId } = useServices();
  const { mutate } = useMarkNotificationRead();
  const markRef = useRef(mutate);
  markRef.current = mutate;
  return useCallback(
    (data) => {
      const user = currentUserId();
      if (!user) return;
      whenShown({ covered: appCovered, subscribe: subscribeViewing }, () => {
        if (currentUserId() !== user) return;
        const id = pushNotificationId(data);
        if (id) {
          markRef.current({ id });
          return;
        }
        void resources.notifications
          .list()
          .catch(() => null)
          .then((list) => {
            const alert = alertForPush(list, data);
            if (alert && currentUserId() === user) markRef.current(alert);
          });
      });
    },
    [resources, currentUserId],
  );
}
