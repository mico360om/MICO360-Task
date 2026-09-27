/** Fixed id so a newer desktop notification replaces the previous one; clicks are matched on it. */
export const NOTIFICATION_ID = 'mico360-unread';

/**
 * Whether the unread count rising warrants a desktop notification (T16.5). Without a baseline
 * (first poll after install or sign-in) nothing is announced: existing unread items aren't "new".
 */
export function shouldNotify(prevCount, nextCount) {
  return typeof prevCount === 'number' && typeof nextCount === 'number' && nextCount > prevCount;
}

/** The stored unread count is only a baseline for the user it was recorded for (EXT-06). */
export function unreadBaseline(stored, userId) {
  return stored && stored.lastUnreadUser === userId && typeof stored.lastUnread === 'number' ? stored.lastUnread : undefined;
}

/** Human text for the desktop notification. */
export function notificationText(count) {
  return count === 1 ? 'You have 1 new notification' : `You have ${count} new notifications`;
}

/**
 * Find an open tab showing the extension app among `chrome.runtime.getContexts()` results, so the
 * toolbar button can focus it without the "tabs" permission (EXT-07). Returns the context or null.
 */
export function findAppContext(contexts, appUrl) {
  return (
    (contexts || []).find(
      (c) => c && typeof c.documentUrl === 'string' && c.documentUrl.split('#')[0].split('?')[0] === appUrl && typeof c.tabId === 'number' && c.tabId >= 0,
    ) || null
  );
}
