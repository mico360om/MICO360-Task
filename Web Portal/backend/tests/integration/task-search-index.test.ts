import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { SEARCH_INDEX_VERSION } from '../../src/modules/search/task-search-text';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const index = createTaskSearchIndex({ prisma });

const CODES = ['SIDX', 'SIDX2'];
const EMAILS = ['sidx-owner@mico360.test', 'sidx-bilal@mico360.test'];
let ownerId = '';
let bilalId = '';
let projectId = '';
let columnId = '';
let taskId = '';

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } })).map((p) => p.id);
  await prisma.activity.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.taskKeyAlias.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.tag.deleteMany({ where: { name: { in: ['sidx-safety', 'sidx-renamed'] } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

/** The task's index row as text (or null). */
async function row(id = taskId) {
  const r = await prisma.taskSearchIndex.findUnique({ where: { taskId: id } });
  return r ? { head: Buffer.from(r.head).toString('utf8'), doc: Buffer.from(r.doc).toString('utf8'), version: r.version, stamp: r.stamp } : null;
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
  ownerId = (await prisma.user.create({ data: { email: EMAILS[0]!, username: 'sidx-owner', passwordHash: 'x', firstName: 'Owner', lastName: 'One' } })).id;
  bilalId = (await prisma.user.create({ data: { email: EMAILS[1]!, username: 'sidx-bilal', passwordHash: 'x', firstName: 'Bilal', lastName: 'Ahmed' } })).id;
  projectId = (await prisma.project.create({ data: { code: 'SIDX', name: 'Index', createdById: ownerId } })).id;
  columnId = (await prisma.kanbanColumn.create({ data: { projectId, name: 'To do', category: 'TODO', position: 0 } })).id;
  taskId = (await prisma.task.create({ data: { key: 'SIDX-1', title: 'Check the Scaffold', description: 'Before the shift', projectId, columnId, createdById: ownerId } })).id;
});

describe('Task search index on MySQL (integration)', () => {
  it('indexes everything a task holds, normalised, live comments only', async () => {
    const tag = await prisma.tag.create({ data: { name: 'sidx-safety' } });
    const parent = await prisma.comment.create({ data: { taskId, userId: ownerId, body: 'Who has the PERMIT?' } });
    await prisma.comment.create({ data: { taskId, userId: bilalId, body: 'I have it', parentId: parent.id } });
    await prisma.comment.create({ data: { taskId, userId: bilalId, body: 'secret deleted words', deletedAt: new Date() } });
    await prisma.checklistItem.create({ data: { taskId, text: 'Photograph the base plates' } });
    await prisma.taskAssignee.create({ data: { taskId, userId: bilalId } });
    await prisma.taskExternalContact.create({ data: { taskId, name: 'Ahmed Al Said', company: 'OXY', designation: 'Site lead', email: 'ahmed@oxy.com', phone: '+968 9912', remarks: 'Call before 10' } });
    await prisma.taskTag.create({ data: { taskId, tagId: tag.id } });
    await prisma.attachment.create({ data: { taskId, uploadedById: ownerId, filename: 'Permit-Scan.PDF', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'k', url: '/u/k' } });
    await prisma.taskKeyAlias.create({ data: { key: 'SIDX2-9', taskId, projectId } });
    expect(await index.refresh([taskId])).toBe(1);
    const r = (await row())!;
    expect(r.head).toBe('\nsidx-1\nsidx2-9\ncheck the scaffold');
    for (const text of ['before the shift', 'who has the permit?', 'i have it', 'photograph the base plates', 'bilal ahmed', 'sidx-bilal', 'ahmed al said', 'oxy', 'site lead', 'ahmed@oxy.com', '+968 9912', 'call before 10', 'sidx-safety', 'permit-scan.pdf']) {
      expect(r.doc.split('\n'), text).toContain(text);
    }
    expect(r.doc).not.toContain('secret');
    expect(r.version).toBe(SEARCH_INDEX_VERSION);
  });

  it('stores Arabic in its normalised spelling', async () => {
    await prisma.task.update({ where: { id: taskId }, data: { title: 'إدارة الموقع', description: 'المُدِير' } });
    await index.refresh([taskId]);
    expect((await row())!.doc).toContain('اداره الموقع\nالمدير');
  });

  it('taskChanged refreshes a task, and never throws', async () => {
    await index.taskChanged(taskId);
    await prisma.comment.create({ data: { taskId, userId: ownerId, body: 'crane booked' } });
    await index.taskChanged(taskId);
    expect((await row())!.doc).toContain('crane booked');
    await expect(index.taskChanged('no-such-task')).resolves.toBeUndefined();
    const broken = createTaskSearchIndex({ prisma: {} as PrismaClient, logger: { error: () => {} } });
    await expect(broken.taskChanged(taskId)).resolves.toBeUndefined();
  });

  it('two quick changes to one task end with the newest text', async () => {
    await index.refresh([taskId]);
    await prisma.task.update({ where: { id: taskId }, data: { title: 'first change' } });
    const a = index.taskChanged(taskId);
    await prisma.task.update({ where: { id: taskId }, data: { title: 'second change' } });
    const b = index.taskChanged(taskId);
    await Promise.all([a, b]);
    expect((await row())!.head).toContain('second change');
  });

  it('an older read never overwrites a newer one (a slow sweep after a quick refresh)', async () => {
    await prisma.task.update({ where: { id: taskId }, data: { title: 'first title' } });
    await index.refresh([taskId]);
    // A sweep that read the task a minute ago writes after the refresh above: it loses.
    const slow = createTaskSearchIndex({ prisma, now: () => new Date(Date.now() - 60_000) });
    await prisma.task.update({ where: { id: taskId }, data: { title: 'second title' } });
    await slow.refresh([taskId]);
    expect((await row())!.head).toContain('first title');
    await index.refresh([taskId]);
    expect((await row())!.head).toContain('second title');
  });

  it('a deleted task leaves the index', async () => {
    await index.refresh([taskId]);
    await prisma.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
    await index.taskChanged(taskId);
    expect(await row()).toBeNull();
  });

  it('the quick heal indexes tasks with no row, an old version, or a change since', async () => {
    const t2 = (await prisma.task.create({ data: { key: 'SIDX-2', title: 'Second', projectId, columnId, createdById: ownerId } })).id;
    await index.refresh([taskId]);
    await prisma.taskSearchIndex.update({ where: { taskId }, data: { version: 0 } });
    expect(await index.healRecent()).toBeGreaterThanOrEqual(2);
    expect((await row(t2))?.head).toContain('second');
    expect((await row())?.version).toBe(SEARCH_INDEX_VERSION);
    // Changed after it was indexed, by a path that didn't refresh it.
    await prisma.taskSearchIndex.update({ where: { taskId: t2 }, data: { indexedAt: new Date(Date.now() - 60_000) } });
    await prisma.task.update({ where: { id: t2 }, data: { title: 'Second renamed' } });
    await index.healRecent();
    expect((await row(t2))?.head).toContain('second renamed');
  });

  it('the full heal catches what changed without a refresh: a new or removed comment, a renamed person or tag', async () => {
    const tag = await prisma.tag.create({ data: { name: 'sidx-safety' } });
    await prisma.taskTag.create({ data: { taskId, tagId: tag.id } });
    await prisma.taskAssignee.create({ data: { taskId, userId: bilalId } });
    const c = await prisma.comment.create({ data: { taskId, userId: ownerId, body: 'crane booked' } });
    await index.refresh([taskId]);
    await index.healAll(); // whatever else the database holds is settled first
    expect(await index.healAll()).toBe(0);

    await prisma.comment.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
    await prisma.user.update({ where: { id: bilalId }, data: { firstName: 'Bilaal' } });
    await prisma.tag.update({ where: { id: tag.id }, data: { name: 'sidx-renamed' } });
    expect(await index.healAll()).toBe(1);
    const r = (await row())!;
    expect(r.doc).not.toContain('crane');
    expect(r.doc).toContain('bilaal ahmed');
    expect(r.doc).toContain('sidx-renamed');
  });

  it('the full heal drops the rows of deleted tasks', async () => {
    await index.refresh([taskId]);
    await prisma.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
    await index.healAll();
    expect(await row()).toBeNull();
  });

  it('refreshes the tasks a person is assigned to, after a change to their name', async () => {
    await prisma.taskAssignee.create({ data: { taskId, userId: bilalId } });
    await index.refresh([taskId]);
    await prisma.user.update({ where: { id: bilalId }, data: { lastName: 'Al Balushi' } });
    await index.refreshForUser(bilalId);
    expect((await row())!.doc).toContain('bilal al balushi');
  });

  it('rebuilds every task', async () => {
    await prisma.task.create({ data: { key: 'SIDX-2', title: 'Second', projectId, columnId, createdById: ownerId } });
    expect(await index.rebuildAll()).toBeGreaterThanOrEqual(2);
    expect(await prisma.taskSearchIndex.count({ where: { task: { projectId } } })).toBe(2);
  });
});
