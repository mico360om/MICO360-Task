import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { SAVED_SEARCHES_KEY, savedSearchesApi, type SavedSearch, type SavedSearchList } from '../api/search';
import type { SavedFilters } from './search-everything';

/** A saved search's count is asked for again this often (the server keeps it a minute too). */
export const SAVED_COUNT_EVERY_MS = 60_000;

const EMPTY: SavedSearchList = { mine: [], shared: [], pinned: [] };
/** The list as the server sent it, or empty (an older server, or a failure). */
const listOf = (data: unknown): SavedSearchList => {
  const d = data as Partial<SavedSearchList> | undefined;
  return { mine: Array.isArray(d?.mine) ? d!.mine : [], shared: Array.isArray(d?.shared) ? d!.shared : [], pinned: Array.isArray(d?.pinned) ? d!.pinned : [] };
};

/**
 * 1.23.6 Saved searches: the person's own and those shared with their teams, and the pinned ones (in the
 * side menu's order). `enabled`: ask for them only when they are shown.
 */
export function useSavedSearches(enabled = true) {
  const q = useQuery({ queryKey: SAVED_SEARCHES_KEY, queryFn: () => savedSearchesApi(apiClient).list(), enabled, staleTime: 30_000 });
  const list = q.data ? listOf(q.data) : EMPTY;
  const all = [...list.mine, ...list.shared];
  const pinned = list.pinned.map((id) => all.find((s) => s.id === id)).filter((s): s is SavedSearch => !!s);
  return { ...q, list, all, pinned };
}

/** Live counts of these saved searches (the pinned ones), asked for again every minute. */
export function useSavedCounts(ids: string[]) {
  return useQuery({
    queryKey: [...SAVED_SEARCHES_KEY, 'counts', ids],
    queryFn: () => savedSearchesApi(apiClient).counts(ids),
    enabled: ids.length > 0,
    refetchInterval: SAVED_COUNT_EVERY_MS,
    staleTime: SAVED_COUNT_EVERY_MS,
    retry: false,
  });
}

/** "7", "1000+". */
export const countLabel = (c: { total: number; capped: boolean } | undefined): string | null => (c ? (c.capped ? '1000+' : String(c.total)) : null);

/** Save, change, share, pin and delete — each refreshes the list (and the counts). */
export function useSavedSearchActions() {
  const qc = useQueryClient();
  const api = savedSearchesApi(apiClient);
  const settle = () => void qc.invalidateQueries({ queryKey: SAVED_SEARCHES_KEY });
  return {
    create: useMutation({ mutationFn: (body: { name: string; q: string; filters: SavedFilters }) => api.create(body), onSuccess: settle }),
    update: useMutation({ mutationFn: ({ id, ...body }: { id: string; name?: string; q?: string; filters?: SavedFilters }) => api.update(id, body), onSuccess: settle }),
    remove: useMutation({ mutationFn: (id: string) => api.remove(id), onSuccess: settle }),
    share: useMutation({ mutationFn: ({ id, projectId }: { id: string; projectId: string | null }) => api.share(id, projectId), onSuccess: settle }),
    pin: useMutation({
      mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => api.pin(id, pinned),
      onSuccess: (list) => {
        qc.setQueryData(SAVED_SEARCHES_KEY, list);
        settle();
      },
    }),
  };
}
