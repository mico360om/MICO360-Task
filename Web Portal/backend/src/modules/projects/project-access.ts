import type { ProjectManagerLookup } from './project-authz';

/** Read-side project access: who may *see* a project's data (owner / manager / creator / member). */
export interface ProjectAccessRepo {
  isAccessibleTo(projectId: string, userId: string): Promise<boolean>;
  listForUser(userId: string): Promise<{ id: string }[]>;
}

/** @deprecated Being assigned no longer grants access on its own; kept so older wiring still compiles. */
export interface TaskAssigneeLookup {
  isAssignee(taskId: string, userId: string): Promise<boolean>;
}

/**
 * Object-level view authorization (T2.7 companion to ProjectAuthz's manage checks). Admins see
 * everything; otherwise a user may see a project — and every task/column/comment under it — only
 * when they own, manage, created, or belong to that project. Task access follows the task's
 * project: being assigned is not a way in (assignees must be project members, and someone who
 * leaves the project loses its tasks). Deleted projects and tasks resolve to nothing.
 */
export function createProjectAccess({
  projects,
  managers,
}: {
  projects: ProjectAccessRepo;
  managers: Pick<ProjectManagerLookup, 'projectIdOfTask' | 'projectIdOfColumn'>;
  /** @deprecated Ignored — see TaskAssigneeLookup. */
  assignees?: TaskAssigneeLookup;
}) {
  const isAdmin = (roles: string[]) => roles.includes('ADMIN');

  async function canViewProject(userId: string, roles: string[], projectId: string): Promise<boolean> {
    if (isAdmin(roles)) return true;
    return projects.isAccessibleTo(projectId, userId);
  }
  async function canViewTask(userId: string, roles: string[], taskId: string): Promise<boolean> {
    if (isAdmin(roles)) return true;
    const projectId = await managers.projectIdOfTask(taskId);
    return projectId ? projects.isAccessibleTo(projectId, userId) : false;
  }
  async function canViewColumn(userId: string, roles: string[], columnId: string): Promise<boolean> {
    if (isAdmin(roles)) return true;
    const projectId = await managers.projectIdOfColumn(columnId);
    return projectId ? projects.isAccessibleTo(projectId, userId) : false;
  }
  /** Project ids a user may see — or `null` for an admin (meaning "all projects, no scoping"). */
  async function accessibleProjectIds(userId: string, roles: string[]): Promise<string[] | null> {
    if (isAdmin(roles)) return null;
    return (await projects.listForUser(userId)).map((p) => p.id);
  }

  return { canViewProject, canViewTask, canViewColumn, accessibleProjectIds };
}

export type ProjectAccess = ReturnType<typeof createProjectAccess>;
