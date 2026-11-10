import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { createGuestService } from '../../src/modules/guests/guest-service';
import { createCategoryService } from '../../src/modules/categories/category-service';
import { createAssigneeService } from '../../src/modules/tasks/assignee-service';
import { createPrismaAssigneeRepository, createPrismaTaskLookup } from '../../src/modules/tasks/prisma-assignee-repository';
import { createExternalContactService } from '../../src/modules/tasks/external-contact-service';
import { createPrismaExternalContactRepository } from '../../src/modules/tasks/prisma-external-contact-repository';

// 1.24 Guests and task categories through the real routes (buildApp over Prisma, wired as server.ts wires them).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let world: CompanyWorld;
let api: CompanyApp;
const lines: { action: string; taskId: string }[] = [];

const json = <T = Record<string, unknown>>(res: { json(): unknown }) => (res.json() as { data: T }).data;
async function del(viewer: { id: string; roles: string[] }, path: string) {
  return api.app.inject({ method: 'DELETE', url: `/api/v1${path}`, headers: { authorization: await api.bearer(viewer) } });
}
async function patch(viewer: { id: string; roles: string[] }, path: string, body: unknown) {
  return api.app.inject({ method: 'PATCH', url: `/api/v1${path}`, payload: body as object, headers: { authorization: await api.bearer(viewer) } });
}

beforeAll(async () => {
  await prisma.$connect();
  world = await buildCompanyWorld(prisma);
  // ana runs PA (a MANAGER member); cat is a plain member.
  await prisma.projectMember.updateMany({ where: { projectId: world.projects.PA, userId: world.people.ana }, data: { role: 'MANAGER' } });
  const recordActivity = async (e: { taskId: string; action: string }) => void lines.push(e);
  const guestService = createGuestService({ prisma, recordActivity });
  const categoryService = createCategoryService({ prisma, recordActivity });
  api = await buildCompanyApp(prisma, () => ({
    guestService,
    categoryService,
    assigneeService: createAssigneeService({
      repo: createPrismaAssigneeRepository(prisma),
      taskLookup: createPrismaTaskLookup(prisma),
      beforeUnassign: (taskId, ids) => guestService.assertTeamStays(taskId, ids),
    }),
    externalContactService: createExternalContactService({
      repo: createPrismaExternalContactRepository(prisma),
      taskLookup: createPrismaTaskLookup(prisma),
      ensureResponsible: (taskId, actorId) => guestService.ensureResponsible(taskId, actorId),
    }),
  }));
});
afterAll(async () => {
  await api.close();
  await prisma.guestContact.deleteMany({ where: { companyId: { in: Object.values(world.companies) } } });
  await dropCompanyWorld(prisma, world);
  await prisma.$disconnect();
});

const columnOf = async (projectId: string) => (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId } })).id;

