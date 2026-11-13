import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { createTokenService } from '../../src/modules/auth/token-service';
import { createAuthService } from '../../src/modules/auth/auth-service';
import { createAuthGuard } from '../../src/modules/auth/auth-guard';
import { createPrismaUserStateLookup } from '../../src/modules/auth/prisma-user-state-lookup';
import { createPrismaTaskRepository, createPrismaProjectLookup } from '../../src/modules/tasks/prisma-task-repository';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createProjectAccess } from '../../src/modules/projects/project-access';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createPrismaProjectManagerLookup } from '../../src/modules/projects/prisma-member-repository';
import { createMessageService } from '../../src/modules/chat/message-service';
import {
  createPrismaConversationRepository,
  createPrismaParticipantRepository,
  createPrismaMessageRepository,
  createPrismaReactionRepository,
  createPrismaChatAttachmentRepository,
  createPrismaChatMemberLookup,
} from '../../src/modules/chat/prisma-chat-repository';
import { createPrismaBinStore } from '../../src/modules/recycle-bin/prisma-bin-store';
import { createBinService, type BinViewer } from '../../src/modules/recycle-bin/bin-service';
import { createFileLinks, type FileViewer } from '../../src/modules/files/file-links';
import { createFileAccess, createPrismaFileRowsStore } from '../../src/modules/files/file-access';
import { registerUploads } from '../../src/modules/files/file-route';
import { portabilityProblems } from '../../src/lib/sql-portability';
import { runBackfill } from './company-helpers';

// 1.23.29 Private file links on a real database (TEST_DATABASE_URL, migrations applied; MySQL 8 and
// MariaDB 11.8): the storageKey indexes exist, and the N9 flows end to end through the file route —
// Recycle Bin → refused (administrators too) → restore → allowed → erase → 404; a deleted project; a
// removed member; a deactivated account; a password change; a direct chat; a deleted message; a replaced photo.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const SECRET = 'pf-db-access-secret-0123456789abcdef';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const dir = mkdtempSync(join(tmpdir(), 'pf-db-'));
const CODES = ['PFA', 'PFB'];
const EMAILS = ['pf-admin@mico360.test', 'pf-mate@mico360.test', 'pf-other@mico360.test'];
const ids: Record<string, string> = {};

const tokenService = createTokenService({
  accessSecret: SECRET, refreshSecret: 'pf-db-refresh', accessTtl: 900, refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const tasks = createTaskService({ tasks: createPrismaTaskRepository(prisma), projects: createPrismaProjectLookup(prisma), timeZone: TZ });
const bin = createBinService({
  store: createPrismaBinStore(prisma),
  timeZone: TZ,
  adminScope: async () => null,
  isArchived: async () => false,
  canViewProject: async (viewer, projectId) => viewer.roles.includes('ADMIN') || (await prisma.projectMember.count({ where: { projectId, userId: viewer.id } })) > 0,
  removeFile: async () => {}, // the bytes stay on disk: an erased task's file must still be a 404
});
const chat = createMessageService({
  conversations: createPrismaConversationRepository(prisma),
  participants: createPrismaParticipantRepository(prisma),
  messages: createPrismaMessageRepository(prisma),
  reactions: createPrismaReactionRepository(prisma),
  attachments: createPrismaChatAttachmentRepository(prisma),
  members: createPrismaChatMemberLookup(prisma),
});
const projectAccess = createProjectAccess({ projects: createPrismaProjectRepository(prisma), managers: createPrismaProjectManagerLookup(prisma) });
const links = createFileLinks({ secret: SECRET });
let app: FastifyInstance;

async function cleanup() {
  const pids = (await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } })).map((p) => p.id);
  const convs = (await prisma.conversation.findMany({ where: { OR: [{ projectId: { in: pids } }, { participants: { some: { userId: { in: Object.values(ids) } } } }] }, select: { id: true } })).map((c) => c.id);
  await prisma.conversation.deleteMany({ where: { id: { in: convs } } });
  const tids = (await prisma.task.findMany({ where: { projectId: { in: pids } }, select: { id: true } })).map((t) => t.id);
  await prisma.activity.deleteMany({ where: { OR: [{ projectId: { in: pids } }, { taskId: { in: tids } }] } });
  await prisma.searchIndex.deleteMany({ where: { OR: [{ taskId: { in: tids } }, { projectId: { in: pids } }] } });
  await prisma.taskKeyAlias.deleteMany({ where: { OR: [{ projectId: { in: pids } }, { taskId: { in: tids } }] } });
  await prisma.task.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.project.deleteMany({ where: { id: { in: pids } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: tids } }, { userId: { in: Object.values(ids) } }] } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

