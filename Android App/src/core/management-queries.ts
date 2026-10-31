import { useQuery } from '@tanstack/react-query';
import { useServices, useSession, useUserId } from './providers';
import { managementAccessKey, managementAccessOf } from '../lib/management-access';
import { ApiError } from '../lib/api-client';
import { samePersonPlaceholder } from '../lib/same-person';
import { managementItemsKey, managementOverviewKey } from '../lib/management';
import type { ItemQuery, ManagementFilters } from '../lib/management-api';

/**
 * May the signed-in person open Management (the website's useManagementAccess)? An administrator
 * always; anyone else when the server says they run a project (GET /management/access). Asked per
 * person and only from the server — a plain query, so sign-out's cache clear drops it and the next
 * person on the phone is asked afresh — and "no" until it answers.
 */
export function useManagementAccess(): { allowed: boolean; ready: boolean; failed: boolean; retry: () => void } {
  const { resources } = useServices();
  const userId = useUserId();
  const isAdmin = (useSession()?.user.roles ?? []).includes('ADMIN');
  const q = useQuery({
    queryKey: managementAccessKey(userId),
    queryFn: () => resources.management.access(),
    enabled: !!userId && !isAdmin,
    staleTime: 60_000,
    retry: 2,
    retryDelay: 400,
  });
  const retry = () => void q.refetch();
  if (isAdmin) return { allowed: true, ready: true, failed: false, retry };
  return { allowed: managementAccessOf(false, q.data), ready: !q.isLoading, failed: q.isError && q.data === undefined, retry };
}

/**
 * Management's figures for these filters (Stage 3 Task 6): asked only once the server said this
 * person may see them (Review Focus 1), kept under their own id, sent as them, and only ever read
 * from the server — nothing of it is kept on the phone for later. The last figures stay while new
 * filters load.
 */
export function useManagementOverview(f: ManagementFilters) {
  const { resources } = useServices();
  const userId = useUserId();
  const { allowed } = useManagementAccess();
  return useQuery({
    queryKey: managementOverviewKey(userId ?? '', f),
    queryFn: ({ signal }) => resources.management.overview(f, { asUser: userId ?? undefined, signal }),
    enabled: !!userId && allowed,
    // The last figures stay while new filters load — only this person's (final review P9).
    placeholderData: samePersonPlaceholder(userId ?? ''),
    // Read again every five minutes while open (the website's REFRESH_MS).
    refetchInterval: 300_000,
    // A refusal is an answer, not a hiccup: a 403 is never asked again; anything else once more.
    retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 1,
    retryDelay: 400,
  });
}

/** The list behind a number (null: none open), with the same filters — under the same rules. */
export function useManagementItems(f: ManagementFilters, q: ItemQuery | null) {
  const { resources } = useServices();
  const userId = useUserId();
  const { allowed } = useManagementAccess();
  return useQuery({
    queryKey: managementItemsKey(userId ?? '', f, q ?? { metric: 'projects' }),
    queryFn: ({ signal }) => resources.management.items(f, q ?? { metric: 'projects' }, { asUser: userId ?? undefined, signal }),
    enabled: !!userId && allowed && !!q,
    retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 1,
    retryDelay: 400,
  });
}
