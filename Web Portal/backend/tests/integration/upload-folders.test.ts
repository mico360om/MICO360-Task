import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { createUploadMover, ORIGINALS_KEPT_DAYS } from '../../src/modules/files/upload-move';
import { createPrismaMoveStore } from '../../src/modules/files/prisma-upload-move';
import { createFileAccess, createPrismaFileRowsStore } from '../../src/modules/files/file-access';
import { createUploadPlaces } from '../../src/modules/files/upload-places';

// 1.23.38 Upload folders on a real database (MySQL 8 and MariaDB 11.8): every kind of stored file moves into
// <company|shared>/<YYYY>/<MM>/<uploader>/<type>/, its rows follow, old names resolve through
// file_key_aliases, a second run changes nothing, and originals go after 30 days.

const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: CompanyWorld;
let root: string;
let uploads: string;
let training: string;
const u = (n: number, ext: string) => `${String(n).padStart(8, '0')}-aaaa-4bbb-8ccc-${'0'.repeat(12)}${ext}`;
const ids: Record<string, string> = {};
const logs: string[] = [];
const logger = { info: () => {}, warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };
let clock = Date.parse('2026-11-18T10:00:00Z');

function put(dir: string, key: string, content: string) {
  writeFileSync(join(dir, key), content);
}

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  root = mkdtempSync(join(tmpdir(), 'uf-db-'));
  uploads = join(root, 'uploads');
  training = join(root, 'training-files');
  mkdirSync(uploads, { recursive: true });
  mkdirSync(training, { recursive: true });
  // A 1.23.36 site: plain names for every kind of file.
  put(uploads, u(1, '.pdf'), 'task pdf in A');
  put(uploads, u(2, '.png'), 'task picture in AB');
  put(uploads, u(3, '.png'), 'chat picture in PA channel');
  put(uploads, u(4, '.pdf'), 'direct chat pdf');
  put(uploads, u(5, '.png'), 'profile photo');
  put(uploads, u(6, '.png'), 'project picture');
  put(uploads, u(7, '.png'), 'company logo');
  put(training, u(8, '.png'), 'learning hub picture');
  // u(9): a task file missing from the disk.
  const att = async (taskId: string, key: string, mimeType: string) =>
    (await prisma.attachment.create({ data: { taskId, uploadedById: w.people.ana, filename: key, mimeType, sizeBytes: 10, storageKey: key, url: `/uploads/${key}`, createdAt: new Date('2026-03-07T10:00:00Z') } })).id;
  ids.t1 = await att(w.tasks.TA1, u(1, '.pdf'), 'application/pdf');
  ids.t2 = await att(w.tasks.TAB1, u(2, '.png'), 'image/png');
  ids.t9 = await att(w.tasks.TA2, u(9, '.pdf'), 'application/pdf');
  const msg = async (conversationId: string, key: string, mimeType: string) => {
    const m = await prisma.chatMessage.create({ data: { conversationId, userId: w.people.ana, body: '' } });
    return (await prisma.chatAttachment.create({ data: { messageId: m.id, fileName: key, mimeType, sizeBytes: 10, storageKey: key, createdAt: new Date('2026-10-01T10:00:00Z') } })).id;
  };
  ids.c3 = await msg(w.chats.PA, u(3, '.png'), 'image/png');
  ids.c4 = await msg(w.chats.anaAmy, u(4, '.pdf'), 'application/pdf');
  await prisma.user.update({ where: { id: w.people.ana }, data: { avatarUrl: `/uploads/${u(5, '.png')}` } });
  await prisma.project.update({ where: { id: w.projects.PB }, data: { imageUrl: `/uploads/${u(6, '.png')}` } });
  await prisma.company.update({ where: { id: w.companies.A }, data: { logoUrl: `/uploads/${u(7, '.png')}` } });
  ids.tf = (await prisma.trainingFile.create({ data: { kind: 'IMAGE', name: 'step.png', mimeType: 'image/png', sizeBytes: 10, storageKey: u(8, '.png'), uploadedById: w.people.admin, createdAt: new Date('2026-11-02T10:00:00Z') } })).id;
});

afterAll(async () => {
  await prisma.fileKeyAlias.deleteMany({ where: { newKey: { contains: '-aaaa-4bbb-8ccc-000000000000' } } });
  await prisma.trainingFile.deleteMany({ where: { id: ids.tf } });
  await prisma.user.updateMany({ where: { id: w.people.ana }, data: { avatarUrl: null } });
  await prisma.company.updateMany({ where: { id: w.companies.A }, data: { logoUrl: null } });
  await prisma.attachment.deleteMany({ where: { id: { in: [ids.t1!, ids.t2!, ids.t9!] } } });
  await prisma.chatMessage.deleteMany({ where: { attachments: { some: { id: { in: [ids.c3!, ids.c4!] } } } } });
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
  rmSync(root, { recursive: true, force: true });
});

const mover = () => createUploadMover({ store: createPrismaMoveStore(prisma, { uploads, training }, () => new Date(clock)), dirs: { uploads, training }, logger, now: () => new Date(clock) });

