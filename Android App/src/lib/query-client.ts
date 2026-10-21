import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { ApiError } from './api-client';
import type { Connectivity } from './connectivity';

/** How long a server's answer counts as fresh. */
export const FRESH_MS = 30_000;

export interface QueryClientOptions {
  /** Did this query's newest answer come from the offline copy (offline-reads)? Then it is out of date at once. */
  answeredFromCopy?: (query: { queryHash: string }) => boolean;
}

/**
 * The app's one query client. A server's answer counts as fresh for 30 s; one from the offline copy
 * is out of date at once. Out-of-date data on screen is refreshed when the app comes back to the
 * front (followAppState) and when the server can be reached again (followConnectivity).
 */
export function createQueryClient({ answeredFromCopy }: QueryClientOptions = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: (query) => (answeredFromCopy?.(query) ? 0 : FRESH_MS),
        // Retry once for a dropped connection or a 5xx; a 4xx answer will not change on retry.
        retry: (failureCount, error) => failureCount < 1 && !(error instanceof ApiError && error.status < 500),
        // Lists fall back to their offline copy when a request gets no answer, so a read is always
        // tried, even while TanStack believes the phone is offline (it would otherwise wait).
        networkMode: 'always',
        // TanStack turns this off by default with 'always'; being back online should still refresh.
        refetchOnReconnect: true,
      },
      // A change made offline must reach its request and fail, so the app queues it for later
      // (core/queries queueOnOffline); TanStack holding it back would keep it out of that queue.
      mutations: { networkMode: 'always' },
    },
  });
}

/** What the app needs of React Native's AppState (passed in, so this runs in tests). */
export interface AppStateLike {
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
}

/**
 * TanStack's "window focus" follows the app being in front, so coming back to the app refreshes
 * what is on screen and out of date. Returns a function that stops following.
 */
export function followAppState(appState: AppStateLike): () => void {
  focusManager.setEventListener((setFocused) => {
    const sub = appState.addEventListener('change', (state) => setFocused(state === 'active'));
    return () => sub.remove();
  });
  return () => focusManager.setEventListener(() => undefined);
}

/**
 * TanStack's online state follows the app's own (connectivity), so being back online refreshes
 * what is on screen and out of date. Returns a function that stops following.
 */
export function followConnectivity(connectivity: Connectivity): () => void {
  onlineManager.setEventListener((setOnline) => {
    setOnline(connectivity.isOnline());
    return connectivity.subscribe(setOnline);
  });
  return () => onlineManager.setEventListener(() => undefined);
}