describe('guests through the routes', () => {
  it('a member adds a guest to the project’s company list; the same person again is offered back', async () => {
    const made = await api.post(world.as.ana, `/projects/${world.projects.PA}/guests`, { name: 'Ahmed Al Harthy', company: 'OXY', email: 'ahmed@oxy.com' });
    expect(made.statusCode).toBe(201);
    const again = await api.post(world.as.ana, `/projects/${world.projects.PAB}/guests`, { name: 'ahmed al harthy', company: 'oxy' });
    expect(again.statusCode).toBe(409);
    expect((again.json() as { error: { code: string } }).error.code).toBe('GUEST_DUPLICATE');
    const check = json<{ same: unknown[] }>(await api.post(world.as.cat, `/projects/${world.projects.PA}/guests/check`, { name: 'Ahmed Al Harthy', email: 'AHMED@oxy.com' }));
    expect(check.same).toHaveLength(1);
  });

  it('another company never sees this company’s guests; someone outside the project is refused', async () => {
    expect(await api.get(world.as.ben, `/projects/${world.projects.PB}/guests`)).toEqual([]);
    expect((await api.getRaw(world.as.ben, `/projects/${world.projects.PA}/guests`)).statusCode).toBe(403);
    expect((await api.post(world.as.bob, `/projects/${world.projects.PA}/guests`, { name: 'Sneaky' })).statusCode).toBe(403);
  });

  it('a new task with a guest needs a person from the team (400); with one, the guest is on it', async () => {
    const [ahmed] = (await api.get(world.as.ana, `/projects/${world.projects.PA}/guests`)) as { id: string }[];
    const column = await columnOf(world.projects.PA);
    const refused = await api.post(world.as.ana, '/tasks', { title: 'Rig check', projectId: world.projects.PA, columnId: column, assigneeIds: [], guests: [{ guestId: ahmed!.id }] });
    expect(refused.statusCode).toBe(400);
    expect((refused.json() as { error: { message: string } }).error.message).toBe('Add at least one person from your team to look after this task.');
    const made = await api.post(world.as.ana, '/tasks', { title: 'Rig check', projectId: world.projects.PA, columnId: column, assigneeIds: [world.people.ana], guests: [{ guestId: ahmed!.id, note: 'Signs off' }] });
    expect(made.statusCode).toBe(201);
    const id = json<{ id: string }>(made).id;
    const one = (await api.get(world.as.cat, `/tasks/${id}`)) as { guests: { id: string }[]; taskGuests: { guestId: string; note: string }[] };
    expect(one.guests.map((g) => g.id)).toEqual([ahmed!.id]);
    expect(one.taskGuests[0]).toMatchObject({ guestId: ahmed!.id, note: 'Signs off' });
    // The list filter by guest and by guest company.
    expect(((await api.get(world.as.ana, `/tasks?projectId=${world.projects.PA}&guestId=${ahmed!.id}`)) as { id: string }[]).map((t) => t.id)).toEqual([id]);
    expect(((await api.get(world.as.ana, `/tasks?projectId=${world.projects.PA}&guestCompany=oxy`)) as { id: string }[]).map((t) => t.id)).toEqual([id]);
    // Taking its only team member off is refused while it has the guest.
    const off = await del(world.as.ana, `/tasks/${id}/assignees/${world.people.ana}`);
    expect(off.statusCode).toBe(400);
    // The task's guests: note, remove, add again.
    expect((await patch(world.as.cat, `/tasks/${id}/guests/${ahmed!.id}`, { note: 'x'.repeat(1001) })).statusCode).toBe(400);
    expect((await patch(world.as.cat, `/tasks/${id}/guests/${ahmed!.id}`, { note: 'Calls first' })).statusCode).toBe(200);
    expect((await del(world.as.cat, `/tasks/${id}/guests/${ahmed!.id}`)).statusCode).toBe(204);
    expect((await api.post(world.as.cat, `/tasks/${id}/guests`, { guestId: ahmed!.id })).statusCode).toBe(201);
    // Someone who can't see the task learns nothing.
    expect((await api.post(world.as.ben, `/tasks/${id}/guests`, { guestId: ahmed!.id })).statusCode).toBe(404);
    expect((await api.getRaw(world.as.ben, `/tasks/${id}/guests`)).statusCode).toBe(404);
  });

  it('the old way in (app, extension): a contact on a task with no team member is accepted, its creator added', async () => {
    const column = await columnOf(world.projects.PA);
    const made = await api.post(world.as.cat, '/tasks', { title: 'From the app', projectId: world.projects.PA, columnId: column, assigneeIds: [], externalContacts: [{ name: 'Sara Nasser', company: 'PDO' }] });
    expect(made.statusCode).toBe(201);
    const task = json<{ id: string; assignees: { id: string }[] }>(made);
    expect(task.assignees.map((a) => a.id)).toEqual([world.people.cat]);
    const contacts = (await api.get(world.as.cat, `/tasks/${task.id}/external-contacts`)) as { name: string }[];
    expect(contacts.map((c) => c.name)).toEqual(['Sara Nasser']);
    expect(((await api.get(world.as.ana, `/projects/${world.projects.PA}/guests?q=sara`)) as { name: string }[]).map((g) => g.name)).toEqual(['Sara Nasser']);
  });

  it('the Guest contacts page is for admins only', async () => {
    expect((await api.getRaw(world.as.ana, '/guests')).statusCode).toBe(403);
    const rows = (await api.get(world.as.admin, `/guests?companyId=${world.companies.A}`)) as { name: string; taskCount: number; companyName: string }[];
    expect(rows.map((g) => g.name)).toEqual(['Ahmed Al Harthy', 'Sara Nasser']);
    expect(rows[0]!.taskCount).toBe(1);
    const ahmed = (rows as unknown as { id: string }[])[0]!;
    expect((await del(world.as.admin, `/guests/${ahmed.id}`)).statusCode).toBe(409);
    expect((await api.put(world.as.ana, `/guests/${ahmed.id}`, { name: 'X' })).statusCode).toBe(403);
    expect((await api.put(world.as.admin, `/guests/${ahmed.id}`, { designation: 'Site lead' })).statusCode).toBe(200);
  });

  it('never makes a sign-in: a guest’s email can’t sign in or be found as a user', async () => {
    expect(await prisma.user.count({ where: { email: 'ahmed@oxy.com' } })).toBe(0);
  });
});

