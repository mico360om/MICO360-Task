export type ProjectMemberRole = 'MEMBER' | 'MANAGER';

export interface MemberUser {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: ProjectMemberRole;
}

export interface MemberRepository {
  list(projectId: string): Promise<MemberUser[]>;
  add(projectId: string, userId: string): Promise<void>;
  remove(projectId: string, userId: string): Promise<void>;
  setRole(projectId: string, userId: string, role: ProjectMemberRole): Promise<void>;
  /** True if the user still sees the project without membership (its owner or named manager, or an admin). */
  hasImplicitAccess?(projectId: string, userId: string): Promise<boolean>;
  /**
   * Take someone off the team (`{ remove: true }`) or change their role, refusing (409
   * LAST_PROJECT_MANAGER) when that would leave nobody active running the project: no active owner,
   * named manager or other MANAGER member. The check and the change are one transaction holding the
   * project's row, so two managers stepping down at once can't both go.
   */
  changeGuarded?(projectId: string, userId: string, change: { remove: true } | { role: ProjectMemberRole }): Promise<void>;
  /** Drop the user's task assignments and watches in the project, in one transaction. */
  removeTaskLinks?(projectId: string, userId: string): Promise<void>;
}

export interface ProjectExistsLookup {
  exists(projectId: string): Promise<boolean>;
}
