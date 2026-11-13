import type { QueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { chatApi } from '../api/chat';

/**
 * The signed-in person's conversation list (with unread counts): one cache entry shared by the Chat
 * page, the app-wide chat notifier and the Chat menu's badge, so they never disagree.
 */
export const CHAT_INBOX_KEY = ['chat', 'conversations'] as const;
export const chatInboxQuery = { queryKey: CHAT_INBOX_KEY, queryFn: () => chatApi(apiClient).conversations() };

/** Review #35: live chat events refresh the conversation list this long after the last of a burst… */
export const INBOX_REFRESH_DEBOUNCE_MS = 400;
/** …and at least this often while they keep coming (a busy project channel never holds it back for long). */
export const INBOX_REFRESH_MAX_WAIT_MS = 1500;

const waiting = new WeakMap<QueryClient, { timer: ReturnType<typeof setTimeout>; since: number }>();

/**
 * Refresh the conversation list after a live chat event, once per burst (review #35): every message in
 * a project channel reached every online member's page, and each page asked for the whole list again at
 * once — the Chat page and the app-wide notifier both. Events this page's QueryClient gets within
 * INBOX_REFRESH_DEBOUNCE_MS of each other make one refresh, at the latest INBOX_REFRESH_MAX_WAIT_MS
 * after the first. What the person does themselves (reading, sending, settings) still refreshes at once.
 */
export function refreshInboxSoon(qc: QueryClient): void {
  const was = waiting.get(qc);
  if (was) clearTimeout(was.timer);
  const since = was?.since ?? Date.now();
  const wait = Math.max(0, Math.min(INBOX_REFRESH_DEBOUNCE_MS, since + INBOX_REFRESH_MAX_WAIT_MS - Date.now()));
  const timer = setTimeout(() => {
    waiting.delete(qc);
    void qc.invalidateQueries({ queryKey: CHAT_INBOX_KEY });
  }, wait);
  waiting.set(qc, { timer, since });
}
