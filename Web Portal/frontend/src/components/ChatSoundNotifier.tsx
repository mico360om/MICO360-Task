import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { projectsApi } from '../api/projects';
import { useAuthStore } from '../stores/auth-store';
import { useChatRealtime, type ChatEventPayload } from '../lib/useChatRealtime';
import { playChime, isChatMuted, primeAudio } from '../lib/notificationSound';

/**
 * App-wide chat sound notifier (renders nothing). Subscribes to chat realtime events and plays
 * a chime for incoming messages from other people — on any page — unless the user has muted it.
 * Mounted once in the app shell.
 */
export function ChatSoundNotifier() {
  const myId = useAuthStore((s) => s.user?.id);
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  // Defensive: never let an unexpected projects payload crash the app shell.
  const projectIds = Array.isArray(projectsQ.data) ? projectsQ.data.map((p) => p.id) : [];

  // Browsers block audio until a user gesture — resume the audio context on first interaction.
  useEffect(() => {
    const onGesture = () => primeAudio();
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, []);

  useChatRealtime(projectIds, (event: string, payload: ChatEventPayload) => {
    if (event !== 'chat:message') return;
    const authorId = (payload as { message?: { userId?: string } }).message?.userId;
    if (!authorId || authorId === myId) return; // don't chime for your own messages
    if (isChatMuted()) return;
    playChime();
  });

  return null;
}
