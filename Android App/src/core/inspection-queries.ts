import { useQuery } from '@tanstack/react-query';
import { useServices } from './providers';
import { isNetworkError } from '../lib/api-client';

/**
 * The inspection reads (Stage 4). One inspection is read straight from the server: it has no copy
 * in the offline read cache — the outbox's record is its copy on the phone, kept per person and
 * only for someone who can answer it — so with no signal the screen shows that record.
 */

/** One inspection; no signal fails at once (the screen then shows the copy on the phone). */
export function useInspection(id: string) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['inspection', id],
    queryFn: () => resources.inspections.get(id),
    enabled: !!id,
    networkMode: 'always',
    retry: (n, e) => !isNetworkError(e) && n < 1,
  });
}
