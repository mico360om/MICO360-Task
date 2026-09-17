import type { PrismaClient } from '@prisma/client';
import type { OtpUserLookup } from './otp-service';

export function createPrismaOtpUserLookup(prisma: PrismaClient): OtpUserLookup {
  return {
    async findActiveByIdentifier(identifier) {
      const u = await prisma.user.findFirst({
        where: { OR: [{ email: identifier }, { username: identifier }], status: 'ACTIVE', deletedAt: null },
        include: { roles: { include: { role: true } } },
      });
      return u ? { id: u.id, email: u.email, roles: u.roles.map((r) => r.role.name) } : null;
    },
  };
}
