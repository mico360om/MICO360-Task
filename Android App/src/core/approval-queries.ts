import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useServices } from './providers';
import type { ApprovalsAnswer } from '../lib/types';

/** The approvals list's cache key: decisions and task changes refresh it (lib/task-cache). */
export const APPROVALS_KEY = ['approvals'] as const;

/**
 * The tasks waiting for the signed-in person's approval, oldest first, and whether they approve any
 * project's tasks (GET /tasks/approvals) — My Tasks' To approve and the Dashboard's Approvals card.
 * Read through the person's offline copy, so it opens without signal; asked again after 30 s.
 */
export function useApprovals(): UseQueryResult<ApprovalsAnswer> {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: APPROVALS_KEY,
    queryFn: ({ queryKey }) => reads.read(queryKey, 'approvals', () => resources.tasks.approvals()),
    staleTime: 30_000,
  });
}
