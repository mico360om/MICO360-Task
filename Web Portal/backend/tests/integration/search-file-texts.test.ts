import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PdfDocument } from '../../src/lib/pdf-document';
import { createSearchIndex } from '../../src/modules/search/search-index';
import { createFileTextService, OCR_PER_HOUR } from '../../src/modules/search/file-text-service';
import { ProviderRefusedError } from '../../src/modules/ai/ai-completion';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.23: the text inside task files is read in the background, older files by a sweep, scans and
// pictures by AI OCR (only while an OCR model is set up), retried like 1.22's AI jobs.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const index = createSearchIndex({ prisma });
const tag = Math.random().toString(36).slice(2, 8);
const files = new Map<string, Buffer>();
const storage = { read: async (key: string) => { const b = files.get(key); if (!b) throw new Error('missing'); return b; } };

let user = '';
let projectId = '';
let taskId = '';
const att = async (name: string, mimeType: string, content: Buffer) => {
  const key = `${tag}-${name}`;
  files.set(key, content);
  return (await prisma.attachment.create({ data: { taskId, uploadedById: user, filename: name, mimeType, sizeBytes: content.length, storageKey: key, url: `/u/${key}` } })).id;
};
const textRow = (fileId: string) => prisma.searchFileText.findUnique({ where: { fileId } });

beforeAll(async () => {
  await prisma.$connect();
  user = (await prisma.user.create({ data: { email: `ft-${tag}@x.test`, username: `ft_${tag}`, passwordHash: 'x', firstName: 'File', lastName: 'Reader' } })).id;
  projectId = (await prisma.project.create({ data: { code: `FT${tag.toUpperCase()}`, name: 'Files', createdById: user } })).id;
  const col = await prisma.kanbanColumn.create({ data: { projectId, name: 'To do', category: 'TODO', position: 0 } });
  taskId = (await prisma.task.create({ data: { key: `FT${tag.toUpperCase()}-1`, title: 'Permits', projectId, columnId: col.id, createdById: user } })).id;
});

