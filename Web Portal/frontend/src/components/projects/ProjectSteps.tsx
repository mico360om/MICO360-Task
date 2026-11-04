import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { projectsApi } from '../../api/projects';
import { defaultProjectOrder, projectOrderOf, projectOrderState } from '../../lib/project-steps';
import { stepsAt } from '../../lib/task-steps';

const STEP =
  'inline-flex h-8 flex-none items-center justify-center gap-1 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-default disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink max-sm:h-11 max-sm:w-11 max-sm:px-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:!min-w-11';
const Chevron = ({ back }: { back?: boolean }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="rtl:rotate-180">
    <path d={back ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
  </svg>
);

/**
 * "‹ Previous project" and "Next project ›" (1.22), in the Projects page's order when the project
 * was opened from there, else the person's projects that aren't archived, A–Z (lib/project-steps).
 * Each step is a new address (`/projects/:id`, the tab kept), so Back goes back. On a phone, icons.
 */
export function ProjectSteps({ projectId }: { projectId: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const handed = projectOrderOf(location.state);
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const projects = Array.isArray(projectsQ.data) ? projectsQ.data : [];
  const order = handed ?? (projectsQ.data ? defaultProjectOrder(projects) : null);
  const place = order ? stepsAt(order, projectId) : null;
  if (!order || !place) return null;

  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name;
  const tab = params.get('tab');
  const go = (id: string) => navigate({ pathname: `/projects/${encodeURIComponent(id)}`, search: tab ? `?tab=${encodeURIComponent(tab)}` : '' }, { state: projectOrderState(order) });
  const titleFor = (label: string, id: string | null) => (id && nameOf(id) ? `${label}: ${nameOf(id)}` : label);

  return (
    <nav aria-label="Step through projects" className="ms-auto flex flex-none items-center gap-1.5">
      <button
        type="button"
        onClick={() => place.previous && go(place.previous)}
        disabled={!place.previous}
        aria-label="Previous project"
        title={titleFor('Previous project', place.previous)}
        className={STEP}
      >
        <Chevron back />
        <span className="max-sm:sr-only">Previous project</span>
      </button>
      <button
        type="button"
        onClick={() => place.next && go(place.next)}
        disabled={!place.next}
        aria-label="Next project"
        title={titleFor('Next project', place.next)}
        className={STEP}
      >
        <span className="max-sm:sr-only">Next project</span>
        <Chevron />
      </button>
    </nav>
  );
}
