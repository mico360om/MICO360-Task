import { useCallback, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationSummary } from '../api/chat';
import { useAuthStore } from '../stores/auth-store';
import { chatBadgeCount } from './chat-badge';
import { chatInboxQuery } from './chat-inbox-query';
import { subscribeViewing, viewingConversation } from './chat-sound';

/**
 * The number on the Chat menu: unread chat messages, live. It reads the same conversation list
 * as the Chat page (one request, one cache entry), which ChatSoundNotifier refreshes when a
 * message arrives, when you read a conversation elsewhere and after a reconnect; reading here
 * refreshes it too. The conversation open on screen counts as read straight away.
 */
export function useChatBadge(): number {
  const myId = useAuthStore((s) => s.user?.id);
  const viewing = useSyncExternalStore(subscribeViewing, viewingConversation, viewingConversation);
  // Only the number leaves the query, so a new message that doesn't change it re-renders nothing.
  const select = useCallback((inbox: ConversationSummary[]) => chatBadgeCount(inbox, { viewing }), [viewing]);
  const countQ = useQuery({ ...chatInboxQuery, enabled: !!myId, select });
  return myId ? countQ.data ?? 0 : 0;
}
