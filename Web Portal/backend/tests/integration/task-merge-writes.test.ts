import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { runBackfill } from './company-helpers';
import { createTaskMergeService } from '../../src/modules/task-merge/merge-service';
import { createCommentService } from '../../src/modules/tasks/comment-service';
import { createPrismaCommentRepository } from '../../src/modules/tasks/prisma-comment-repository';
import { createChecklistService } from '../../src/modules/tasks/checklist-service';
import { createPrismaChecklistStore } from '../../src/modules/tasks/prisma-checklist-store';
import { createAttachmentService } from '../../src/modules/tasks/attachment-service';
import { createPrismaAttachmentRepository } from '../../src/modules/tasks/prisma-attachment-repository';
import { createWatcherService } from '../../src/modules/tasks/watcher-service';
import { createPrismaWatcherRepository } from '../../src/modules/tasks/prisma-watcher-repository';
import { createExternalContactService } from '../../src/modules/tasks/external-contact-service';
import { createPrismaExternalContactRepository } from '../../src/modules/tasks/prisma-external-contact-repository';
import { createPrismaTaskLookup } from '../../src/modules/tasks/prisma-assignee-repository';
import { createLocalDiskStorage } from '../../src/modules/tasks/local-disk-storage';
import { createMemoryIdempotencyStore } from '../../src/lib/idempotency';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. 1.23.1: something ADDED to a merged
// task's id — from a stale screen, an old link or the phone app's offline queue (the app isn't updated) —
// lands on the main task and the answer names it; a change to the merged task's own fields, or deleting
// it, is refused (409 TASK_MERGED, naming the main task). The real routes over the real database.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const CODE = 'MGWRT';
const EMAILS = ['mgw-manager@mico360.test', 'mgw-mate@mico360.test'];
const uploads = mkdtempSync(join(tmpdir(), 'mico-mt-uploads-'));

