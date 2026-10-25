import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createPrismaUserRepository as createAuthUsers } from '../../src/modules/auth/prisma-user-repository';
import { createPrismaUserRepository as createUserMgmt } from '../../src/modules/users/prisma-user-repository';
import { createPrismaDataExporter } from '../../src/modules/users/data-export';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. Only this file's people
// (emails ending in @lsi.test) are made and removed: the shared test database may hold others.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const authUsers = createAuthUsers(prisma);
const userMgmt = createUserMgmt(prisma);
const DOMAIN = '@lsi.test';

async function person(name: string) {
  return prisma.user.create({ data: { email: `${name}${DOMAIN}`, username: `lsi-${name}`, passwordHash: 'x', firstName: name, lastName: 'T' } });
}
async function clean() {
  const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe('Last sign-in (users.lastLoginAt)', () => {
  it('a sign-in is recorded, and User Management’s list and details show it (null: never signed in)', async () => {
    const ada = await person('ada');
    const bo = await person('bo');
    const at = new Date('2026-10-24T05:12:00.000Z');
    await authUsers.recordSignIn!(ada.id, at);
    const list = (await userMgmt.list()).filter((u) => u.email.endsWith(DOMAIN));
    const byName = Object.fromEntries(list.map((u) => [u.username, u.lastLoginAt]));
    expect(byName['lsi-ada']?.toISOString()).toBe(at.toISOString());
    expect(byName['lsi-bo']).toBeNull();
    expect((await userMgmt.findById(ada.id))?.lastLoginAt?.toISOString()).toBe(at.toISOString());
    expect((await userMgmt.findById(bo.id))?.welcomeSentAt).toBeNull();
  });

  it('“Download my data” includes the last sign-in and the welcome email time', async () => {
    const ada = await person('ada');
    const at = new Date('2026-10-24T05:12:00.000Z');
    await authUsers.recordSignIn!(ada.id, at);
    const data = (await createPrismaDataExporter(prisma)(ada.id)) as { profile: Record<string, unknown> };
    expect(data.profile.lastLoginAt).toEqual(at);
    expect(data.profile).toHaveProperty('welcomeSentAt', null);
  });

  it('recording a sign-in leaves the rest of the account alone (no password, lock or token version change)', async () => {
    const ada = await person('ada');
    await prisma.user.update({ where: { id: ada.id }, data: { failedLoginAttempts: 2, tokenVersion: 4 } });
    await authUsers.recordSignIn!(ada.id, new Date());
    const row = await prisma.user.findUniqueOrThrow({ where: { id: ada.id } });
    expect({ hash: row.passwordHash, attempts: row.failedLoginAttempts, ver: row.tokenVersion }).toEqual({ hash: 'x', attempts: 2, ver: 4 });
  });

  it('the migration fills in existing people’s last sign-in from their sign-in sessions (a refresh is not a sign-in)', async () => {
    const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
    const folder = readdirSync(dir).find((d) => d.endsWith('_last_sign_in_and_welcome'));
    expect(folder).toBeDefined();
    const sql = readFileSync(join(dir, folder!, 'migration.sql'), 'utf8');
    const backfill = sql.split(';').map((s) => s.replace(/^\s*--.*$/gm, '').trim()).find((s) => /^UPDATE/i.test(s));
    expect(backfill).toBeDefined();

    const ada = await person('ada');
    const bo = await person('bo');
    const cy = await person('cy');
    const t = (iso: string) => new Date(iso);
    const token = (userId: string, familyId: string | null, createdAt: Date, purpose: string | null = null) =>
      prisma.refreshToken.create({ data: { userId, tokenHash: `lsi-${Math.random()}`, expiresAt: t('2027-01-01T00:00:00Z'), familyId, createdAt, purpose } });
    // Ada signed in on the 20th and refreshed until the 23rd; signed in again on the 22nd (a second phone).
    await token(ada.id, 'fam-a1', t('2026-10-20T08:00:00Z'));
    await token(ada.id, 'fam-a1', t('2026-10-23T08:00:00Z'));
    await token(ada.id, 'fam-a2', t('2026-10-22T09:30:00Z'));
    // Bo only has a fingerprint key (made while signed in on the 21st) and a session from the 19th.
    await token(bo.id, 'fam-b1', t('2026-10-19T07:00:00Z'));
    await token(bo.id, null, t('2026-10-21T07:00:00Z'), 'biometric');
    // Cy never signed in.
    await prisma.$executeRawUnsafe(backfill!);

    const last = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).lastLoginAt?.toISOString() ?? null;
    expect(await last(ada.id)).toBe('2026-10-22T09:30:00.000Z');
    expect(await last(bo.id)).toBe('2026-10-19T07:00:00.000Z');
    expect(await last(cy.id)).toBeNull();
  });
});
