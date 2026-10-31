import { useQuery } from '@tanstack/react-query';
import { useServices } from './providers';

/** The task templates' cache key (the website's TASK_TEMPLATES_KEY). */
export const TASK_TEMPLATES_KEY = ['templates', 'tasks'] as const;

/**
 * The task templates New task can start from (GET /templates/tasks; making and editing them stays on
 * the website). Read through the person's offline copy, so the picker is there without signal; only
 * while `enabled` (New task, not Edit task); asked again after 30 s, as the website (at once when the
 * offline copy answered).
 */
export function useTaskTemplates(enabled: boolean) {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: TASK_TEMPLATES_KEY,
    queryFn: ({ queryKey }) => reads.read(queryKey, 'templates.tasks', () => resources.templates.listTasks()),
    enabled,
    staleTime: (q) => (reads.answeredFromCopy(q) ? 0 : 30_000),
  });
}