let app: CompanyApp;
let manager = { id: '', roles: ['EMPLOYEE'] as string[] };
let mate = { id: '', roles: ['EMPLOYEE'] as string[] };
let projectId = '';
let todo = '';
let main = { id: '', key: '' };
let other = { id: '', key: '' };

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: CODE }, select: { id: true } })).map((p) => p.id);
  const taskIds = (await prisma.task.findMany({ where: { projectId: { in: ids } }, select: { id: true } })).map((t) => t.id);
  await prisma.taskMerge.deleteMany({ where: { mainTaskId: { in: taskIds } } });
  await prisma.activity.deleteMany({ where: { OR: [{ projectId: { in: ids } }, { taskId: { in: taskIds } }] } });
  await prisma.taskKeyAlias.deleteMany({ where: { OR: [{ projectId: { in: ids } }, { taskId: { in: taskIds } }] } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

beforeAll(async () => {
  await prisma.$connect();
  const lookup = createPrismaTaskLookup(prisma);
  app = await buildCompanyApp(prisma, () => ({
    taskMergeService: createTaskMergeService({ prisma, timeZone: TZ }),
    commentService: createCommentService({ repo: createPrismaCommentRepository(prisma), taskLookup: lookup }),
    checklistService: createChecklistService({ store: createPrismaChecklistStore(prisma), taskLookup: lookup }),
    attachmentService: createAttachmentService({ repo: createPrismaAttachmentRepository(prisma), storage: createLocalDiskStorage({ baseDir: uploads, publicPrefix: '/uploads' }), taskLookup: lookup, maxSizeBytes: 1_000_000, allowedMimeTypes: [] }),
    watcherService: createWatcherService({ repo: createPrismaWatcherRepository(prisma), taskLookup: lookup }),
    externalContactService: createExternalContactService({ repo: createPrismaExternalContactRepository(prisma), taskLookup: lookup }),
    // The phone app's offline queue sends each change with an Idempotency-Key and may send it twice.
    idempotencyStore: createMemoryIdempotencyStore(),
  }));
});
afterAll(async () => {
  await app.close();
  await cleanup();
  await prisma.$disconnect();
  rmSync(uploads, { recursive: true, force: true });
});
beforeEach(async () => {
  await cleanup();
  const user = (email: string, first: string) => prisma.user.create({ data: { email, username: email.split('@')[0]!, passwordHash: 'x', firstName: first, lastName: 'Writer' } });
  manager = { id: (await user(EMAILS[0]!, 'Aisha')).id, roles: ['EMPLOYEE'] };
  mate = { id: (await user(EMAILS[1]!, 'Omar')).id, roles: ['EMPLOYEE'] };
  projectId = (await prisma.project.create({ data: { code: CODE, name: 'Merge writes', createdById: manager.id } })).id;
  todo = (await prisma.kanbanColumn.create({ data: { projectId, name: 'To do', category: 'TODO', position: 0 } })).id;
  await prisma.projectMember.createMany({ data: [{ projectId, userId: manager.id, role: 'MANAGER' }, { projectId, userId: mate.id }] });
  await runBackfill(prisma);
  const make = (key: string, title: string) => prisma.task.create({ data: { key, title, projectId, columnId: todo, createdById: manager.id }, select: { id: true, key: true } });
  main = await make(`${CODE}-1`, 'Service the pump');
  other = await make(`${CODE}-2`, 'Pump check');
  const merged = await app.post(manager, '/tasks/merge', { taskIds: [main.id, other.id], mainTaskId: main.id });
  expect(merged.statusCode).toBe(200);
});

const mergedInto = () => ({ taskId: main.id, key: main.key, fromKey: other.key });
/** A multipart upload body (one file), as a browser or the app sends it. */
function upload(filename: string, text: string) {
  const boundary = '----mico-merge-test';
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--${boundary}--\r\n`;
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('Writes to a merged task’s id (integration)', () => {
  it('a comment lands on the main task, and the answer names it', async () => {
    const res = await app.post(mate, `/tasks/${other.id}/comments`, { body: 'Pressure is low' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ data: { taskId: main.id, body: 'Pressure is low' }, mergedInto: mergedInto() });
    expect(await prisma.comment.count({ where: { taskId: main.id } })).toBe(1);
    expect(await prisma.comment.count({ where: { taskId: other.id } })).toBe(0);
  });

  it('a checklist item lands on the main task', async () => {
    const res = await app.post(mate, `/tasks/${other.id}/checklist`, { text: 'Check the oil' });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.json()).toMatchObject({ data: { taskId: main.id, text: 'Check the oil' }, mergedInto: mergedInto() });
    expect(await prisma.checklistItem.count({ where: { taskId: main.id } })).toBe(1);
  });

  it('an external contact lands on the main task', async () => {
    const res = await app.post(mate, `/tasks/${other.id}/external-contacts`, { name: 'Ahmed Al Said', company: 'Acme' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ data: { name: 'Ahmed Al Said' }, mergedInto: mergedInto() });
    expect(await prisma.taskExternalContact.count({ where: { taskId: main.id } })).toBe(1);
  });

  it('following it follows the main task', async () => {
    const res = await app.post(mate, `/tasks/${other.id}/watch`);
    expect(res.statusCode).toBeLessThan(300);
    expect(res.json()).toMatchObject({ data: { watching: true }, mergedInto: mergedInto() });
    expect(await prisma.taskWatcher.findUnique({ where: { taskId_userId: { taskId: main.id, userId: mate.id } } })).not.toBeNull();
  });

  it('a file upload lands on the main task', async () => {
    const file = upload('readings.txt', 'pump readings');
    const res = await app.app.inject({ method: 'POST', url: `/api/v1/tasks/${other.id}/attachments`, payload: file.body, headers: { authorization: await bearerOf(mate), ...file.headers } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ data: { taskId: main.id, filename: 'readings.txt' }, mergedInto: mergedInto() });
    expect(await prisma.attachment.count({ where: { taskId: main.id } })).toBe(1);
  });

  it('the phone app’s offline queue: a comment queued before the merge and sent (twice) after it lands once, on the main task', async () => {
    const headers = { 'idempotency-key': 'app-queue-7f3c' };
    const first = await app.post(mate, `/tasks/${other.id}/comments`, { body: 'Written offline' }, headers);
    const again = await app.post(mate, `/tasks/${other.id}/comments`, { body: 'Written offline' }, headers);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());
    expect(first.json()).toMatchObject({ mergedInto: mergedInto() });
    expect(await prisma.comment.findMany({ where: { body: 'Written offline' }, select: { taskId: true } })).toEqual([{ taskId: main.id }]);
  });

  it('a change to the merged task’s own fields, or deleting it, is refused naming the main task — nothing changes', async () => {
    const edit = await app.put(manager, `/tasks/${other.id}`, { title: 'Renamed' });
    expect(edit.statusCode).toBe(409);
    expect(edit.json()).toMatchObject({ error: { code: 'TASK_MERGED', details: { mainTaskId: main.id, mainKey: main.key } } });
    const del = await app.app.inject({ method: 'DELETE', url: `/api/v1/tasks/${other.id}`, headers: { authorization: await bearerOf(manager) } });
    expect(del.statusCode).toBe(409);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: other.id }, select: { title: true, mergedIntoId: true } })).toEqual({ title: 'Pump check', mergedIntoId: main.id });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: main.id }, select: { title: true, deletedAt: true } })).toEqual({ title: 'Service the pump', deletedAt: null });
  });
});

const bearerOf = (viewer: { id: string; roles: string[] }) => app.bearer(viewer);
