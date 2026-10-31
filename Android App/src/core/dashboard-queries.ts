import { useQuery } from '@tanstack/react-query';
import { useServices } from './providers';
import { DUE_SOON_KEY } from '../lib/refresh';

/** Due soon's cache key (lib/refresh, where task changes mark it out of date): under ['tasks']. */
export { DUE_SOON_KEY };

/**
 * The Dashboard's Due soon rows: open tasks by due day, earliest first (the server puts tasks without
 * a due day last) — the website's rows without downloading every task. Read through the person's
 * offline copy, so the card opens without signal.
 */
export function useDueSoonTasks() {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: DUE_SOON_KEY,
    queryFn: ({ queryKey }) => reads.read(queryKey, 'tasks.due-soon', () => resources.tasks.list({ category: 'BACKLOG,TODO,IN_PROGRESS,BLOCKED,REVIEW', sort: 'dueDate', order: 'asc', limit: 20 })),
  });
}
