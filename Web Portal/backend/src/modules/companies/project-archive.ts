import { Prisma } from '@prisma/client';
import { LIVE_PROJECT_WHERE } from './company-access';
import { isProjectArchived, type CompanyStatus } from './company-rules';

/**
 * Companies: when a project counts as archived — its own status is ARCHIVED, or every one of its
 * companies is (isProjectArchived). Nothing is written onto the project: unarchiving the company
 * restores it. Every "is this project archived?" on the server asks one of these, never the stored
 * status alone:
 *   - a row already read: `archivedOf` (select ARCHIVE_SELECT / include ARCHIVE_INCLUDE with it);
 *   - a record a repository already worked out (its `archived`): `projectArchived`;
 *   - a query: `liveProjectWhere` (Prisma) or `liveProjectSql` (raw SQL over projects `p`).
 */

/** What archivedOf reads: the project's own status and its companies' statuses. */
export const ARCHIVE_SELECT = { status: true, companies: { select: { company: { select: { status: true } } } } } as const satisfies Prisma.ProjectSelect;

/** The companies part of ARCHIVE_SELECT, for a query that reads the whole project row. */
export const ARCHIVE_INCLUDE = { companies: ARCHIVE_SELECT.companies } as const satisfies Prisma.ProjectInclude;

/** A project read with ARCHIVE_SELECT (or ARCHIVE_INCLUDE): is it archived? */
export function archivedOf(p: { status: string; companies: readonly { company: { status: CompanyStatus } }[] }): boolean {
  return isProjectArchived({ status: p.status, companies: p.companies.map((c) => c.company) });
}

/**
 * A project record whose repository already worked it out (`archived`); without it (a test double),
 * its own status decides.
 */
export function projectArchived(p: { status: string; archived?: boolean }): boolean {
  return p.archived ?? p.status === 'ARCHIVED';
}

/** Live projects (not archived by either rule), optionally within `base`. */
export function liveProjectWhere(base?: Prisma.ProjectWhereInput): Prisma.ProjectWhereInput {
  return base ? { AND: [base, LIVE_PROJECT_WHERE] } : LIVE_PROJECT_WHERE;
}

/** The same rule as raw SQL, over a projects row aliased `p` (the task search index). */
export const LIVE_PROJECT_SQL = Prisma.sql`(p.status <> 'ARCHIVED' AND (NOT EXISTS (SELECT 1 FROM project_companies lpc WHERE lpc.projectId = p.id) OR EXISTS (SELECT 1 FROM project_companies lpc JOIN companies lc ON lc.id = lpc.companyId WHERE lpc.projectId = p.id AND lc.status = 'ACTIVE')))`;

/** The opposite of LIVE_PROJECT_SQL: archived by its own status or by all its companies. */
export const ARCHIVED_PROJECT_SQL = Prisma.sql`(NOT ${LIVE_PROJECT_SQL})`;
