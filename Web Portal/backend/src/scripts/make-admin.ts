import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { isStrongPassword } from '../lib/password-policy';

/**
 * Provision (or re-provision) a specific ADMIN user. Unlike `bootstrap` (which only
 * seeds the FIRST admin), this always ensures the given account exists, is ACTIVE,
 * has the ADMIN role, and has the given password. Idempotent.
 *
 *   ADMIN_PASSWORD='…' [ADMIN_EMAIL=…] npx tsx src/scripts/make-admin.ts
 *
 * ADMIN_PASSWORD is required — there is deliberately no default, so the script can never
 * reset an admin to a password that is written down somewhere.
 */
async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL ?? 'khurram@prolens-team.com';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error('Set ADMIN_PASSWORD (8+ characters with a letter and a number) to provision the admin.');
    process.exit(1);
  }
  if (!isStrongPassword(password)) {
    console.error('ADMIN_PASSWORD is too weak: use at least 8 characters, including a letter and a number.');
    process.exit(1);
  }
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
    // New password: end every session and outstanding reset link that the old one allowed.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash, status: 'ACTIVE', deletedAt: null, failedLoginAttempts: 0, lockedUntil: null, tokenVersion: { increment: 1 } },
      }),
      prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.loginOtp.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } }),
    ]);
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
