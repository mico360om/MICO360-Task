import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaUserRepository } from '../../src/modules/auth/prisma-user-repository';
import { hashPassword } from '../../src/lib/password';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
});
const repo = createPrismaUserRepository(prisma);

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.userRole.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
});

async function seedUser(overrides: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: {
      email: 'ada@mico360.test',
      username: 'ada',
      passwordHash: await hashPassword('CorrectHorse1'),
      firstName: 'Ada',
      lastName: 'Lovelace',
      ...overrides,
    },
  });
}

describe('PrismaAuthUserRepository (integration)', () => {
  it('finds a user by email', async () => {
    await seedUser();
    const u = await repo.findByIdentifier('ada@mico360.test');
    expect(u?.username).toBe('ada');
  });

  it('finds a user by username', async () => {
    await seedUser();
    const u = await repo.findByIdentifier('ada');
    expect(u?.email).toBe('ada@mico360.test');
  });

  it('returns null for an unknown identifier', async () => {
    await seedUser();
    expect(await repo.findByIdentifier('nobody')).toBeNull();
  });

  it('applies a failed attempt and locks the account', async () => {
    const user = await seedUser();
    await repo.applyFailedAttempt(user.id, 5, true);
    const reloaded = await repo.findByIdentifier('ada');
    expect(reloaded?.failedLoginAttempts).toBe(5);
    expect(reloaded?.lockedUntil).not.toBeNull();
  });

  it('resets failed attempts and clears the lock', async () => {
    const user = await seedUser({ failedLoginAttempts: 3 });
    await repo.resetFailedAttempts(user.id);
    const reloaded = await repo.findByIdentifier('ada');
    expect(reloaded?.failedLoginAttempts).toBe(0);
    expect(reloaded?.lockedUntil).toBeNull();
  });
});
