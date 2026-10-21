import { useQuery } from '@tanstack/react-query';
import { useServices } from './providers';

/**
 * The Activity screen's feed (5c): the newest 50 things done in your projects, kept for an offline
 * start (a small, capped copy). Under a task opened from it the feed isn't fetched; back in view it
 * is, if it went out of date.
 */
export function useActivityFeed({ active = true }: { active?: boolean } = {}) {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['activity'],
    queryFn: ({ queryKey }) => reads.read(queryKey, 'activity', () => resources.activity.recent()),
    enabled: active,
  });
}
