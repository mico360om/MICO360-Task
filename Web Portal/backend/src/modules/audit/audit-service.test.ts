import { describe, it, expect } from 'vitest';
import { createAuditService } from './audit-service';
import type { AuditRecord, AuditRepository } from './audit-repository';

function inMemory(): AuditRepository {
  const rows: AuditRecord[] = [];
  let seq = 0;
  return {
    async create(data) {
      const a: AuditRecord = {
        id: `au${seq++}`,
        userId: data.userId ?? null,
        action: data.action,
        module: data.module,
        entityId: data.entityId ?? null,
        oldValue: data.oldValue ?? null,
        newValue: data.newValue ?? null,
        ip: data.ip ?? null,
        createdAt: new Date(),
      };
      rows.push(a);
      return a;
    },
    async list(limit) {
      return rows.slice().reverse().slice(0, limit ?? 100);
    },
  };
}

describe('AuditService', () => {
  it('records an audit entry and lists it (newest first)', async () => {
    const svc = createAuditService({ audit: inMemory() });
    await svc.record({ userId: 'admin', action: 'USER_CREATED', module: 'users', entityId: 'u9' });
    await svc.record({ userId: 'admin', action: 'PROJECT_CREATED', module: 'projects', entityId: 'p1' });
    const list = await svc.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.action).toBe('PROJECT_CREATED');
  });
});
