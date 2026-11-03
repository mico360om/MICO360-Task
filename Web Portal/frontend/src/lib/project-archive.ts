/**
 * Companies (spec §8): a project counts as archived when its own status is ARCHIVED, or when ALL of
 * its companies are archived (the server says so in `archived`; an older server leaves it out). Such
 * a project is read-only and stays out of the pickers, as an archived project always has.
 */
export function isProjectArchived(p: { status: string; archived?: boolean }): boolean {
  return p.archived === true || p.status === 'ARCHIVED';
}
