/**
 * Companies (spec §8): a project counts as archived when its own status is ARCHIVED, or when ALL of
 * its companies are archived (the server says so in `archived`; an older server leaves it out). Such
 * a project is read-only and stays out of the pickers, as an archived project always has.
 */
export function isProjectArchived(p: { status: string; archived?: boolean }): boolean {
  return p.archived === true || p.status === 'ARCHIVED';
}

/** Why a project takes no new tasks and no board changes (1.22.3 review), or null when it takes them. */
export type ProjectReadOnly = 'archived' | 'completed';

/**
 * 1.22.3 review: an archived project (its own status, or all its companies) and a completed one take
 * no new tasks or meetings — the project page's New task — and their board takes no changes: no New
 * task, no column "+", no Manage columns, no dragging. Null for any other project.
 */
export function projectReadOnly(p: { status: string; archived?: boolean }): ProjectReadOnly | null {
  if (isProjectArchived(p)) return 'archived';
  return p.status === 'COMPLETED' ? 'completed' : null;
}

/** What a read-only board says, in the words of the archived notice ("This project is archived — reopen it first."). */
export const READ_ONLY_NOTICE: Record<ProjectReadOnly, string> = {
  archived: 'This project is archived — reopen it first.',
  completed: 'This project is completed — reopen it first.',
};
