/**
 * Previous / Next project on a project's page (1.22). Opened from the Projects page, they follow
 * its order as shown — tab, filter and sort — handed on with the link (router state, so Back and a
 * reload keep it). Opened any other way (a direct link, the board, search), the person's projects
 * that aren't archived, A–Z.
 */
import { isProjectArchived } from './project-archive';

const KEY = 'projectOrder';

/** The router state a link to a project carries: the Projects page's order. */
export function projectOrderState(ids: string[]): { projectOrder: string[] } {
  return { [KEY]: ids } as { projectOrder: string[] };
}

/** The order a project page was opened with, or null when it came with none. */
export function projectOrderOf(state: unknown): string[] | null {
  if (!state || typeof state !== 'object') return null;
  const ids = (state as Record<string, unknown>)[KEY];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : null;
}

/** The person's projects that aren't archived (nor all their companies), A–Z. */
export function defaultProjectOrder(projects: { id: string; name: string; status: string; archived?: boolean }[]): string[] {
  return projects
    .filter((p) => !isProjectArchived(p))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1))
    .map((p) => p.id);
}
