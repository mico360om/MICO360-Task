import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';

/**
 * Provision (or re-provision) a specific ADMIN user. Unlike `bootstrap` (which only
 * seeds the FIRST admin), this always ensures the given account exists, is ACTIVE,
 * has the ADMIN role, and has the given password. Idempotent.
 *
 *   npx tsx src/scripts/make-admin.ts
 */
async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL ?? 'khurram@prolens-team.com';
  const password = process.env.ADMIN_PASSWORD ?? 'Welcome@123';
  const firstName = process.env.ADMIN_FIRST_NAME ?? 'Khurram';
  const lastName = process.env.ADMIN_LAST_NAME ?? 'Admin';
  let username = process.env.ADMIN_USERNAME ?? email.split('@')[0]!;

  const passwordHash = await hashPassword(password);

  const role = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN', description: 'Full system access' },
  });

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  let userId: string;
  if (existing) {
    userId = existing.id;
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, status: 'ACTIVE', deletedAt: null, failedLoginAttempts: 0, lockedUntil: null },
    });
  } else {
    // Ensure the username is free; fall back to a suffixed one if taken.
    const clash = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (clash) username = `${username}-${Date.now().toString(36).slice(-4)}`;
    const created = await prisma.user.create({
      data: { email, username, passwordHash, firstName, lastName, status: 'ACTIVE' },
      select: { id: true },
    });
    userId = created.id;
  }

  // Ensure the ADMIN role link.
  const link = await prisma.userRole.findFirst({ where: { userId, roleId: role.id }, select: { userId: true } });
  if (!link) await prisma.userRole.create({ data: { userId, roleId: role.id } });

  console.log(`Admin ready: ${username} <${email}> (id ${userId}) — ${existing ? 'updated' : 'created'}.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
