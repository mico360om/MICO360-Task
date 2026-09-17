import type { PrismaClient } from '@prisma/client';
import type { BootstrapUserRepo } from './bootstrap-service';

export function createPrismaBootstrapRepo(prisma: PrismaClient): BootstrapUserRepo {
  return {
    async anyAdminExists() {
      const count = await prisma.user.count({ where: { roles: { some: { role: { name: 'ADMIN' } } } } });
      return count > 0;
    },
    async createAdmin(data) {
      // Ensure the ADMIN role exists, then create the user linked to it.
      const role = await prisma.role.upsert({
        where: { name: 'ADMIN' },
        update: {},
        create: { name: 'ADMIN', description: 'Full system access' },
      });
      const user = await prisma.user.create({
        data: {
          email: data.email,
          username: data.username,
          passwordHash: data.passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          status: 'ACTIVE',
          roles: { create: { roleId: role.id } },
        },
        select: { id: true },
      });
      return { id: user.id };
    },
  };
}
