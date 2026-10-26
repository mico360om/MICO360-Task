export interface ProjectManagerLookup {
  /**
   * True if the user runs the project: its owner, its named manager or a MANAGER member of its
   * team (`managesProject` in project-managers — the one definition every check uses).
   */
  managesProject(userId: string, projectId: string): Promise<boolean>;
  /** Of these projects, the ones the user runs (same rule) — one lookup for a whole list. */
  managedAmong?(userId: string, projectIds: string[]): Promise<string[]>;
  projectIdOfColumn(columnId: string): Promise<string | null>;
  projectIdOfTask(taskId: string): Promise<string | null>;
}

/**
 * Per-project authorization (T2.7, decision D1 = per-project grant). Admins can manage everything;
 * otherwise a user may manage a project — edit it, run its team and board columns, delete its
 * tasks — only if they run that specific project: its owner, its named manager or a MANAGER member.
 */
export function createProjectAuthz({ managers }: { managers: ProjectManagerLookup }) {
  const isAdmin = (roles: string[]) => roles.includes('ADMIN');

  async function canManageProject(userId: string, roles: string[], projectId: string): Promise<boolean> {
    if (isAdmin(roles)) return true;
    return managers.managesProject(userId, projectId);
  }
  async function canManageColumn(userId: string, roles: string[], columnId: string): Promise<boolean> {
    if (isAdmin(roles)) return true;
    const projectId = await managers.projectIdOfColumn(columnId);
    return projectId ? managers.managesProject(userId, projectId) : false;
  }
  async function canManageTask(userId: string, roles: string[], taskId: string): Promise<boolean> {
    if (isAdmin(roles)) return true;
    const projectId = await managers.projectIdOfTask(taskId);
    return projectId ? managers.managesProject(userId, projectId) : false;
  }
  /** Which of these projects the user may manage (every one for an admin). */
  async function manageableProjectIds(userId: string, roles: string[], projectIds: string[]): Promise<Set<string>> {
    if (isAdmin(roles)) return new Set(projectIds);
    if (projectIds.length === 0) return new Set();
    if (managers.managedAmong) return new Set(await managers.managedAmong(userId, projectIds));
    const runs = await Promise.all(projectIds.map((id) => managers.managesProject(userId, id)));
    return new Set(projectIds.filter((_, i) => runs[i]));
  }

  return { canManageProject, canManageColumn, canManageTask, manageableProjectIds };
}

export type ProjectAuthz = ReturnType<typeof createProjectAuthz>;
