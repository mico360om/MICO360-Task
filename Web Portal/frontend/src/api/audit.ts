import type { ApiClient } from '../lib/api-client';

export interface ApiAuditLog {
  id: string;
  userId: string | null;
  action: string;
  module: string;
  entityId: string | null;
  createdAt: string;
}

export function auditApi(client: ApiClient) {
  return {
    list: () => client.get<{ data: ApiAuditLog[] }>('/audit-logs').then((r) => r.data),
  };
}
