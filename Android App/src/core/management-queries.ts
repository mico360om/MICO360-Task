import { useQuery } from '@tanstack/react-query';
import { useServices, useSession, useUserId } from './providers';
import { managementAccessKey, managementAccessOf } from '../lib/management-access';

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
