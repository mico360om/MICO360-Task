import type { PrismaClient, Prisma } from '@prisma/client';
import type { AuditRepository, CreateAuditData } from './audit-repository';

export function createPrismaAuditRepository(prisma: PrismaClient): AuditRepository {
  return {
    async create(data: CreateAuditData) {
      const a = await prisma.auditLog.create({
        data: {
          userId: data.userId ?? undefined,
          action: data.action,
          module: data.module,
          entityId: data.entityId ?? undefined,
          oldValue: (data.oldValue as Prisma.InputJsonValue) ?? undefined,
          newValue: (data.newValue as Prisma.InputJsonValue) ?? undefined,
          ip: data.ip ?? undefined,
        },
      });
      return { id: a.id, userId: a.userId, action: a.action, module: a.module, entityId: a.entityId, oldValue: a.oldValue, newValue: a.newValue, ip: a.ip, createdAt: a.createdAt };
    },
    async list(limit) {
      const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit ?? 100 });
      return rows.map((a) => ({ id: a.id, userId: a.userId, action: a.action, module: a.module, entityId: a.entityId, oldValue: a.oldValue, newValue: a.newValue, ip: a.ip, createdAt: a.createdAt }));
    },
  };
}
