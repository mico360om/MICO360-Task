import type { PrismaClient } from '@prisma/client';
import type { BootstrapUserRepo } from './bootstrap-service';

export function createPrismaBootstrapRepo(prisma: PrismaClient): BootstrapUserRepo {
  return {
    async anyAdminExists() {
      // Only an admin who can actually sign in counts — a deleted or deactivated one doesn't.
      const count = await prisma.user.count({
        where: { status: 'ACTIVE', deletedAt: null, roles: { some: { role: { name: 'ADMIN' } } } },
      });
      return count > 0;
    },
    async createAdmin(data) {
      const clash = await prisma.user.findFirst({ where: { OR: [{ email: data.email }, { username: data.username }] }, select: { id: true } });
      if (clash) {
        throw new Error('A user with this email or username already exists — run make-admin to restore it as an active administrator.');
      }
      // Ensure the ADMIN role exists, then create the user linked to it.
      const role = await prisma.role.upsert({
        where: { name: 'ADMIN' },
        update: {},
        create: { name: 'ADMIN', description: 'Full system access' },
      });
      // Companies: the first admin joins the oldest active company (on a fresh site, the one the
      // backfill made), which becomes their primary company.
      const company = await prisma.company.findFirst({ where: { status: 'ACTIVE' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
      const user = await prisma.user.create({
        data: {
          email: data.email,
          username: data.username,
          passwordHash: data.passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          status: 'ACTIVE',
          roles: { create: { roleId: role.id } },
          ...(company ? { primaryCompanyId: company.id, companies: { create: { companyId: company.id } } } : {}),
        },
        select: { id: true },
      });
      return { id: user.id };
    },
  };
}
