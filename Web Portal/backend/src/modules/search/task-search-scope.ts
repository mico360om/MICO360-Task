import { Prisma } from '@prisma/client';
import { LIVE_PROJECT_SQL } from '../companies/project-archive';

/** Who is searching. */
export interface SearchViewer {
  id: string;
  roles: string[];
  /** Manager View (an administrator's own): client portal accounts (the Clients page's) aren't found then. */
  managerView?: boolean;
}

/**
 * The tasks a person may find — the same as the tasks they may open: those of the projects they can
 * see (project-access: owner, named manager or on the team, inside one of their active companies; an
 * administrator sees every project) — and, with a picked company (X-Company-Id), only that company's
 * projects (an administrator: all of that company's). This and visibleTasksSql below are the one
 * place the visible-task filter is built for task search (the global search uses it too).
 */
export interface TaskSearchScope {
  /** Project ids the person may see; `null` = every project (an administrator). */
  projectIds: string[] | null;
}

export function createTaskSearchScope({ accessibleProjectIds }: { accessibleProjectIds?: (userId: string, roles: string[], pick?: string | null) => Promise<string[] | null> }) {
  return {
    /** companies: `pick` (the request's picked company, already checked) narrows to that company's projects. */
    async forViewer(viewer: SearchViewer, pick: string | null = null): Promise<TaskSearchScope> {
      return { projectIds: accessibleProjectIds ? await accessibleProjectIds(viewer.id, viewer.roles, pick) : null };
    },
  };
}

export type TaskSearchScopeResolver = ReturnType<typeof createTaskSearchScope>;

/**
 * The SQL condition for "a task this person may find", over tasks `t` and projects `p`: a live task
 * in a live project the scope allows — in an archived project only when `includeArchived`, or when
 * `archivedWhen` holds for the task (its exact number was searched for).
 */
export function visibleTasksSql(scope: TaskSearchScope, { includeArchived = false, archivedWhen }: { includeArchived?: boolean; archivedWhen?: Prisma.Sql } = {}): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`t.deletedAt IS NULL`, Prisma.sql`p.deletedAt IS NULL`];
  // companies: archived by its own status or by all its companies (LIVE_PROJECT_SQL).
  if (!includeArchived) parts.push(archivedWhen ? Prisma.sql`(${LIVE_PROJECT_SQL} OR ${archivedWhen})` : LIVE_PROJECT_SQL);
  if (scope.projectIds) parts.push(scope.projectIds.length ? Prisma.sql`t.projectId IN (${Prisma.join(scope.projectIds)})` : Prisma.sql`FALSE`);
  return Prisma.join(parts, ' AND ');
}
