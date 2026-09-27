import type { ApiClient } from '../lib/api-client';

export interface ApiAuditLog {
  id: string;
  /** Who did it (null for system actions). */
  userId: string | null;
  action: string;
  module: string;
  entityId: string | null;
  /** Snapshot before / after the change (shape depends on the action). */
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string | null;
  createdAt: string;
}

export interface AuditQuery {
  /** Cursor: only entries created before this ISO instant (the oldest one already loaded). */
  before?: string;
  limit?: number;
  module?: string;
  userId?: string;
  /** Inclusive 'YYYY-MM-DD' day range (company time). */
  from?: string;
  to?: string;
}

export function auditApi(client: ApiClient) {
  return {
    /** Newest-first page of audit entries, optionally filtered and paged with `before`. */
    list: (q: AuditQuery = {}) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') qs.set(k, String(v));
      const s = qs.toString();
      return client.get<{ data: ApiAuditLog[] }>(`/audit-logs${s ? `?${s}` : ''}`).then((r) => r.data);
    },
  };
}
