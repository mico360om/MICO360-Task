import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { categoriesApi, type ProjectCategories } from '../api/categories';

/** 1.24 Where one project's category list is cached (invalidate it after the list or "Every task needs a category" changes). */
/** The one key every view uses (the task form, the panel, the board and project settings). */
export const projectCategoriesKey = (projectId: string | undefined) => ['categories', projectId] as const;

/**
 * One project's categories and whether every task needs one (GET /projects/:id/categories): undefined
 * while it loads (or when `enabled` is false), null when it couldn't be read (an older server).
 */
export function useProjectCategories(projectId: string | undefined, enabled = true): ProjectCategories | null | undefined {
  const on = Boolean(projectId) && enabled;
  const q = useQuery({
    queryKey: projectCategoriesKey(projectId),
    queryFn: () => categoriesApi(apiClient).forProject(projectId as string),
    enabled: on,
    staleTime: 60_000,
    retry: false,
  });
  if (!on || (q.data === undefined && !q.isError)) return undefined;
  const data = q.data;
  return data && typeof data === 'object' && Array.isArray(data.categories) ? data : null;
}
