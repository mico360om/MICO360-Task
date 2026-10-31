import { Prisma } from '@prisma/client';

/** Who is searching. */
export interface SearchViewer {
  id: string;
  roles: string[];
}

/**
 * The tasks a person may find — the same as the tasks they may open: those of the projects they can
 * see (project-access: owner, named manager or on the team; an administrator sees every project).
 * Multi-company work adds its "only the picked companies" here, and in visibleTasksSql below — the
 * one place the visible-task filter is built for task search.
 */
export interface TaskSearchScope {
  /** Project ids the person may see; `null` = every project (an administrator). */
  projectIds: string[] | null;
}

export function createTaskSearchScope({ accessibleProjectIds }: { accessibleProjectIds?: (userId: string, roles: string[]) => Promise<string[] | null> }) {
  return {
    async forViewer(viewer: SearchViewer): Promise<TaskSearchScope> {
      return { projectIds: accessibleProjectIds ? await accessibleProjectIds(viewer.id, viewer.roles) : null };
    },
  };
}

export type TaskSearchScopeResolver = ReturnType<typeof createTaskSearchScope>;

/**
 * The SQL condition for "a task this person may find", over tasks `t` and projects `p`: a live task
 * in a live project the scope allows — in an archived project only when `includeArchived`.
 */
export function visibleTasksSql(scope: TaskSearchScope, { includeArchived = false }: { includeArchived?: boolean } = {}): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`t.deletedAt IS NULL`, Prisma.sql`p.deletedAt IS NULL`];
  if (!includeArchived) parts.push(Prisma.sql`p.status <> 'ARCHIVED'`);
  if (scope.projectIds) parts.push(scope.projectIds.length ? Prisma.sql`t.projectId IN (${Prisma.join(scope.projectIds)})` : Prisma.sql`FALSE`);
  return Prisma.join(parts, ' AND ');
}
