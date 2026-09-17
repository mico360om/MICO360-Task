import type { ApiClient } from '../lib/api-client';
import type { Priority } from './tasks';

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';

export interface ApiProject {
  id: string;
  code: string;
  name: string;
  description: string | null;
  clientName: string | null;
  status: ProjectStatus;
  priority: Priority;
  color: string;
  imageUrl: string | null;
  ownerId: string | null;
  startDate: string | null;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewProjectInput {
  code: string;
  name: string;
  description?: string;
  clientName?: string;
  status?: ProjectStatus;
  priority?: Priority;
  color?: string;
  ownerId?: string | null;
}

export function projectsApi(client: ApiClient) {
  return {
    list: () => client.get<{ data: ApiProject[] }>('/projects').then((r) => r.data),
    get: (id: string) => client.get<{ data: ApiProject }>(`/projects/${id}`).then((r) => r.data),
    create: (input: NewProjectInput) => client.post<{ data: ApiProject }>('/projects', input).then((r) => r.data),
    update: (id: string, patch: Partial<NewProjectInput>) => client.put<{ data: ApiProject }>(`/projects/${id}`, patch).then((r) => r.data),
    /** Soft-archive a project (sets status ARCHIVED). */
    archive: (id: string) => client.post<{ data: ApiProject }>(`/projects/${id}/archive`, {}).then((r) => r.data),
    remove: (id: string) => client.del<void>(`/projects/${id}`),
    /** Upload a project image (admin; returns the updated project). */
    uploadImage: (id: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      return client.upload<{ data: ApiProject }>(`/projects/${id}/image`, form).then((r) => r.data);
    },
    removeImage: (id: string) => client.del<{ data: ApiProject }>(`/projects/${id}/image`).then((r) => r.data),
  };
}

export const PROJECT_STATUSES: ProjectStatus[] = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'];
export const projectStatusLabel = (s: ProjectStatus): string =>
  ({ PLANNING: 'Planning', ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived' })[s];

export type ProjectsApi = ReturnType<typeof projectsApi>;
