/**
 * Who manages a project: its owner, its named manager, or a MANAGER member of its team.
 * Administrators manage every project (callers check that first). One definition for every place
 * that needs it — moving tasks between projects, managing a project's meetings — so they agree.
 */
export interface ProjectManagers {
  ownerId: string | null;
  managerId: string | null;
  members: { userId: string; role: string }[];
}

export function managesProject(project: ProjectManagers, userId: string): boolean {
  return project.ownerId === userId || project.managerId === userId || project.members.some((m) => m.userId === userId && m.role === 'MANAGER');
}

/** The same rule as a Prisma filter on projects. */
export function managedProjectsWhere(userId: string) {
  return { OR: [{ ownerId: userId }, { managerId: userId }, { members: { some: { userId, role: 'MANAGER' as const } } }] };
}
