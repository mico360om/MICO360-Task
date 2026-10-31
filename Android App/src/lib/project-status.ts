/**
 * Changing a project's status on the Projects page, as the website's: the card moves to its new tab
 * at once, the change is sent (Archived through the archive action, which the website asks about
 * first), and either way the list is read again from the server afterwards, whose counts win. A
 * change that didn't go through puts the list back and says why. Online only (never kept on the
 * phone). Pure TypeScript over a QueryClient, so vitest runs it.
 */
import type { QueryClient } from '@tanstack/react-query';
import { isNetworkError } from './api-client';
import { statusChangeProblem } from './project-list';
import { statusChangeFailed, withProjectStatus } from './projects-page';
import { PROJECTS_OVERVIEW_KEY } from './refresh';
import type { ProjectOverview } from './types';

/** The Archive question (website ProjectsPage's ConfirmDialog). */
export const ARCHIVE_TEXT = {
  title: (name: string): string => `Archive ${name}?`,
  body: 'It moves to the Archived tab, out of the other lists. Its tasks stay as they are, and you can change its status back at any time.',
  confirm: 'Archive',
  failed: 'Couldn’t archive the project. Try again.',
} as const;

export type StatusChangeOutcome = { ok: true } | { ok: false; message: string };

export async function changeProjectStatus(
  qc: QueryClient,
  send: { update(id: string, status: string): Promise<unknown>; archive(id: string): Promise<unknown> },
  project: Pick<ProjectOverview, 'id' | 'name'>,
  status: string,
): Promise<StatusChangeOutcome> {
  const archiving = status === 'ARCHIVED';
  await qc.cancelQueries({ queryKey: PROJECTS_OVERVIEW_KEY });
  const before = qc.getQueryData<ProjectOverview[]>(PROJECTS_OVERVIEW_KEY);
  if (before) qc.setQueryData<ProjectOverview[]>(PROJECTS_OVERVIEW_KEY, withProjectStatus(before, project.id, status));
  try {
    await (archiving ? send.archive(project.id) : send.update(project.id, status));
    return { ok: true };
  } catch (e) {
    if (before) qc.setQueryData<ProjectOverview[]>(PROJECTS_OVERVIEW_KEY, before);
    return { ok: false, message: isNetworkError(e) ? statusChangeProblem(e) : archiving ? ARCHIVE_TEXT.failed : statusChangeFailed(project.name) };
  } finally {
    void qc.invalidateQueries({ queryKey: ['projects'] });
    void qc.invalidateQueries({ queryKey: ['project', project.id] });
  }
}
