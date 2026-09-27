import type { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth-store';

/**
 * Tie the TanStack Query cache to the signed-in person: whenever the session ends (log out, expiry,
 * another tab signing out) or a different person signs in, cancel in-flight requests and drop every
 * cached query, so the next user of a shared PC never sees the previous user's tasks, projects,
 * notifications or chats. Token refreshes for the same user keep the cache. Returns an unsubscribe.
 */
export function bindQueryCacheToSession(queryClient: QueryClient): () => void {
  return useAuthStore.subscribe((state, prev) => {
    const userChanged = (state.user?.id ?? null) !== (prev.user?.id ?? null);
    const signedOut = prev.isAuthenticated && !state.isAuthenticated;
    if (!userChanged && !signedOut) return;
    void queryClient.cancelQueries();
    queryClient.clear();
  });
}