describe('categories through the routes', () => {
  let civil = '';
  let hse = '';
  it('the project’s managers and admins look after the list; members read it; others are refused', async () => {
    const add = await api.post(world.as.ana, `/projects/${world.projects.PA}/categories`, { name: 'Civil', color: 'teal' });
    expect(add.statusCode).toBe(201);
    civil = json<{ id: string }>(add).id;
    hse = json<{ id: string }>(await api.post(world.as.admin, `/projects/${world.projects.PA}/categories`, { name: 'HSE' })).id;
    expect((await api.post(world.as.ana, `/projects/${world.projects.PA}/categories`, { name: ' civil ' })).statusCode).toBe(409);
    expect((await api.post(world.as.cat, `/projects/${world.projects.PA}/categories`, { name: 'Mine' })).statusCode).toBe(403);
    expect((await api.post(world.as.ben, `/projects/${world.projects.PA}/categories`, { name: 'Mine' })).statusCode).toBe(404);
    expect((await api.put(world.as.cat, `/project-categories/${civil}`, { name: 'Renamed' })).statusCode).toBe(403);
    expect((await api.put(world.as.ben, `/project-categories/${civil}`, { name: 'Renamed' })).statusCode).toBe(404);
    expect((await api.post(world.as.ana, `/projects/${world.projects.PA}/categories`, { name: 'x'.repeat(41) })).statusCode).toBe(400);
    expect((await api.post(world.as.ana, `/projects/${world.projects.PA}/categories`, { name: 'Bad', color: '#ff0000' })).statusCode).toBe(400);
    const list = (await api.get(world.as.cat, `/projects/${world.projects.PA}/categories`)) as { categories: { name: string; taskCount?: number }[]; canManage: boolean };
    expect(list.categories.map((c) => c.name)).toEqual(['Civil', 'HSE']);
    expect(list.canManage).toBe(false);
    expect(list.categories[0]!.taskCount).toBeUndefined();
    expect((await api.put(world.as.ana, `/projects/${world.projects.PA}/categories/order`, { orderedIds: [hse, civil] })).statusCode).toBe(200);
  });

  it('“Every task needs a category”: the website’s saves need one; the app’s (no field) are accepted', async () => {
    expect((await api.put(world.as.cat, `/projects/${world.projects.PA}/category-settings`, { requireCategory: true })).statusCode).toBe(403);
    expect((await api.put(world.as.ana, `/projects/${world.projects.PA}/category-settings`, { requireCategory: true })).statusCode).toBe(200);
    const column = await columnOf(world.projects.PA);
    const none = await api.post(world.as.cat, '/tasks', { title: 'No category', projectId: world.projects.PA, columnId: column, categoryIds: [] });
    expect(none.statusCode).toBe(400);
    expect((none.json() as { error: { message: string } }).error.message).toBe('Pick at least one category.');
    const app = await api.post(world.as.cat, '/tasks', { title: 'From the app', projectId: world.projects.PA, columnId: column });
    expect(app.statusCode).toBe(201);
    expect(json<{ categories: unknown[] }>(app).categories).toEqual([]);
    const ok = await api.post(world.as.cat, '/tasks', { title: 'Civil work', projectId: world.projects.PA, columnId: column, categoryIds: [civil] });
    expect(ok.statusCode).toBe(201);
    const id = json<{ id: string }>(ok).id;
    expect(json<{ categories: { name: string }[] }>(ok).categories.map((c) => c.name)).toEqual(['Civil']);
    // Edits that touch categories keep one.
    expect((await api.put(world.as.cat, `/tasks/${id}/categories`, { categoryIds: [] })).statusCode).toBe(400);
    expect((await api.put(world.as.cat, `/tasks/${id}/categories`, { categoryIds: [civil, hse] })).statusCode).toBe(200);
    // Filter.
    expect(((await api.get(world.as.cat, `/tasks?projectId=${world.projects.PA}&categoryId=${hse}`)) as { id: string }[]).map((t) => t.id)).toEqual([id]);
    // Another project's category is refused.
    const theirs = json<{ id: string }>(await api.post(world.as.admin, `/projects/${world.projects.PB}/categories`, { name: 'Civil' })).id;
    expect((await api.put(world.as.cat, `/tasks/${id}/categories`, { categoryIds: [theirs] })).statusCode).toBe(400);
    await api.put(world.as.ana, `/projects/${world.projects.PA}/category-settings`, { requireCategory: false });
  });

  it('a used category is retired, never deleted — a Recycle Bin task counts, a merged one doesn’t', async () => {
    const column = await columnOf(world.projects.PA);
    const unused = json<{ id: string }>(await api.post(world.as.ana, `/projects/${world.projects.PA}/categories`, { name: 'Spare' })).id;
    expect((await del(world.as.ana, `/project-categories/${unused}`)).statusCode).toBe(204);
    const binned = json<{ id: string }>(await api.post(world.as.ana, '/tasks', { title: 'Binned', projectId: world.projects.PA, columnId: column, categoryIds: [hse] })).id;
    await prisma.taskCategory.deleteMany({ where: { categoryId: hse, taskId: { not: binned } } });
    await prisma.task.update({ where: { id: binned }, data: { deletedAt: new Date() } });
    const refused = await del(world.as.ana, `/project-categories/${hse}`);
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('CATEGORY_IN_USE');
    // Merged into another task: it no longer counts.
    await prisma.task.update({ where: { id: binned }, data: { mergedIntoId: binned } });
    expect((await del(world.as.ana, `/project-categories/${hse}`)).statusCode).toBe(204);
    // Retired: kept on tasks, not given to new ones.
    expect((await api.put(world.as.ana, `/project-categories/${civil}`, { retired: true })).statusCode).toBe(200);
    expect((await api.post(world.as.cat, '/tasks', { title: 'Late', projectId: world.projects.PA, columnId: column, categoryIds: [civil] })).statusCode).toBe(400);
  });
});
