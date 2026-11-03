import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { preferencesApi, type DatePreferences } from '../api/preferences';
import { useAuthStore } from '../stores/auth-store';
import { resetCompanyScopedQueries } from './company-scope';
import { DATE_PREFS_KEY } from './useDatePrefs';

/**
 * "Show my projects only" (1.22, Settings): an administrator's own setting, kept on the server for
 * every device and session. When on, every list on the site shows them only the projects they own,
 * manage or are on the team of — the server applies it; the pages only say so. Read from the same
 * answer as the date settings (GET /users/me/preferences). Never on for anyone else.
 */
export function useMyProjectsOnly(): boolean {
  const admin = useAuthStore((s) => s.isAdmin());
  const { data } = useQuery({ queryKey: DATE_PREFS_KEY, queryFn: () => preferencesApi(apiClient).get(), staleTime: 5 * 60_000, enabled: admin });
  return admin && (data as DatePreferences | undefined)?.myProjectsOnly === true;
}

/**
 * Turn it on or off. Once the server has it, every cached list is dropped and read again — as a
 * change of the picked company does (lib/company-scope.ts), so no list of the old scope stays shown.
 */
export function useSetMyProjectsOnly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => preferencesApi(apiClient).set({ myProjectsOnly: on }),
    onSuccess: (prefs) => {
      qc.setQueryData(DATE_PREFS_KEY, prefs);
      resetCompanyScopedQueries(qc);
    },
  });
}
