import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { chatApi } from '../api/chat';
import { useAuthStore } from '../stores/auth-store';
import { chatBadgeCount } from './chat-badge';
import { subscribeViewing, viewingConversation } from './chat-sound';

/**
 * The number on the Chat menu: unread chat messages, live. It reads the same conversation list
 * as the Chat page (one request, one cache entry), which ChatSoundNotifier refreshes when a
 * message arrives, when you read a conversation elsewhere and after a reconnect; reading here
 * refreshes it too. The conversation open on screen counts as read straight away.
 */
export function useChatBadge(): number {
  const myId = useAuthStore((s) => s.user?.id);
  const inboxQ = useQuery({ queryKey: ['chat', 'conversations'], queryFn: () => chatApi(apiClient).conversations(), enabled: !!myId });
  const viewing = useSyncExternalStore(subscribeViewing, viewingConversation, viewingConversation);
  return myId ? chatBadgeCount(inboxQ.data, { viewing }) : 0;
}
