import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaAuditRepository } from '../../src/modules/audit/prisma-audit-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. Only this file's entries
// (modules starting "amt-") are made and removed: the shared test database may hold others.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const audit = createPrismaAuditRepository(prisma);
const clean = () => prisma.auditLog.deleteMany({ where: { module: { startsWith: 'amt-' } } });

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe('The audit log’s modules (the module filter on Audit Logs)', () => {
  it('lists each module once, A–Z, however far back its entries are', async () => {
    await audit.create({ action: 'OLD', module: 'amt-projects' });
    for (let i = 0; i < 3; i++) await audit.create({ action: `NEW_${i}`, module: 'amt-settings' });
    await audit.create({ action: 'NEW', module: 'amt-ai' });
    // A page of the newest entries doesn't reach the oldest module …
    const page = (await audit.list({ limit: 4 })).filter((r) => r.module.startsWith('amt-'));
    expect(page.some((r) => r.module === 'amt-projects')).toBe(false);
    // … the module list does.
    expect((await audit.modules()).filter((m) => m.startsWith('amt-'))).toEqual(['amt-ai', 'amt-projects', 'amt-settings']);
  });
});
