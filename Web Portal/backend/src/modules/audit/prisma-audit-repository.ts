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
    async list(q = {}) {
      // The cursor and the day range both bound createdAt from above: use the tighter one.
      const upper = [q.before, q.to].filter((d): d is Date => d instanceof Date).sort((a, b) => a.getTime() - b.getTime())[0];
      const createdAt = upper || q.from ? { ...(upper ? { lt: upper } : {}), ...(q.from ? { gte: q.from } : {}) } : undefined;
      const rows = await prisma.auditLog.findMany({
        where: {
          ...(q.module ? { module: q.module } : {}),
          ...(q.userId ? { userId: q.userId } : {}),
          ...(createdAt ? { createdAt } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit ?? 100,
      });
      return rows.map((a) => ({ id: a.id, userId: a.userId, action: a.action, module: a.module, entityId: a.entityId, oldValue: a.oldValue, newValue: a.newValue, ip: a.ip, createdAt: a.createdAt }));
    },
  };
}
