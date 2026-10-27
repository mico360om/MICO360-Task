import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { managementAccessKey, managementApi } from '../api/management';
import { useAuthStore } from '../stores/auth-store';

/**
 * May this person see the Management page? Administrators always; anyone else when they run a
 * project (the server decides: GET /management/access). `ready` once that is known; `failed` when it
 * couldn't be asked (a network problem — never read as "no"), with `retry`. Asked again when the
 * window comes back into focus, so a new or lost role shows soon.
 */
export function useManagementAccess(): { allowed: boolean; ready: boolean; failed: boolean; retry: () => void } {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const signedIn = useAuthStore((s) => s.isAuthenticated);
  const q = useQuery({
    queryKey: managementAccessKey,
    queryFn: () => managementApi(apiClient).access(),
    enabled: signedIn && !isAdmin,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 2,
    retryDelay: 400,
  });
  const retry = () => void q.refetch();
  if (isAdmin) return { allowed: true, ready: true, failed: false, retry };
  return { allowed: q.data?.allowed === true, ready: !q.isLoading, failed: q.isError && q.data === undefined, retry };
}
