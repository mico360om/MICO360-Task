/** Whether the unread count rising warrants a desktop notification (T16.5). */
export function shouldNotify(prevCount, nextCount) {
  return typeof nextCount === 'number' && nextCount > (prevCount ?? 0);
}

/** Human text for the desktop notification. */
export function notificationText(count) {
  return count === 1 ? 'You have 1 new notification' : `You have ${count} new notifications`;
}
