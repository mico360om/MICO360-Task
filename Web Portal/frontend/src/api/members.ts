import type { ApiClient } from '../lib/api-client';

export type ProjectMemberRole = 'MEMBER' | 'MANAGER';

export interface ApiMember {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Their photo (null, or left out by an older server: initials). */
  avatarUrl?: string | null;
  role: ProjectMemberRole;
  /** companies: false when they're in none of the project's active companies any more, so they can't see it. Missing (older server): they can. */
  hasAccess?: boolean;
}

export function membersApi(client: ApiClient) {
  return {
    list: (projectId: string) => client.get<{ data: ApiMember[] }>(`/projects/${projectId}/members`).then((r) => r.data),
    add: (projectId: string, userId: string) =>
      client.post<{ data: ApiMember[] }>(`/projects/${projectId}/members`, { userIds: [userId] }).then((r) => r.data),
    setRole: (projectId: string, userId: string, role: ProjectMemberRole) =>
      client.patch<{ data: ApiMember[] }>(`/projects/${projectId}/members/${userId}`, { role }).then((r) => r.data),
    remove: (projectId: string, userId: string) => client.del<void>(`/projects/${projectId}/members/${userId}`),
  };
}
