import type { AuditRecord, AuditRepository, CreateAuditData } from './audit-repository';

export interface AuditServiceDeps {
  audit: AuditRepository;
}

export function createAuditService({ audit }: AuditServiceDeps) {
  async function record(data: CreateAuditData): Promise<AuditRecord> {
    return audit.create(data);
  }
  async function list(limit?: number): Promise<AuditRecord[]> {
    return audit.list(limit);
  }
  return { record, list };
}

export type AuditService = ReturnType<typeof createAuditService>;
