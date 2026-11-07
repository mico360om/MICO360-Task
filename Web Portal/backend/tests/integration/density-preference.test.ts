import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaPreferences } from '../../src/modules/users/user-preferences';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. Only this file's people
// (emails ending in @dens.test) are made and removed: the shared test database may hold others.
// 1.23.0 Compact / comfortable rows: each person's own, saved on their account (users.density).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const prefs = createPrismaPreferences(prisma);
const DOMAIN = '@dens.test';

async function person(name: string) {
  return prisma.user.create({ data: { email: `${name}${DOMAIN}`, username: `dens-${name}`, passwordHash: 'x', firstName: name, lastName: 'T' } });
}
async function clean() {
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
}

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe('Compact / comfortable rows (users.density)', () => {
  it('everyone starts comfortable — the look nothing changes for until they pick compact', async () => {
    const ada = await person('ada');
    expect(await prefs.get(ada.id)).toEqual({ timeZone: null, weekStart: null, myProjectsOnly: false, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' });
    expect((await prisma.user.findUnique({ where: { id: ada.id }, select: { density: true } }))?.density).toBe('comfortable');
  });

  it('a pick is saved on the account, the person’s alone, and the other settings stay', async () => {
    const ada = await person('ada');
    const bo = await person('bo');
    await prefs.set(ada.id, { weekStart: 1, timeZone: 'Asia/Muscat' });
    expect(await prefs.set(ada.id, { density: 'compact' })).toEqual({ timeZone: 'Asia/Muscat', weekStart: 1, myProjectsOnly: false, density: 'compact', sidebarCollapsed: false, boardColumnWidth: 'normal' });
    expect((await prefs.get(ada.id)).density).toBe('compact');
    expect((await prefs.get(bo.id)).density).toBe('comfortable');
    // Saving another setting later leaves it; back to comfortable.
    await prefs.set(ada.id, { weekStart: 6 });
    expect((await prefs.get(ada.id)).density).toBe('compact');
    expect((await prefs.set(ada.id, { density: 'comfortable' })).density).toBe('comfortable');
  });

  it('an unexpected stored word reads as comfortable', async () => {
    const ada = await person('ada');
    await prisma.user.update({ where: { id: ada.id }, data: { density: 'spacious' } });
    expect((await prefs.get(ada.id)).density).toBe('comfortable');
  });
});
