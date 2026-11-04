import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaAuditRepository, createPrismaAuditTaskRefs } from '../../src/modules/audit/prisma-audit-repository';
import { createAuditService } from '../../src/modules/audit/audit-service';

// 1.22.3: the Audit page names a task's entries by the task's current number and title (also a task in
// the trash; one deleted for good keeps its raw id). Requires TEST_DATABASE_URL with migrations
// applied. Only this file's person (@atr.test), project (ATR…) and entries (module "atr-…") are made.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const svc = createAuditService({ audit: createPrismaAuditRepository(prisma), tasks: createPrismaAuditTaskRefs(prisma) });

async function clean() {
  await prisma.auditLog.deleteMany({ where: { module: { startsWith: 'atr-' } } });
  await prisma.task.deleteMany({ where: { project: { code: { startsWith: 'ATR' } } } });
  await prisma.project.deleteMany({ where: { code: { startsWith: 'ATR' } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@atr.test' } } });
}
beforeAll(async () => {
  await prisma.$connect();
  await clean();
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe('Audit page: a task’s entries name the task', () => {
  it('its number now and its title; the trash too; anything else, or a task gone for good, none', async () => {
    const ada = await prisma.user.create({ data: { email: 'ada@atr.test', username: 'atr-ada', passwordHash: 'x', firstName: 'Ada', lastName: 'T' } });
    const p = await prisma.project.create({ data: { code: 'ATRA', name: 'Audit refs', createdById: ada.id } });
    const col = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'To do', category: 'TODO', position: 0 } });
    const live = await prisma.task.create({ data: { key: 'ATRA-7', title: 'Fix the pump', projectId: p.id, columnId: col.id, createdById: ada.id } });
    const trashed = await prisma.task.create({ data: { key: 'ATRA-8', title: 'Old pump', projectId: p.id, columnId: col.id, createdById: ada.id, deletedAt: new Date() } });
    await svc.record({ module: 'atr-tasks', action: 'task.approve', entityId: live.id });
    await svc.record({ module: 'atr-tasks', action: 'task.delete', entityId: trashed.id });
    await svc.record({ module: 'atr-tasks', action: 'task.purge', entityId: 'gone-for-good' });
    await svc.record({ module: 'atr-projects', action: 'project.update', entityId: p.id });
    await prisma.task.update({ where: { id: live.id }, data: { key: 'ATRA-70' } }); // its number now
    const mine = (await svc.list({ limit: 200 })).filter((r) => r.module.startsWith('atr-'));
    const byAction = Object.fromEntries(mine.map((r) => [r.action, r.task]));
    expect(byAction).toEqual({
      'task.approve': { key: 'ATRA-70', title: 'Fix the pump' },
      'task.delete': { key: 'ATRA-8', title: 'Old pump' },
      'task.purge': null,
      'project.update': null,
    });
  });
});