/** A stored file on disk, and its name. */
function stored(name: string): string {
  writeFileSync(join(dir, name), PNG);
  return name;
}
const viewer = async (who: string): Promise<FileViewer> => ({ id: ids[who]!, ver: (await prisma.user.findUniqueOrThrow({ where: { id: ids[who]! } })).tokenVersion });
const open = async (key: string, who?: string) => (await app.inject({ method: 'GET', url: who ? links.sign(key, await viewer(who)) : `/uploads/${key}` })).statusCode;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await cleanup();
  for (const [i, email] of EMAILS.entries()) {
    ids[['admin', 'mate', 'other'][i]!] = (await prisma.user.create({ data: { email, username: email.split('@')[0]!, passwordHash: 'x', firstName: ['Aisha', 'Omar', 'Bilal'][i]!, lastName: 'Files' } })).id;
  }
  const adminRole = await prisma.role.upsert({ where: { name: 'ADMIN' }, update: {}, create: { name: 'ADMIN' } });
  await prisma.userRole.create({ data: { userId: ids.admin!, roleId: adminRole.id } });
  const p = await prisma.project.create({ data: { code: 'PFA', name: 'Acme files', createdById: ids.admin!, ownerId: ids.admin!, members: { create: [{ userId: ids.mate! }] } } });
  ids.project = p.id;
  ids.otherProject = (await prisma.project.create({ data: { code: 'PFB', name: 'Contoso files', createdById: ids.other!, ownerId: ids.other!, members: { create: [{ userId: ids.other! }] } } })).id;
  ids.todo = (await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'To do', category: 'TODO', position: 0 } })).id;
  await runBackfill(prisma);

  const guard = createAuthGuard(tokenService, { userState: createPrismaUserStateLookup(prisma), cacheTtlMs: 0 });
  app = await buildApp({ authService, tokenService });
  await registerUploads(app, {
    root: dir,
    links,
    access: createFileAccess({
      store: createPrismaFileRowsStore(prisma),
      canViewTask: (u, r, t) => projectAccess.canViewTask(u, r, t),
      canSeeConversation: (c, u) => chat.canUserAccessConversation(c, u),
      classifyTtlMs: 0,
      decisionTtlMs: 0,
    }),
    accountState: (u, o) => guard.accountState(u, o),
  });
  await app.ready();
});

async function taskWithFile(title: string) {
  const t = await tasks.createTask({ title, projectId: ids.project!, columnId: ids.todo!, createdById: ids.admin!, assigneeIds: [ids.mate!] });
  const key = stored(`pf-${t.id}.png`);
  await prisma.attachment.create({ data: { taskId: t.id, uploadedById: ids.mate!, filename: 'site.png', mimeType: 'image/png', sizeBytes: PNG.length, storageKey: key, url: `/uploads/${key}` } });
  return { task: t, key };
}
const admin = (): BinViewer => ({ id: ids.admin!, roles: ['ADMIN'] });

describe('the migration', () => {
  it('indexes both tables by stored name', async () => {
    for (const [table, index] of [['task_attachments', 'task_attachments_storageKey_idx'], ['chat_attachments', 'chat_attachments_storageKey_idx']] as const) {
      const q = `SHOW INDEX FROM \`${table}\` WHERE Key_name = '${index}'`;
      expect(portabilityProblems(q)).toEqual([]);
      const rows = await prisma.$queryRawUnsafe<{ Column_name: string }[]>(q);
      expect(rows.map((r) => r.Column_name), table).toEqual(['storageKey']);
    }
  });
});

