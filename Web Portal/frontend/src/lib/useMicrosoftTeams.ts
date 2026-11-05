import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { configApi } from '../api/config';
import { microsoftApi, type MicrosoftStatus } from '../api/microsoft';

/** The signed-in person's Microsoft connection (Settings → Microsoft Teams), shared by every page. */
export const MICROSOFT_STATUS_KEY = ['microsoft-status'] as const;
/** Where Settings shows it: the meeting form's "Connect Microsoft Teams in Settings" goes here. */
export const MICROSOFT_TEAMS_ANCHOR = 'microsoft-teams';

/**
 * 1.23 automatic Teams links: whether this site has them (/config — hidden everywhere otherwise) and,
 * only then, whether I have connected my own Microsoft account.
 */
export function useMicrosoftTeams(): { available: boolean; status: MicrosoftStatus | null; loading: boolean; failed: boolean; refetch: () => void } {
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  const available = (configQ.data as { microsoftTeams?: unknown } | undefined)?.microsoftTeams === true;
  const statusQ = useQuery({ queryKey: MICROSOFT_STATUS_KEY, queryFn: () => microsoftApi(apiClient).status(), enabled: available, staleTime: 60_000 });
  const data = statusQ.data as MicrosoftStatus | undefined;
  const status = data && typeof data === 'object' && typeof data.connected === 'boolean' ? data : null;
  return { available, status, loading: available && statusQ.isLoading, failed: available && statusQ.isError, refetch: () => void statusQ.refetch() };
}
