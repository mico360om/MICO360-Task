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
  /** True if the user still sees the project without membership (its owner, manager or creator, or an admin). */
  hasImplicitAccess?(projectId: string, userId: string): Promise<boolean>;
  /** Drop the user's task assignments and watches in the project, in one transaction. */
  removeTaskLinks?(projectId: string, userId: string): Promise<void>;
}

export interface ProjectExistsLookup {
  exists(projectId: string): Promise<boolean>;
}
