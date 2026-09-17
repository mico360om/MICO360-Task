export interface AuditRecord {
  id: string;
  userId: string | null;
  action: string;
  module: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
  createdAt: Date;
}

export interface CreateAuditData {
  userId?: string | null;
  action: string;
  module: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string | null;
}

export interface AuditRepository {
  create(data: CreateAuditData): Promise<AuditRecord>;
  list(limit?: number): Promise<AuditRecord[]>;
}
