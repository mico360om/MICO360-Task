import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { managementAccessKey, managementApi } from '../api/management';
import { useAuthStore } from '../stores/auth-store';

/**
 * May this person see the Management page? Administrators always; anyone else when they run a
 * project (the server decides: GET /management/access). `ready` once that is known.
 */
export function useManagementAccess(): { allowed: boolean; ready: boolean } {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const signedIn = useAuthStore((s) => s.isAuthenticated);
  const q = useQuery({
    queryKey: managementAccessKey,
    queryFn: () => managementApi(apiClient).access(),
    enabled: signedIn && !isAdmin,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (isAdmin) return { allowed: true, ready: true };
  return { allowed: q.data?.allowed === true, ready: !q.isLoading };
}