describe('the one-time move on a real database', () => {
  it('moves every kind of file into its folders, rows and addresses following', async () => {
    const r = await mover().run();
    expect(r.moved).toBe(8);
    expect(r.missing).toBeGreaterThanOrEqual(1); // u(9), and any other test's rows whose files aren't here

    const t1 = await prisma.attachment.findUniqueOrThrow({ where: { id: ids.t1 } });
    expect(t1.storageKey).toBe(`${w.companies.A}/2026/03/${w.people.ana}/task-files/${u(1, '.pdf')}`);
    expect(t1.url).toBe(`/uploads/${t1.storageKey}`);
    const t2 = await prisma.attachment.findUniqueOrThrow({ where: { id: ids.t2 } });
    expect(t2.storageKey).toMatch(new RegExp(`^(${w.companies.A}|${w.companies.B})/2026/03/${w.people.ana}/task-files/`));
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: ids.t9 } })).storageKey).toBe(u(9, '.pdf'));
    expect((await prisma.chatAttachment.findUniqueOrThrow({ where: { id: ids.c3 } })).storageKey).toBe(`${w.companies.A}/2026/10/${w.people.ana}/chat-files/${u(3, '.png')}`);
    expect((await prisma.chatAttachment.findUniqueOrThrow({ where: { id: ids.c4 } })).storageKey).toBe(`shared/2026/10/${w.people.ana}/chat-files/${u(4, '.pdf')}`);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.people.ana } })).avatarUrl).toMatch(new RegExp(`^/uploads/shared/\\d{4}/\\d{2}/${w.people.ana}/profile-photos/${u(5, '.png')}$`));
    expect((await prisma.project.findUniqueOrThrow({ where: { id: w.projects.PB } })).imageUrl).toMatch(new RegExp(`^/uploads/${w.companies.B}/\\d{4}/\\d{2}/system/project-pictures/${u(6, '.png')}$`));
    expect((await prisma.company.findUniqueOrThrow({ where: { id: w.companies.A } })).logoUrl).toMatch(new RegExp(`^/uploads/${w.companies.A}/\\d{4}/\\d{2}/system/company-logos/${u(7, '.png')}$`));
    expect((await prisma.trainingFile.findUniqueOrThrow({ where: { id: ids.tf } })).storageKey).toBe(`shared/2026/11/${w.people.admin}/learning-hub/${u(8, '.png')}`);

    // Same bytes in the new place; the originals are still there.
    expect(readFileSync(join(uploads, ...t1.storageKey.split('/')), 'utf8')).toBe('task pdf in A');
    expect(existsSync(join(uploads, u(1, '.pdf')))).toBe(true);
    expect(logs.some((m) => /missing/i.test(m))).toBe(true);
  });

  it('a second start changes nothing', async () => {
    const before = await prisma.fileKeyAlias.count();
    const r = await mover().run();
    expect(r.moved).toBe(0);
    expect(await prisma.fileKeyAlias.count()).toBe(before);
  });

  it('old names resolve through the alias table, checked as the moved file (company check included)', async () => {
    const access = createFileAccess({
      store: createPrismaFileRowsStore(prisma),
      canViewTask: async (userId) => userId === w.people.ana,
      canSeeConversation: async () => false,
      companiesOf: async (userId) => (userId === w.people.ana ? [w.companies.A] : []),
    });
    const found = await access.resolve(u(1, '.pdf'));
    expect(found.file).toBe(`${w.companies.A}/2026/03/${w.people.ana}/task-files/${u(1, '.pdf')}`);
    expect(found.kind).toMatchObject({ kind: 'protected', taskIds: [w.tasks.TA1], companyIds: [w.companies.A] });
    expect(await access.mayOpen(w.as.ana, found.kind, found.file)).toBe(true);
    expect(await access.resolve(u(7, '.png'))).toMatchObject({ kind: { kind: 'public' } });
  });

  it('a project that moves to another company gets its files re-filed (old links still work)', async () => {
    await prisma.projectCompany.deleteMany({ where: { projectId: w.projects.PA } });
    await prisma.projectCompany.create({ data: { projectId: w.projects.PA, companyId: w.companies.B } });
    await prisma.project.update({ where: { id: w.projects.PA }, data: { mainCompanyId: w.companies.B } });
    expect(await createUploadPlaces(prisma).companyOfTask(w.tasks.TA1)).toBe(w.companies.B);
    const r = await mover().run();
    expect(r.moved).toBeGreaterThanOrEqual(2); // the task file and the channel's picture
    const t1 = await prisma.attachment.findUniqueOrThrow({ where: { id: ids.t1 } });
    expect(t1.storageKey).toBe(`${w.companies.B}/2026/03/${w.people.ana}/task-files/${u(1, '.pdf')}`);
    const access = createFileAccess({ store: createPrismaFileRowsStore(prisma), canViewTask: async () => true, canSeeConversation: async () => false });
    expect((await access.resolve(u(1, '.pdf'))).file).toBe(t1.storageKey);
    expect((await mover().run()).moved).toBe(0);
  });

  it('originals are removed 30 days after the move, once', async () => {
    clock += (ORIGINALS_KEPT_DAYS - 1) * 24 * 60 * 60 * 1000;
    expect((await mover().sweep()).removed).toBe(0);
    clock += 2 * 24 * 60 * 60 * 1000;
    const s = await mover().sweep();
    expect(s.removed).toBeGreaterThanOrEqual(8);
    expect(existsSync(join(uploads, u(1, '.pdf')))).toBe(false);
    expect(existsSync(join(training, u(8, '.png')))).toBe(false);
    const t1 = await prisma.attachment.findUniqueOrThrow({ where: { id: ids.t1 } });
    expect(existsSync(join(uploads, ...t1.storageKey.split('/')))).toBe(true);
    expect((await mover().sweep()).removed).toBe(0);
  });
});
