import * as Notifications from 'expo-notifications';
import { createLauncherBadge } from '../lib/alerts';

/**
 * The phone's side of the alerts badge rule (lib/alerts): the number on the app's icon and pushes
 * that come in while the app is open. The phone's notifications about one thing are taken off its
 * list by adapters/push dismissNotificationsAbout.
 */

/**
 * The app icon's number for this run of the app. On Android, launchers that draw numbers get the
 * server's unread count (ShortcutBadger, inside expo-notifications); setting none also takes this
 * app's notifications off the phone's list — all of them were read by then. Best effort.
 */
export const launcherBadge = createLauncherBadge({
  set: async (n) => {
    try {
      return await Notifications.setBadgeCountAsync(n);
    } catch {
      return false; // no notifications in this build, or a launcher without numbers
    }
  },
});

/** Be told of each push that arrives while the app is open (the alerts are asked for again). */
export function onPushReceived(listener: () => void): { remove(): void } {
  try {
    const sub = Notifications.addNotificationReceivedListener(() => listener());
    return { remove: () => sub.remove() };
  } catch {
    return { remove: () => {} };
  }
}
