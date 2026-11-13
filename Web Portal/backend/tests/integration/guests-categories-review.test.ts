import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { createGuestService } from '../../src/modules/guests/guest-service';
import { createCategoryService } from '../../src/modules/categories/category-service';
import { createExternalContactService } from '../../src/modules/tasks/external-contact-service';
import { createPrismaExternalContactRepository } from '../../src/modules/tasks/prisma-external-contact-repository';
import { createPrismaTaskLookup } from '../../src/modules/tasks/prisma-assignee-repository';
import { createTaskMergeService } from '../../src/modules/task-merge/merge-service';
import { healGuestsAndCategories, runGuestConversion } from '../../src/modules/guests/guest-conversion';
import { guestTextKey } from '../../src/modules/tasks/guest-contacts';

// 1.24 review fixes: what a project's viewers see of the company list, a shared project's other company,
// a merge across companies and its Undo, the "Every task needs a category" lock-out, history lines of the
// old way in, and the minute sweep's heals.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let world: CompanyWorld;
let api: CompanyApp;
const lines: { action: string; taskId: string }[] = [];
const notified: string[][] = [];
const guests = createGuestService({ prisma, recordActivity: async (e) => void lines.push(e), onAssigned: async (_t, ids) => void notified.push(ids) });
const categories = createCategoryService({ prisma });

beforeAll(async () => {
  await prisma.$connect();
  world = await buildCompanyWorld(prisma);
  await prisma.projectMember.updateMany({ where: { projectId: world.projects.PA, userId: world.people.ana }, data: { role: 'MANAGER' } });
  api = await buildCompanyApp(prisma, () => ({ guestService: guests, categoryService: categories }));
});
afterAll(async () => {
  await api.close();
  await prisma.guestContact.deleteMany({ where: { companyId: { in: Object.values(world.companies) } } });
  await dropCompanyWorld(prisma, world);
  await prisma.$disconnect();
});

describe('what a project’s viewers see of the guest list', () => {
  it('no admin notes, no creator — on the list, the duplicate check and a 409', async () => {
    const g = await guests.createForProject(world.projects.PA, { name: 'Noted Guest', company: 'Acme' }, world.people.ana);
    await guests.adminUpdate(g.id, { notes: 'Also recorded: phone 1 (SECRET-9)' });
    const list = (await api.get(world.as.ana, `/projects/${world.projects.PA}/guests?q=noted`)) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    for (const key of ['notes', 'createdById', 'mergedIntoId']) expect(list[0]).not.toHaveProperty(key);
    const check = (await api.post(world.as.ana, `/projects/${world.projects.PA}/guests/check`, { name: 'Noted Guest', company: 'acme' })).json() as { data: { same: Record<string, unknown>[] } };
    expect(check.data.same[0]).not.toHaveProperty('notes');
    const dup = (await api.post(world.as.ana, `/projects/${world.projects.PA}/guests`, { name: 'Noted Guest', company: 'Acme' })).json() as { error: { details: { matches: Record<string, unknown>[] } } };
    expect(dup.error.details.matches[0]).not.toHaveProperty('notes');
  });

  it('on a project shared with another company, its people see only the guests on that project’s tasks', async () => {
    const onIt = await guests.createForProject(world.projects.PAB, { name: 'Shared Sam', company: 'Acme', email: 'sam@acme.com' }, world.people.ana);
    await guests.createForProject(world.projects.PA, { name: 'Private Pat', company: 'Acme', email: 'pat@acme.com' }, world.people.ana);
    await guests.addToTask(world.tasks.TAB1, onIt.id, null, world.people.ben);
    // ana (company A, the list's company) sees the whole list; ben (company B only) sees Sam alone.
    const ana = ((await api.get(world.as.ana, `/projects/${world.projects.PAB}/guests`)) as { name: string }[]).map((g) => g.name);
    expect(ana).toEqual(expect.arrayContaining(['Private Pat', 'Shared Sam']));
    expect(((await api.get(world.as.ben, `/projects/${world.projects.PAB}/guests`)) as { name: string }[]).map((g) => g.name)).toEqual(['Shared Sam']);
    const check = (await api.post(world.as.ben, `/projects/${world.projects.PAB}/guests/check`, { name: 'Private Pat', company: 'Acme' })).json() as { data: { same: unknown[]; similar: unknown[] } };
    expect(check.data).toEqual({ same: [], similar: [] });
    // The app's suggestions and its "add a contact" follow the same rule: Pat's stored details never come back.
    const contacts = createExternalContactService({ repo: createPrismaExternalContactRepository(prisma), taskLookup: createPrismaTaskLookup(prisma) });
    expect(await contacts.suggest(world.projects.PAB, 'pat', { id: world.people.ben, roles: ['EMPLOYEE'] })).toEqual([]);
    const added = await contacts.add(world.tasks.TAB1, { name: 'Private Pat', company: 'Acme' }, world.people.ben);
    expect(added.email).toBeNull();
  });
});

