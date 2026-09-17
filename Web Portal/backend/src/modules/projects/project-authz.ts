export interface ProjectManagerLookup {
  /** True if the user is a MANAGER member of the project. */
  isManager(userId: string, projectId: string): Promise<boolean>;
  projectIdOfColumn(columnId: string): Promise<string | null>;
  projectIdOfTask(taskId: string): Promise<string | null>;
}

/**
 * Per-project authorization (T2.7, decision D1 = per-project grant). Admins can
 * manage everything; otherwise a user may manage a project only if they are a
 * MANAGER member of that specific project.
 */
export function createProjectAuthz({ managers }: { managers: ProjectManagerLookup }) {
  const isAdmin = (roles: string[]) => roles.includes('ADMIN');

  async function canManageProject(userId: string, roles: string[], projectId: string): Promise<boolean> {
    if (isAdmin(roles)) return true;
    return managers.isManager(userId, projectId);
  }
  async function canManageColumn(userId: string, roles: string[], columnId: string): Promise<boolean> {
    if (isAdmin(roles)) return true;
    const projectId = await managers.projectIdOfColumn(columnId);
    return projectId ? managers.isManager(userId, projectId) : false;
  }
  async function canManageTask(userId: string, roles: string[], taskId: string): Promise<boolean> {
    if (isAdmin(roles)) return true;
    const projectId = await managers.projectIdOfTask(taskId);
    return projectId ? managers.isManager(userId, projectId) : false;
  }

  return { canManageProject, canManageColumn, canManageTask };
}

export type ProjectAuthz = ReturnType<typeof createProjectAuthz>;
