import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { createPrismaExternalContactRepository } from '../../src/modules/tasks/prisma-external-contact-repository';
import { createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';
import { createPrismaRecurrencePort } from '../../src/modules/tasks/prisma-recurrence-port';
import { createPrismaTaskExportSource } from '../../src/modules/tasks/task-export';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createTaskSearchEngine } from '../../src/modules/search/task-search-engine';
import { createPrismaMicoAiData } from '../../src/modules/mico-ai/prisma-mico-ai-data';
import type { ExternalContactFields } from '../../src/modules/tasks/external-contacts';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaExternalContactRepository(prisma);
const tasks = createPrismaTaskRepository(prisma);

let userId = '';
let projectId = '';
let otherProjectId = '';
let columnId = '';
let taskId = '';

const fields = (name: string, extra: Partial<ExternalContactFields> = {}): ExternalContactFields => ({
  name,
  company: null,
  designation: null,
  email: null,
  phone: null,
  remarks: null,
  ...extra,
});

async function cleanup() {
  const projects = await prisma.project.findMany({ where: { code: { in: ['XCON', 'XCON2'] } }, select: { id: true } });
  const ids = projects.map((p) => p.id);
  await prisma.activity.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: 'xcon@mico360.test' } });
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await cleanup();
  const owner = await prisma.user.create({ data: { email: 'xcon@mico360.test', username: 'xcon', passwordHash: 'x', firstName: 'Ex', lastName: 'Con' } });
  userId = owner.id;
  projectId = (await prisma.project.create({ data: { code: 'XCON', name: 'External', createdById: owner.id, ownerId: owner.id } })).id;
  otherProjectId = (await prisma.project.create({ data: { code: 'XCON2', name: 'Elsewhere', createdById: owner.id, ownerId: owner.id } })).id;
  columnId = (await prisma.kanbanColumn.create({ data: { projectId, name: 'To do', category: 'TODO', position: 0 } })).id;
  await prisma.kanbanColumn.create({ data: { projectId, name: 'Done', category: 'DONE', position: 1 } });
  taskId = (await prisma.task.create({ data: { key: 'XCON-1', title: 'Rig inspection', projectId, columnId, createdById: owner.id } })).id;
});