describe('a merge across companies', () => {
  it('the same person on both companies’ lists stays on the merged task for Undo to give back', async () => {
    const merges = createTaskMergeService({ prisma, timeZone: 'Asia/Muscat', readFile: async () => null });
    const admin = world.as.admin;
    const a = await guests.createForProject(world.projects.PA, { name: 'Twin Ahmed', company: 'Acme' }, world.people.ana);
    const b = await guests.createForProject(world.projects.PB, { name: 'Twin Ahmed', company: 'Acme' }, world.people.ben);
    await guests.addToTask(world.tasks.TA1, a.id, null, world.people.ana);
    await guests.addToTask(world.tasks.TB1, b.id, 'from B', world.people.ben);
    const r = await merges.merge(admin, { taskIds: [world.tasks.TA1, world.tasks.TB1], mainTaskId: world.tasks.TA1, people: { [world.people.ben]: 'LEAVE_OFF' } as never });
    expect((await guests.taskGuests(world.tasks.TA1)).map((g) => g.guestId)).toEqual([a.id]);
    await merges.undo(admin, r.mergeId);
    expect((await guests.taskGuests(world.tasks.TB1)).map((g) => [g.guestId, g.note])).toEqual([[b.id, 'from B']]);
    expect((await guests.taskGuests(world.tasks.TA1)).map((g) => [g.guestId, g.note])).toEqual([[a.id, null]]);
  });
});

describe('“Every task needs a category” never locks a project out', () => {
  it('can’t be switched on without a category in use, nor its last one retired or deleted while on', async () => {
    const project = world.projects.PB;
    await expect(categories.setRequired(project, true)).rejects.toMatchObject({ status: 409, code: 'CATEGORY_NONE_ACTIVE' });
    const only = await categories.create(project, { name: 'Only one' }, world.people.ben);
    await categories.setRequired(project, true);
    await expect(categories.update(only.id, { retired: true })).rejects.toMatchObject({ status: 409, code: 'CATEGORY_NONE_ACTIVE' });
    await expect(categories.remove(only.id)).rejects.toMatchObject({ status: 409, code: 'CATEGORY_NONE_ACTIVE' });
    const second = await categories.create(project, { name: 'Second' }, world.people.ben);
    await categories.update(only.id, { retired: true });
    await categories.setRequired(project, false);
    await categories.remove(second.id);
  });
});

describe('the old way in writes true history', () => {
  it('adding a guest the task has already, or a change the re-link undid, writes no line', async () => {
    const contacts = createExternalContactService({ repo: createPrismaExternalContactRepository(prisma), taskLookup: createPrismaTaskLookup(prisma) });
    const first = await contacts.add(world.tasks.TA2, { name: 'Hist Hana', company: 'PDO', phone: '24000000' }, world.people.cat);
    const again = await contacts.add(world.tasks.TA2, { name: 'Hist Hana', company: 'PDO' }, world.people.cat);
    expect(again).toMatchObject({ id: first.id, alreadyOnTask: true });
    // Clearing the phone re-links to the same guest (name + company): nothing changed on the task.
    expect((await contacts.update(first.id, { phone: null }, world.people.cat)).changed).toBe(false);
  });
});

describe('the minute sweep heals', () => {
  it('an open task with guests and nobody from the team gets its person responsible (once); drifted rows show their guest again; a category of another project becomes this one’s by name', async () => {
    const g = await guests.createForProject(world.projects.PA, { name: 'Heal Hadi', company: 'Acme' }, world.people.ana);
    await guests.addToTask(world.tasks.TA2, g.id, null, world.people.cat);
    await prisma.taskAssignee.deleteMany({ where: { taskId: world.tasks.TA2 } });
    await prisma.taskExternalContact.updateMany({ where: { guestId: g.id }, data: { name: 'Old name' } });
    const pa = await categories.create(world.projects.PA, { name: 'Heal civil' }, world.people.ana);
    const pb = await categories.create(world.projects.PB, { name: 'heal civil' }, world.people.ben);
    await prisma.taskCategory.create({ data: { taskId: world.tasks.TA2, categoryId: pb.id } });
    const r = await runGuestConversion(prisma, (t, a, o) => guests.ensureResponsible(t, a, o));
    expect(r.responsible).toBeGreaterThanOrEqual(1);
    expect(await prisma.taskAssignee.count({ where: { taskId: world.tasks.TA2 } })).toBe(1);
    await healGuestsAndCategories(prisma);
    expect((await prisma.taskExternalContact.findFirstOrThrow({ where: { guestId: g.id } })).name).toBe('Heal Hadi');
    expect((await prisma.taskCategory.findMany({ where: { taskId: world.tasks.TA2 } })).map((c) => c.categoryId)).toEqual([pa.id]);
  });

  it('the person added by the old way in is told; the switch to guests tells nobody', async () => {
    notified.length = 0;
    const g = await guests.createForProject(world.projects.PA, { name: 'Tell Tom' }, world.people.ana);
    await prisma.taskAssignee.deleteMany({ where: { taskId: world.tasks.TA1 } });
    await prisma.taskExternalContact.create({ data: { taskId: world.tasks.TA1, guestId: g.id, name: 'Tell Tom' } });
    await guests.ensureResponsible(world.tasks.TA1, world.people.cat);
    expect(notified).toHaveLength(1);
    await prisma.taskAssignee.deleteMany({ where: { taskId: world.tasks.TA1 } });
    await guests.ensureResponsible(world.tasks.TA1, '', { auto: true });
    expect(notified).toHaveLength(1);
  });
});

describe('name keys fit their columns', () => {
  it('a 120-letter name of Arabic ligatures still makes a key of at most 191 characters', async () => {
    const name = 'ﷺ'.repeat(120);
    expect(guestTextKey(name).length).toBeGreaterThan(191);
    const g = await guests.createForProject(world.projects.PA, { name }, world.people.ana);
    expect((await prisma.guestContact.findUniqueOrThrow({ where: { id: g.id } })).nameKey.length).toBeLessThanOrEqual(191);
  });
});
