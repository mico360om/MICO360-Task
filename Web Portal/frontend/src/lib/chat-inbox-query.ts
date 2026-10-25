import { apiClient } from '../api/client';
import { chatApi } from '../api/chat';

/**
 * The signed-in person's conversation list (with unread counts): one cache entry shared by the Chat
 * page, the app-wide chat notifier and the Chat menu's badge, so they never disagree.
 */
export const CHAT_INBOX_KEY = ['chat', 'conversations'] as const;
export const chatInboxQuery = { queryKey: CHAT_INBOX_KEY, queryFn: () => chatApi(apiClient).conversations() };
