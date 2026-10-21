/**
 * The project's "AI status summary" (5b review): asked once at a time and kept per project in the
 * query cache, so switching tabs while the AI thinks (it can take two minutes) neither loses the
 * answer nor invites a second request, and a fast double tap asks only once. The query cache is
 * cleared at sign-out, so the next person never sees it. Pure (TanStack only), so it is tested here.
 */
import type { QueryObserver } from '@tanstack/react-query';

export const aiSummaryKey = (projectId: string) => ['ai-summary', 'project', projectId] as const;

/** The summary's query: never fetched by itself (only when asked), never retried, kept while the app runs. */
export function aiSummaryQuery(projectId: string, ask: () => Promise<string>) {
  return {
    queryKey: aiSummaryKey(projectId),
    queryFn: ask,
    enabled: false,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  };
}

/** Ask for the summary — joining the request already on its way rather than starting another. */
export function runAiSummary(observer: Pick<QueryObserver<string>, 'refetch'>): Promise<unknown> {
  return observer.refetch({ cancelRefetch: false });
}

/** The card's button: waits for the project's tasks (it would sum up zeros), and for its own answer. */
export function summaryButton(o: { ready: boolean; busy: boolean; hasSummary: boolean }): { title: string; disabled: boolean; hint: string | null } {
  if (o.busy) return { title: 'Thinking…', disabled: true, hint: null };
  return { title: o.hasSummary ? 'Regenerate' : 'Generate summary', disabled: !o.ready, hint: o.ready ? null : 'Waiting for the project’s tasks…' };
}
