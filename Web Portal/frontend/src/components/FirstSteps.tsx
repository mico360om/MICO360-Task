import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { projectsApi } from '../api/projects';
import { useAuthStore } from '../stores/auth-store';
import { buttonClass } from './ui/Button';
import { TOUCH_TALL } from '../lib/touch';

/**
 * A company's first day: no projects yet. The personal pages (Dashboard, My Tasks, Notifications,
 * Activity) have nothing to show, so instead of only saying so they point to the first steps —
 * create a project, then (an administrator) add the people who will work in it.
 *
 * True only once the server has answered with an empty list: never while loading, and never when
 * the list failed to load (an outage must not read as "start from scratch"). Shares the
 * ['projects'] cache with the rest of the app.
 */
export function useNoProjectsYet(): boolean {
  const q = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  return q.isSuccess && Array.isArray(q.data) && q.data.length === 0;
}

/** The first-day picture for an empty state: a flag at the start line. */
export const FirstStepsIcon = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <path d="M4 22v-7" />
  </svg>
);

/**
 * The first steps, as an empty state's action: "Create a project" (anyone may) and, for an
 * administrator, "Add your team". They go to the pages where each is done.
 */
export function FirstStepsActions() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Link to="/projects" className={buttonClass('primary', 'md', TOUCH_TALL)}>
        Create a project
      </Link>
      {isAdmin ? (
        <Link to="/admin/users" className={buttonClass('secondary', 'md', TOUCH_TALL)}>
          Add your team
        </Link>
      ) : null}
    </div>
  );
}
