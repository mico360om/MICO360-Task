import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { createGuestService } from '../../src/modules/guests/guest-service';
import { createCategoryService } from '../../src/modules/categories/category-service';
import { createPrismaTaskRepository, createPrismaProjectLookup } from '../../src/modules/tasks/prisma-task-repository';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createPrismaBinStore } from '../../src/modules/recycle-bin/prisma-bin-store';
import { createBinService, type BinViewer } from '../../src/modules/recycle-bin/bin-service';

// 1.24 × Recycle Bin (owner rule): a task in the bin still counts as using its categories, and its guests are
// never removed from the list while it is there; restoring brings both back as they were; erasing it for good
// takes its guest and category links with it (the guest and the category stay, and may then be removed).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const guests = createGuestService({ prisma });
const categories = createCategoryService({ prisma });
const tasks = createTaskService({ tasks: createPrismaTaskRepository(prisma), projects: createPrismaProjectLookup(prisma), timeZone: TZ });
const bin = createBinService({
  store: createPrismaBinStore(prisma),
  timeZone: TZ,
  adminScope: async () => null,
  isArchived: async () => false,
  canViewProject: async () => true,
  removeFile: async () => {},
  audit: async () => {},
  record: async () => {},
});
let world: CompanyWorld;
let admin: BinViewer;
let column: string;

async function binnedTaskWithGuestAndCategory(title: string) {
  const t = await tasks.createTask({ title, projectId: world.projects.PA, columnId: column, createdById: world.people.ana, assigneeIds: [world.people.ana] });
  const guest = await guests.createForProject(world.projects.PA, { name: `${title} guest`, company: 'Acme' }, world.people.ana);
  await guests.addToTask(t.id, guest.id, 'gate 3', world.people.ana);
  const category = await categories.create(world.projects.PA, { name: `${title} cat` }, world.people.ana);
  await categories.setForTask(t.id, [category.id], world.people.ana);
  await tasks.deleteTask(t.id, 'one', world.people.ana);
  return { task: t, guest, category };
}

beforeAll(async () => {
  await prisma.$connect();
  world = await buildCompanyWorld(prisma);
  admin = { id: world.people.admin, roles: ['ADMIN'] };
  column = (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: world.projects.PA } })).id;
});
afterAll(async () => {
  await prisma.guestContact.deleteMany({ where: { companyId: { in: Object.values(world.companies) } } });
  await dropCompanyWorld(prisma, world);
  await prisma.$disconnect();
});

describe('a task in the Recycle Bin keeps its guests and categories', () => {
  it('its category counts as used (no delete) and its guest can’t be removed from the list', async () => {
    const { task, guest, category } = await binnedTaskWithGuestAndCategory('Binned survey');
    await expect(categories.remove(category.id)).rejects.toMatchObject({ status: 409, code: 'CATEGORY_IN_USE' });
    const listed = (await categories.list(world.projects.PA, { usage: true })).categories.find((c) => c.id === category.id);
    expect(listed?.taskCount).toBe(1);
    await expect(guests.remove(guest.id)).rejects.toMatchObject({ status: 409, code: 'GUEST_IN_USE' });
    const row = (await guests.adminList({ companyId: world.companies.A })).find((g) => g.id === guest.id);
    expect(row?.taskCount).toBe(1);
    // The bin's read-only view names them.
    const detail = await bin.detail(admin, task.id);
    expect(detail.contacts).toEqual([{ name: 'Binned survey guest', company: 'Acme' }]);
    expect(detail.categories).toEqual([{ id: category.id, name: 'Binned survey cat', color: category.color, retired: false }]);
  });

  it('restoring brings back its guests (with their notes) and its categories', async () => {
    const { task, guest, category } = await binnedTaskWithGuestAndCategory('Restored survey');
    const result = await bin.restore(admin, [task.id], { wholeBatch: false });
    expect(result.restored.map((r) => r.id)).toEqual([task.id]);
    expect((await guests.taskGuests(task.id)).map((g) => [g.guestId, g.note])).toEqual([[guest.id, 'gate 3']]);
    expect((await categories.ofTask(task.id)).map((c) => c.id)).toEqual([category.id]);
  });

  it('erasing it for good takes its guest and category links; the guest and the category stay and may then go', async () => {
    const { task, guest, category } = await binnedTaskWithGuestAndCategory('Erased survey');
    expect((await bin.erase(admin, [task.id])).erased.map((e) => e.id)).toEqual([task.id]);
    expect(await prisma.task.count({ where: { id: task.id } })).toBe(0);
    expect(await prisma.taskExternalContact.count({ where: { taskId: task.id } })).toBe(0);
    expect(await prisma.taskCategory.count({ where: { taskId: task.id } })).toBe(0);
    expect(await prisma.guestContact.count({ where: { id: guest.id } })).toBe(1);
    expect(await prisma.projectCategory.count({ where: { id: category.id } })).toBe(1);
    await categories.remove(category.id);
    await guests.remove(guest.id);
    expect(await prisma.guestContact.count({ where: { id: guest.id } })).toBe(0);
    expect(await prisma.projectCategory.count({ where: { id: category.id } })).toBe(0);
  });
});