describe('External contacts on MySQL (integration)', () => {
  it('adds contacts at the end of the list and keeps every field', async () => {
    const first = await repo.add(taskId, fields('Ahmed Al Said', { company: 'OXY', designation: 'Site lead', email: 'ahmed@oxy.com', phone: '+968 9912 3456', remarks: 'Call before 10' }), userId, 20);
    const second = await repo.add(taskId, fields('Sara Nasser', { company: 'PDO' }), userId, 20);
    expect(first).toMatchObject({ taskId, name: 'Ahmed Al Said', company: 'OXY', designation: 'Site lead', email: 'ahmed@oxy.com', phone: '+968 9912 3456', remarks: 'Call before 10', position: 0, createdById: userId });
    expect(second?.position).toBe(1);
    expect((await repo.list(taskId)).map((c) => c.name)).toEqual(['Ahmed Al Said', 'Sara Nasser']);
    expect(await repo.get(first!.id)).toMatchObject({ id: first!.id, name: 'Ahmed Al Said' });
  });

  it('never lets a task go over the limit, even when two add at once', async () => {
    for (let i = 0; i < 3; i++) await repo.add(taskId, fields(`P${i}`), userId, 5);
    const results = await Promise.all([repo.add(taskId, fields('A'), userId, 5), repo.add(taskId, fields('B'), userId, 5), repo.add(taskId, fields('C'), userId, 5)]);
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(await prisma.taskExternalContact.count({ where: { taskId } })).toBe(5);
  });

  it('changes and removes a contact; a removed one is gone for both', async () => {
    const c = (await repo.add(taskId, fields('Ahmed'), userId, 20))!;
    expect(await repo.update(c.id, fields('Ahmed Al Said', { company: 'OXY' }))).toMatchObject({ name: 'Ahmed Al Said', company: 'OXY' });
    expect(await repo.remove(c.id)).toBe(true);
    expect(await repo.remove(c.id)).toBe(false);
    expect(await repo.update(c.id, fields('Again'))).toBeNull();
    expect(await repo.get(c.id)).toBeNull();
  });

  it('a deleted task’s contacts can’t be opened', async () => {
    const c = (await repo.add(taskId, fields('Ahmed'), userId, 20))!;
    await prisma.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
    expect(await repo.get(c.id)).toBeNull();
  });

  it('finds the contacts used on the project’s live tasks by the start of a word of the name or company, newest first', async () => {
    const t2 = (await prisma.task.create({ data: { key: 'XCON-2', title: 'Second', projectId, columnId, createdById: userId } })).id;
    const gone = (await prisma.task.create({ data: { key: 'XCON-3', title: 'Deleted', projectId, columnId, createdById: userId, deletedAt: new Date() } })).id;
    const elsewhereColumn = (await prisma.kanbanColumn.create({ data: { projectId: otherProjectId, name: 'To do', category: 'TODO', position: 0 } })).id;
    const elsewhere = (await prisma.task.create({ data: { key: 'XCON2-1', title: 'Other', projectId: otherProjectId, columnId: elsewhereColumn, createdById: userId } })).id;
    await repo.add(taskId, fields('Ahmed Al Said', { company: 'OXY' }), userId, 20);
    await new Promise((r) => setTimeout(r, 20));
    await repo.add(t2, fields('Salim Hinai', { company: 'Al Amal Trading' }), userId, 20);
    await repo.add(gone, fields('Alia Deleted', { company: 'Gone' }), userId, 20);
    await repo.add(elsewhere, fields('Ali Elsewhere', { company: 'Other' }), userId, 20);
    const hits = await repo.searchProject(projectId, 'al', 50);
    expect(hits.map((c) => c.name)).toEqual(['Salim Hinai', 'Ahmed Al Said']);
    expect((await repo.searchProject(projectId, 'oxy', 50)).map((c) => c.name)).toEqual(['Ahmed Al Said']);
    expect(await repo.searchProject(projectId, 'zz', 50)).toEqual([]);
  });

  it('finds a word start after a hyphen or a bracket too ("Al-Hassan", "Oman (PDO)")', async () => {
    await repo.add(taskId, fields('Khalid Al-Hassan', { company: 'Petroleum Development Oman (PDO)' }), userId, 20);
    expect((await repo.searchProject(projectId, 'hassan', 50)).map((c) => c.name)).toEqual(['Khalid Al-Hassan']);
    expect((await repo.searchProject(projectId, 'pdo', 50)).map((c) => c.name)).toEqual(['Khalid Al-Hassan']);
    expect(await repo.searchProject(projectId, 'assan', 50)).toEqual([]);
  });

  it('task rows sum up their contacts, and a single task carries them in full', async () => {
    await repo.add(taskId, fields('Ahmed Al Said', { company: 'OXY' }), userId, 20);
    await repo.add(taskId, fields('Sara Nasser', { company: 'PDO' }), userId, 20);
    const [row] = await tasks.list({ projectId });
    expect(row?.externalSummary).toEqual({ count: 2, name: 'Ahmed Al Said', company: 'OXY', names: ['Ahmed Al Said', 'Sara Nasser'], companies: ['OXY', 'PDO'] });
    const one = await tasks.findById(taskId);
    expect(one?.externalContacts?.map((c) => [c.name, c.company])).toEqual([['Ahmed Al Said', 'OXY'], ['Sara Nasser', 'PDO']]);
    expect(one?.externalSummary?.count).toBe(2);
    const bare = (await prisma.task.create({ data: { key: 'XCON-9', title: 'None', projectId, columnId, createdById: userId } })).id;
    expect((await tasks.findById(bare))?.externalSummary).toBeNull();
  });

  it('a new task can be created with its contacts, in the same write', async () => {
    const created = await tasks.create({
      key: 'XCON-5',
      title: 'With contacts',
      projectId,
      columnId,
      createdById: userId,
      externalContacts: [fields('Ahmed Al Said', { company: 'OXY' }), fields('Sara Nasser')],
    });
    const saved = await prisma.taskExternalContact.findMany({ where: { taskId: created.id }, orderBy: { position: 'asc' } });
    expect(saved.map((c) => [c.name, c.position, c.createdById])).toEqual([['Ahmed Al Said', 0, userId], ['Sara Nasser', 1, userId]]);
    expect(created.externalSummary?.count).toBe(2);
  });

  it('the next copy of a repeating task keeps its contacts (copied)', async () => {
    await prisma.task.update({ where: { id: taskId }, data: { recurrenceRule: { freq: 'WEEKLY', interval: 1 } as unknown as Prisma.InputJsonValue, dueDate: new Date('2026-10-28T00:00:00Z') } });
    await repo.add(taskId, fields('Ahmed Al Said', { company: 'OXY', phone: '+968 9912 3456' }), userId, 20);
    const port = createPrismaRecurrencePort(prisma, { timeZone: 'Asia/Muscat', now: () => new Date('2026-10-31T06:00:00Z') });
    const next = await port.spawnNext(taskId, new Date('2026-11-04T00:00:00Z'), { freq: 'WEEKLY', interval: 1 });
    const copied = await prisma.taskExternalContact.findMany({ where: { taskId: next!.id } });
    expect(copied.map((c) => [c.name, c.company, c.phone])).toEqual([['Ahmed Al Said', 'OXY', '+968 9912 3456']]);
    expect(copied[0]!.id).not.toBe((await repo.list(taskId))[0]!.id);
  });

  it('the task export lists the contacts in full', async () => {
    await repo.add(taskId, fields('Ahmed Al Said', { company: 'OXY', designation: 'Site lead', email: 'ahmed@oxy.com', phone: '+968 9912 3456', remarks: 'Call first' }), userId, 20);
    const data = await createPrismaTaskExportSource(prisma, 'Asia/Muscat').load(taskId);
    expect(data?.externalContacts).toEqual([{ name: 'Ahmed Al Said', company: 'OXY', designation: 'Site lead', email: 'ahmed@oxy.com', phone: '+968 9912 3456', remarks: 'Call first' }]);
  });

  it('search finds a task by a contact’s name or company', async () => {
    await repo.add(taskId, fields('Ahmed Al Said', { company: 'Occidental Oman' }), userId, 20);
    await createTaskSearchIndex({ prisma }).taskChanged(taskId);
    const engine = createTaskSearchEngine({ prisma, timeZone: 'Asia/Muscat' });
    const keys = async (q: string, projectIds: string[]) => (await engine.search({ q, scope: { projectIds }, limit: 50 })).hits.map((t) => t.key);
    expect(await keys('occidental', [projectId])).toEqual(['XCON-1']);
    expect(await keys('ahmed', [projectId])).toEqual(['XCON-1']);
    expect(await keys('ahmed', [otherProjectId])).toEqual([]);
  });

  it('MICO AI reads a task’s contacts with its other details', async () => {
    await repo.add(taskId, fields('Ahmed Al Said', { company: 'OXY', email: 'ahmed@oxy.com' }), userId, 20);
    const never = async () => false;
    const data = createPrismaMicoAiData({
      prisma,
      projectAccess: { canViewProject: never, accessibleProjectIds: async () => null },
      meetingAccess: { canViewMeeting: never, canEditMeeting: never },
      conversationIdsFor: async () => [],
    } as unknown as Parameters<typeof createPrismaMicoAiData>[0]);
    const extras = await data.taskExtras(taskId);
    expect(extras.externalContacts).toEqual([{ name: 'Ahmed Al Said', company: 'OXY', designation: null, email: 'ahmed@oxy.com', phone: null, remarks: null }]);
  });
});
