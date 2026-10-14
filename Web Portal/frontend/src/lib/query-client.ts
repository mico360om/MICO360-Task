import { QueryClient } from '@tanstack/react-query';
import { shouldRetryQuery } from './queryRetry';

/**
 * The app's one query client.
 *
 * Reads are tuned for low-resource devices: a short stale window collapses the duplicate refetches
 * that fire when components remount, and dropping the refetch-on-window-focus stampede avoids a
 * burst of network + re-render work every time the user tabs back. Mutations still invalidate
 * explicitly, so data stays fresh where it matters. 4xx responses are never retried — auth and
 * permission errors surface immediately.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        // Send a change even when the browser says it is offline. The library's default is to pause
        // it until the connection returns — no error, so nothing could queue it or tell the person:
        // "Add task" sat on "Adding…". Sent, it fails at once and the caller queues it or says so.
        networkMode: 'always',
      },
    },
  });
}
