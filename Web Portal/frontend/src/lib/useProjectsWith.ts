import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { projectsApi, type ApiProject } from '../api/projects';
import { useAuthStore } from '../stores/auth-store';

/**
 * The projects list (GET /projects, cached for every page) — plus, when a page is about a project
 * the list leaves out, that one too. 1.22: an administrator with "Show my projects only" lists only
 * their own projects, but a board, task or meeting opened by its link still names its project and
 * starts there (GET /projects/:id stays admin-wide). For anyone else the list already holds every
 * project they may open, so nothing more is asked.
 */
export function useProjectsWith(projectId: string | null | undefined) {
  const admin = useAuthStore((s) => s.isAdmin());
  const listQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const listed = Array.isArray(listQ.data) ? listQ.data : undefined;
  const wanted = projectId || '';
  const unlisted = admin && listQ.isSuccess && wanted !== '' && !(listed ?? []).some((p) => p.id === wanted);
  const extraQ = useQuery({ queryKey: ['project', wanted], queryFn: () => projectsApi(apiClient).get(wanted), enabled: unlisted });
  const projects = useMemo<ApiProject[]>(() => (unlisted && extraQ.data ? [...(listed ?? []), extraQ.data] : (listed ?? [])), [unlisted, listed, extraQ.data]);
  return {
    /** The list, with the page's own project when it was left out. */
    projects,
    /** The list's own query (loading, errors, refetch). */
    listQ,
    /** The page's project is being fetched (it isn't on the list): wait before falling back to another. */
    fetchingExtra: unlisted && extraQ.isLoading,
  };
}
