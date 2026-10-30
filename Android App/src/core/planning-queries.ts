import { useQuery, type Query } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import type { WeekStart } from '../lib/calendar';
import { companyTodayKey } from '../lib/due-date';
import { timelineKey, timelineTasksKey } from '../lib/timeline';

/**
 * Timeline and Workload (Stage 3): read from the server as the signed-in person — every key starts
 * ['planning', userId], every request carries `asUser` — and never from the offline copy, so
 * sign-out's cache clear drops it all and the next person on the phone sees none of it. Read again
 * whenever the screen opens (staleTime 0), with the company day in the key so a new day reads again.
 */
/**
 * TanStack's keepPreviousData, but only the same person's: while other weeks load the last ones stay
 * on screen — never someone else's (a key's second part is its person).
 */
export const samePersonPlaceholder =
  (userId: string) =>
  <T>(previous: T | undefined, previousQuery: Query<T, Error, T, readonly unknown[]> | undefined): T | undefined =>
    previousQuery?.queryKey[1] === userId ? previous : undefined;

export function useTimeline(range: { from: string; to: string; weekStart: WeekStart }) {
  const { resources } = useServices();
  const userId = useUserId() ?? '';
  const today = companyTodayKey();
  return useQuery({
    queryKey: timelineKey(userId, range.from, range.to, range.weekStart, today),
    queryFn: ({ signal }) => resources.planning.timeline(range, { asUser: userId, signal }),
    enabled: !!userId,
    placeholderData: samePersonPlaceholder(userId),
    staleTime: 0,
  });
}

/**
 * One project's task rows for the shown weeks, read when its row is opened. No placeholder (as the
 * website's): while other weeks load, the old rows are not shown as if they were theirs.
 */
export function useTimelineTasks(projectId: string, range: { from: string; to: string }, enabled: boolean) {
  const { resources } = useServices();
  const userId = useUserId() ?? '';
  const today = companyTodayKey();
  return useQuery({
    queryKey: timelineTasksKey(userId, projectId, range.from, range.to, today),
    queryFn: ({ signal }) => resources.planning.timelineTasks(projectId, range, { asUser: userId, signal }),
    enabled: enabled && !!userId,
    staleTime: 0,
  });
}
