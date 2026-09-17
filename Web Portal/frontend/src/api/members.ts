import type { ApiClient } from '../lib/api-client';

export type ProjectMemberRole = 'MEMBER' | 'MANAGER';

export interface ApiMember {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: ProjectMemberRole;
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