describe('task files on a real database', () => {
  it('open for a project member with their link; never unsigned, never for someone outside the project', async () => {
    const { key } = await taskWithFile('Pour the slab');
    expect(await open(key, 'mate')).toBe(200);
    expect(await open(key)).toBe(403);
    expect(await open(key, 'other')).toBe(403);
    expect(await open(key, 'admin')).toBe(200);
  });

  it('Recycle Bin → refused (administrators too) → restore → the same link works again → erase → 404, bytes left on disk', async () => {
    const { task, key } = await taskWithFile('Order cement');
    const mateLink = links.sign(key, await viewer('mate'));
    await tasks.deleteTask(task.id, 'one', ids.admin!);
    expect((await app.inject({ method: 'GET', url: mateLink })).statusCode).toBe(403);
    expect(await open(key, 'admin')).toBe(403);
    await bin.restore(admin(), [task.id], {});
    expect((await app.inject({ method: 'GET', url: mateLink })).statusCode).toBe(200);
    await tasks.deleteTask(task.id, 'one', ids.admin!);
    await bin.erase(admin(), [task.id]);
    expect(existsSync(join(dir, key))).toBe(true);
    expect((await app.inject({ method: 'GET', url: mateLink })).statusCode).toBe(404);
    expect(await open(key, 'admin')).toBe(404);
  });

  it('a deleted project’s files are refused for everyone, administrators included', async () => {
    const { key } = await taskWithFile('Fix the gate');
    await prisma.project.update({ where: { id: ids.project! }, data: { deletedAt: new Date() } });
    expect(await open(key, 'mate')).toBe(403);
    expect(await open(key, 'admin')).toBe(403);
  });

  it('removal from the project, deactivation and a password change each stop the person’s link', async () => {
    const { key } = await taskWithFile('Check the pump');
    const link = links.sign(key, await viewer('mate'));
    const get = async () => (await app.inject({ method: 'GET', url: link })).statusCode;
    expect(await get()).toBe(200);
    await prisma.user.update({ where: { id: ids.mate! }, data: { status: 'INACTIVE' } });
    expect(await get()).toBe(403);
    await prisma.user.update({ where: { id: ids.mate! }, data: { status: 'ACTIVE' } });
    expect(await get()).toBe(200);
    await prisma.user.update({ where: { id: ids.mate! }, data: { tokenVersion: { increment: 1 } } });
    expect(await get()).toBe(403);
    expect(await open(key, 'mate')).toBe(200); // a new link, for the new session
    await prisma.projectMember.deleteMany({ where: { projectId: ids.project!, userId: ids.mate! } });
    expect(await open(key, 'mate')).toBe(403);
  });
});

describe('chat files on a real database', () => {
  it('a channel file opens for the project’s people, and stops with the project', async () => {
    const conv = await chat.getOrCreateProjectConversation(ids.project!, ids.mate!);
    const key = stored('pf-chat-channel.png');
    await chat.postMessage(conv.id, ids.mate!, { body: '', attachment: { fileName: 'site.png', mimeType: 'image/png', sizeBytes: PNG.length, storageKey: key } });
    expect(await open(key, 'mate')).toBe(200);
    expect(await open(key, 'admin')).toBe(200);
    expect(await open(key, 'other')).toBe(403);
    expect(await open(key)).toBe(403);
    await prisma.project.update({ where: { id: ids.project! }, data: { deletedAt: new Date() } });
    expect(await open(key, 'mate')).toBe(403);
    expect(await open(key, 'admin')).toBe(403);
  });

  it('a direct chat’s file opens for its two people only; a deleted message’s file is gone (404)', async () => {
    const dm = await chat.getOrCreateDirectConversation(ids.mate!, ids.other!);
    const key = stored('pf-chat-direct.png');
    const { message } = await chat.postMessage(dm.id, ids.mate!, { body: 'the drawing', attachment: { fileName: 'drawing.png', mimeType: 'image/png', sizeBytes: PNG.length, storageKey: key } });
    expect(await open(key, 'mate')).toBe(200);
    expect(await open(key, 'other')).toBe(200);
    expect(await open(key, 'admin')).toBe(403);
    await chat.deleteMessage(message.id, ids.mate!, false);
    writeFileSync(join(dir, key), PNG); // even if the bytes were left behind
    expect(await open(key, 'mate')).toBe(404);
  });
});

describe('public pictures on a real database', () => {
  it('a current photo and project picture open with no link; a replaced photo no longer does', async () => {
    const first = stored('pf-photo-1.png');
    const picture = stored('pf-project.png');
    await prisma.user.update({ where: { id: ids.mate! }, data: { avatarUrl: `/uploads/${first}` } });
    await prisma.project.update({ where: { id: ids.project! }, data: { imageUrl: `/uploads/${picture}` } });
    expect(await open(first)).toBe(200);
    expect(await open(picture)).toBe(200);
    const second = stored('pf-photo-2.png');
    await prisma.user.update({ where: { id: ids.mate! }, data: { avatarUrl: `/uploads/${second}` } });
    expect(await open(first)).toBe(404);
    expect(await open(second)).toBe(200);
  });
});
