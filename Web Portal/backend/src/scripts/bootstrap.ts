import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { createBootstrapService } from '../modules/auth/bootstrap-service';
import { createPrismaBootstrapRepo } from '../modules/auth/prisma-bootstrap-repo';

/**
 * Production first-admin bootstrap (T2.9). Idempotent: creates an ADMIN from
 * env vars only if no admin exists yet. Run once after deploying:
 *   ADMIN_EMAIL=… ADMIN_USERNAME=… ADMIN_PASSWORD=… npm run bootstrap --workspace @mico360/backend
 */
async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !username || !password) {
    console.error('Set ADMIN_EMAIL, ADMIN_USERNAME and ADMIN_PASSWORD to bootstrap the first admin.');
    process.exit(1);
  }

  const svc = createBootstrapService({ users: createPrismaBootstrapRepo(prisma), hashPassword });
  const result = await svc.ensureFirstAdmin({
    email,
    username,
    password,
    firstName: process.env.ADMIN_FIRST_NAME ?? 'Admin',
    lastName: process.env.ADMIN_LAST_NAME ?? 'User',
  });

  if (result.created) console.log(`Created first admin ${username} <${email}> (id ${result.id}).`);
  else console.log('An admin already exists — nothing to do.');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
