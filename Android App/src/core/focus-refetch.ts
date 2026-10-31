import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { refetchOnFocusWanted } from '../lib/focus-refetch';

/**
 * Read a screen's query again when the screen comes back into view out of date, as ProjectsScreen's
 * card figures: a task changed on a screen opened from it (Stage 3 final review P1). It acts only on
 * coming into view — the query is read through a ref — so a query that is out of date as soon as it
 * is read (staleTime 0) is not read again in a loop. `enabled`: the screen may ask at all.
 */
export function useRefetchOnFocus(q: { isStale: boolean; isFetching: boolean; data: unknown; refetch: () => unknown }, enabled = true): void {
  const latest = useRef({ q, enabled });
  latest.current = { q, enabled };
  useFocusEffect(
    useCallback(() => {
      const { q: now, enabled: may } = latest.current;
      if (refetchOnFocusWanted({ isStale: now.isStale, isFetching: now.isFetching, hasData: now.data !== undefined }, may)) void now.refetch();
    }, []),
  );
}
