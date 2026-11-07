import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaPreferences } from '../../src/modules/users/user-preferences';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. Only this file's people
// (emails ending in @vis.test) are made and removed: the shared test database may hold others.
// 1.23.8 Visual consistency: Detailed rows (users.density), the collapsed side menu (users.sidebarCollapsed)
// and the board column width (users.boardColumnWidth) — each person's own, saved on their account.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const prefs = createPrismaPreferences(prisma);
const DOMAIN = '@vis.test';

async function person(name: string) {
  return prisma.user.create({ data: { email: `${name}${DOMAIN}`, username: `vis-${name}`, passwordHash: 'x', firstName: name, lastName: 'T' } });
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

describe('Detailed rows, the collapsed menu and board column width (1.23.8)', () => {
  it('everyone starts with the menu open and Normal columns (the migration’s defaults)', async () => {
    const ada = await person('ada');
    expect(await prefs.get(ada.id)).toEqual({ timeZone: null, weekStart: null, myProjectsOnly: false, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' });
    expect(await prisma.user.findUnique({ where: { id: ada.id }, select: { sidebarCollapsed: true, boardColumnWidth: true } })).toEqual({ sidebarCollapsed: false, boardColumnWidth: 'normal' });
  });

  it('each pick is saved on the account, the person’s alone, and the other settings stay', async () => {
    const ada = await person('ada');
    const bo = await person('bo');
    await prefs.set(ada.id, { weekStart: 1, density: 'compact' });
    expect(await prefs.set(ada.id, { density: 'detailed', sidebarCollapsed: true, boardColumnWidth: 'wide' })).toEqual({
      timeZone: null,
      weekStart: 1,
      myProjectsOnly: false,
      density: 'detailed',
      sidebarCollapsed: true,
      boardColumnWidth: 'wide',
    });
    expect(await prefs.get(bo.id)).toMatchObject({ density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' });
    await prefs.set(ada.id, { weekStart: 6 });
    expect(await prefs.get(ada.id)).toMatchObject({ weekStart: 6, density: 'detailed', sidebarCollapsed: true, boardColumnWidth: 'wide' });
    await prefs.set(ada.id, { boardColumnWidth: 'narrow', sidebarCollapsed: false });
    expect(await prefs.get(ada.id)).toMatchObject({ density: 'detailed', sidebarCollapsed: false, boardColumnWidth: 'narrow' });
  });

  it('an unexpected stored word reads as the default', async () => {
    const ada = await person('ada');
    await prisma.user.update({ where: { id: ada.id }, data: { density: 'spacious', boardColumnWidth: 'huge' } });
    expect(await prefs.get(ada.id)).toMatchObject({ density: 'comfortable', boardColumnWidth: 'normal' });
  });
});