afterAll(async () => {
  await prisma.searchIndex.deleteMany({ where: { taskId } });
  await prisma.task.deleteMany({ where: { projectId } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.user.deleteMany({ where: { id: user } });
  await prisma.$disconnect();
});

describe('file texts (database)', () => {
  it('reads new files of a task in the background, and indexes their text', async () => {
    const svc = createFileTextService({ prisma, storage, index });
    const pdf = await att('method.pdf', 'application/pdf', new PdfDocument().text(`Crane lift method ${tag}`).build());
    const txt = await att('notes.txt', 'text/plain', Buffer.from(`Torque values ${tag}`));
    await svc.taskFilesAdded(taskId);
    expect(await textRow(pdf)).toMatchObject({ status: 'READ', method: 'pdf' });
    expect((await textRow(pdf))!.text).toContain(`Crane lift method ${tag}`);
    expect(await textRow(txt)).toMatchObject({ status: 'READ', method: 'text', text: `Torque values ${tag}` });
    const row = await prisma.searchIndex.findUnique({ where: { kind_recordId: { kind: 'file', recordId: pdf } } });
    expect(Buffer.from(row!.lead!).toString('utf8')).toContain(`crane lift method ${tag}`);
    // Read once: nothing more to do for the task.
    await svc.taskFilesAdded(taskId);
    expect((await prisma.searchFileText.count({ where: { fileId: { in: [pdf, txt] } } }))).toBe(2);
  });

  it('the sweep reads files never read; a file gone from storage is tried again later, never a throw', async () => {
    const svc = createFileTextService({ prisma, storage, index });
    const old = await att('old.csv', 'text/csv', Buffer.from(`tag,size\nV-${tag},6`));
    const lost = (await prisma.attachment.create({ data: { taskId, uploadedById: user, filename: 'lost.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: `${tag}-nowhere`, url: '/u/x' } })).id;
    expect(await svc.readUnread(50)).toBeGreaterThanOrEqual(2);
    expect(await textRow(old)).toMatchObject({ status: 'READ' });
    expect(await textRow(lost)).toMatchObject({ status: 'RETRY', attempts: 1 });
  });

  it('review I3/M6/M7: a file is marked as being read first — a read that never finished is tried again, three times at most; storage errors are retried later; deleted tasks’ files wait', async () => {
    let t = new Date('2026-11-05T09:00:00Z').getTime();
    const svc = createFileTextService({ prisma, storage, index, now: () => new Date(t) });
    // A server stopped while reading it: left READING.
    const stuck = await att('stuck.txt', 'text/plain', Buffer.from(`Stuck once ${tag}`));
    await prisma.searchFileText.create({ data: { fileId: stuck, status: 'READING', attempts: 1, nextTryAt: new Date(t - 1000), readAt: new Date(t - 20 * 60_000) } });
    // One that has killed the reader three times.
    const killer = await att('killer.txt', 'text/plain', Buffer.from('x'));
    await prisma.searchFileText.create({ data: { fileId: killer, status: 'READING', attempts: 3, nextTryAt: new Date(t - 1000), readAt: new Date(t - 20 * 60_000) } });
    // Storage away for a moment.
    const away = (await prisma.attachment.create({ data: { taskId, uploadedById: user, filename: 'away.txt', mimeType: 'text/plain', sizeBytes: 1, storageKey: `${tag}-away`, url: '/u/x' } })).id;
    await svc.readUnread(50);
    expect(await textRow(stuck)).toMatchObject({ status: 'READ', text: `Stuck once ${tag}` });
    expect(await textRow(killer)).toMatchObject({ status: 'FAILED' });
    expect(await textRow(away)).toMatchObject({ status: 'RETRY', attempts: 1 });
    files.set(`${tag}-away`, Buffer.from(`Back again ${tag}`));
    await svc.readUnread(50);
    expect(await textRow(away)).toMatchObject({ status: 'RETRY' }); // not before its wait
    t += 11 * 60_000;
    await svc.readUnread(50);
    expect(await textRow(away)).toMatchObject({ status: 'READ', text: `Back again ${tag}` });
    // A deleted task's files are not read.
    const col = (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId } })).id;
    const gone = await prisma.task.create({ data: { key: `FT${tag.toUpperCase()}-9`, title: 'Gone', projectId, columnId: col, createdById: user, deletedAt: new Date() } });
    const orphan = (await prisma.attachment.create({ data: { taskId: gone.id, uploadedById: user, filename: 'o.txt', mimeType: 'text/plain', sizeBytes: 1, storageKey: `${tag}-o`, url: '/u/x' } })).id;
    files.set(`${tag}-o`, Buffer.from('orphan'));
    await svc.readUnread(50);
    expect(await textRow(orphan)).toBeNull();
  });

  it('review I4: two OCR runs at once never send the same file twice (the first claims it)', async () => {
    const t = new Date('2026-11-05T10:00:00Z');
    let calls = 0;
    const ocr = { ready: async () => true, read: async () => { calls += 1; await new Promise((r) => setTimeout(r, 200)); return `CLAIMED ${tag}`; } };
    const svc = createFileTextService({ prisma, storage, index, ocr, now: () => t });
    const photo = await att('claim.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
    await prisma.searchFileText.create({ data: { fileId: photo, status: 'OCR_WAIT', nextTryAt: null, readAt: new Date(t.getTime() - 1000) } });
    await Promise.all([svc.readByOcr(), svc.readByOcr()]);
    expect(calls).toBe(1);
    expect(await textRow(photo)).toMatchObject({ status: 'OCR_DONE', text: `CLAIMED ${tag}` });
  });

  it('pictures wait for OCR; read only while an OCR model is set up; a busy provider is tried again later, then FAILED', async () => {
    let t = new Date('2026-11-05T08:00:00Z').getTime();
    const now = () => new Date(t);
    let ready = false;
    let replies: (string | Error)[] = [];
    const sent: number[] = [];
    const ocr = { ready: async () => ready, read: async (images: { data: Buffer; mimeType: string }[]) => { sent.push(images.length); const r = replies.shift(); if (r instanceof Error) throw r; return r ?? ''; } };
    const svc = createFileTextService({ prisma, storage, index, ocr, now });
    const photo = await att('site.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    await svc.readFile(photo);
    expect(await textRow(photo)).toMatchObject({ status: 'OCR_WAIT' });
    expect(await svc.readByOcr()).toBe(0); // no OCR model: it waits
    ready = true;
    replies = [new ProviderRefusedError(429, null)];
    await svc.readByOcr();
    expect(await textRow(photo)).toMatchObject({ status: 'OCR_WAIT', attempts: 1 });
    expect(await svc.readByOcr()).toBe(0); // not due for 30 s
    t += 31_000;
    replies = [`PERMIT BOARD ${tag}`];
    expect(await svc.readByOcr()).toBe(1);
    expect(await textRow(photo)).toMatchObject({ status: 'OCR_DONE', method: 'ocr', text: `PERMIT BOARD ${tag}` });
    expect(sent).toEqual([1, 1]);
    // A provider that keeps refusing: four tries in all, then FAILED.
    const other = await att('plan.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await svc.readFile(other);
    for (let i = 0; i < 4; i++) {
      replies = [new ProviderRefusedError(503, null)];
      t += 10 * 60_000;
      await svc.readByOcr();
    }
    expect(await textRow(other)).toMatchObject({ status: 'FAILED', attempts: 4 });
    expect(OCR_PER_HOUR).toBe(30);
  });
});
