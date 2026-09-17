import type { ApiClient } from '../lib/api-client';

export type ColumnCategory = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE';

export interface ApiColumn {
  id: string;
  projectId: string;
  name: string;
  category: ColumnCategory;
  position: number;
  color: string;
  enabled: boolean;
}

export interface NewColumnInput {
  name: string;
  category?: ColumnCategory;
  color?: string;
}
export type ColumnPatch = Partial<NewColumnInput> & { enabled?: boolean; position?: number };

export function columnsApi(client: ApiClient) {
  return {
    list: (projectId: string) => client.get<{ data: ApiColumn[] }>(`/projects/${projectId}/columns`).then((r) => r.data),
    add: (projectId: string, input: NewColumnInput) =>
      client.post<{ data: ApiColumn }>(`/projects/${projectId}/columns`, input).then((r) => r.data),
    update: (columnId: string, patch: ColumnPatch) =>
      client.put<{ data: ApiColumn }>(`/columns/${columnId}`, patch).then((r) => r.data),
    remove: (columnId: string) => client.del<void>(`/columns/${columnId}`),
  };
}
