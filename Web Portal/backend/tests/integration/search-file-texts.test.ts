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

  // Review I3: MICO360 AI's quota (a 429 "Quota exceeded", until its period resets) is not a failure of
  // the file: it waits for the reset — no try counted — and the run stops sending more files meanwhile.
  it('a used-up quota: the file waits until it resets (no try counted), and the run stops', async () => {
    const t = new Date('2026-11-06T08:00:00Z').getTime();
    const sent: string[] = [];
    const ocr = {
      ready: async () => true,
      read: async (images: { data: Buffer; mimeType: string }[]) => {
        sent.push(images[0]!.data.toString('hex'));
        throw new ProviderRefusedError(429, 'Quota exceeded: OCR pages per month (500).', true, 7200);
      },
    };
    const svc = createFileTextService({ prisma, storage, index, ocr, now: () => new Date(t) });
    const first = await att('quota-1.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 7]));
    const second = await att('quota-2.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 8]));
    await prisma.searchFileText.create({ data: { fileId: first, status: 'OCR_WAIT', attempts: 1, nextTryAt: null, readAt: new Date(t - 2000) } });
    await prisma.searchFileText.create({ data: { fileId: second, status: 'OCR_WAIT', attempts: 0, nextTryAt: null, readAt: new Date(t - 1000) } });
    expect(await svc.readByOcr()).toBe(0);
    expect(sent).toHaveLength(1); // the second file was not sent into the same quota
    const row = await textRow(first);
    expect(row).toMatchObject({ status: 'OCR_WAIT', attempts: 1 });
    expect(row!.nextTryAt!.getTime()).toBe(t + 7200_000);
    expect(row!.error).toMatch(/usage allowance is used up/);
    expect(await textRow(second)).toMatchObject({ status: 'OCR_WAIT', attempts: 0 });
  });

  // Review minor 8: reading a scan may now take 5 minutes (MICO360 AI); one run starts no new file after
  // 2 minutes, so the minute's other search steps aren't held up for half an hour.
  it('one OCR run starts no new file after 2 minutes', async () => {
    let t = new Date('2026-11-07T08:00:00Z').getTime();
    let sent = 0;
    const ocr = { ready: async () => true, read: async () => { sent += 1; t += 3 * 60_000; return `SLOW ${tag}`; } };
    const svc = createFileTextService({ prisma, storage, index, ocr, now: () => new Date(t) });
    const a = await att('slow-1.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 21]));
    const b = await att('slow-2.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 22]));
    await prisma.searchFileText.create({ data: { fileId: a, status: 'OCR_WAIT', nextTryAt: null, readAt: new Date(t - 2000) } });
    await prisma.searchFileText.create({ data: { fileId: b, status: 'OCR_WAIT', nextTryAt: null, readAt: new Date(t - 1000) } });
    expect(await svc.readByOcr()).toBe(1);
    expect(sent).toBe(1);
    expect(await svc.readByOcr()).toBe(1); // the next run reads the other
    expect(sent).toBe(2);
  });

  // (b) bundles, b4: MICO360 AI reads the whole document — every page, black-and-white scans too — in the
  // language of the words around it; a scan whose pages could not be sent as pictures is read again.
  const scanOn = async (title: string, name: string, bytes: Buffer) => {
    const columnId = (await prisma.kanbanColumn.findFirst({ where: { projectId } }))!.id;
    const task = await prisma.task.create({ data: { key: `FT${tag.toUpperCase()}-${name.length}${Math.floor(Math.random() * 1e6)}`, title, projectId, columnId, createdById: user } });
    files.set(`${tag}-${name}`, bytes);
    return (await prisma.attachment.create({ data: { taskId: task.id, uploadedById: user, filename: name, mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: `${tag}-${name}`, url: `/u/${name}` } })).id;
  };
  const settleOthers = () => prisma.searchFileText.updateMany({ where: { status: { in: ['OCR_WAIT', 'EMPTY'] } }, data: { status: 'FAILED' } });

  it('b4: whole documents — the file itself, its language and a key per file; a scan no picture could carry is read again', async () => {
    await settleOthers(); // the earlier tests' waiting files
    const t = new Date('2026-11-12T08:00:00Z');
    const bytes = Buffer.from(`%PDF-1.4 black and white scan ${tag}`);
    const bw = await scanOn('شهادة الدفاع المدني', 'bw.pdf', bytes);
    // As an older release left it: a scan with no page pictures it could send.
    await prisma.searchFileText.create({ data: { fileId: bw, status: 'EMPTY', method: null, attempts: 1, readAt: new Date(t.getTime() - 5000) } });
    const asked: Array<Record<string, unknown>> = [];
    const ocr = {
      ready: async () => true,
      read: async (): Promise<string> => {
        throw new Error('pictures are not sent when the whole document is read');
      },
      wholeDocuments: async () => true,
      readDocument: async (doc: { data: Buffer; mimeType: string; filename: string }, opts: { language: string | null; key: string }) => {
        asked.push({ data: doc.data.toString(), mimeType: doc.mimeType, filename: doc.filename, language: opts.language, key: opts.key });
        return { text: `نص الشهادة ${tag}`, whole: true };
      },
    };
    const svc = createFileTextService({ prisma, storage, index, ocr, now: () => t });
    expect(await svc.readByOcr()).toBe(1);
    expect(asked).toEqual([{ data: bytes.toString(), mimeType: 'application/pdf', filename: 'bw.pdf', language: 'ar-SA', key: `tasks-ocr-${bw}` }]);
    expect(await textRow(bw)).toMatchObject({ status: 'OCR_DONE', method: 'ocr', text: `نص الشهادة ${tag}` });
    expect(await svc.readByOcr()).toBe(0); // read once
  });

  it('b4: when only pictures can be read, a scan without any waits a day before it is looked at again', async () => {
    await settleOthers();
    let t = new Date('2026-11-13T08:00:00Z').getTime();
    let whole = false;
    let documents = 0;
    const ocr = {
      ready: async () => true,
      read: async () => 'never',
      wholeDocuments: async () => true,
      readDocument: async (_doc: unknown, opts: { pictures: () => Promise<unknown[]> }) => {
        documents += 1;
        if (whole) return { text: `Inspection record ${tag}`, whole: true };
        // Whole-document reading refused (the provider fell back to the pictures): this scan has none.
        expect(await opts.pictures()).toEqual([]);
        return { text: '', whole: false };
      },
    };
    const svc = createFileTextService({ prisma, storage, index, ocr, now: () => new Date(t) });
    const scan = await scanOn('Inspection record', 'nopics.pdf', Buffer.from(`%PDF-1.4 no pictures ${tag}`));
    await prisma.searchFileText.create({ data: { fileId: scan, status: 'OCR_WAIT', nextTryAt: null, readAt: new Date(t - 1000) } });
    await svc.readByOcr();
    const row = await textRow(scan);
    expect(row).toMatchObject({ status: 'EMPTY', method: null });
    expect(row!.nextTryAt!.getTime()).toBe(t + 24 * 3600_000);
    t += 3600_000;
    await svc.readByOcr();
    expect(documents).toBe(1); // not before the day is over
    whole = true;
    t += 24 * 3600_000;
    await svc.readByOcr();
    expect(await textRow(scan)).toMatchObject({ status: 'OCR_DONE', text: `Inspection record ${tag}` });
  });

  // Review minor 7: after the upgrade, older scans no picture could carry are read again a few at a time,
  // so new scans still get room in every run.
  it('b4: older scans are taken back a few a run (3), so a new scan is read in the same run', async () => {
    await settleOthers();
    const t = new Date('2026-11-15T08:00:00Z');
    const old: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await scanOn('Old scan', `old-${i}.pdf`, Buffer.from(`%PDF-1.4 old ${i} ${tag}`));
      await prisma.searchFileText.create({ data: { fileId: id, status: 'EMPTY', method: null, attempts: 1, readAt: new Date(t.getTime() - (10 - i) * 60_000) } });
      old.push(id);
    }
    const fresh = await scanOn('New scan', 'new.pdf', Buffer.from(`%PDF-1.4 new ${tag}`));
    await prisma.searchFileText.create({ data: { fileId: fresh, status: 'OCR_WAIT', nextTryAt: null, readAt: new Date(t.getTime() - 1000) } });
    const read: string[] = [];
    const ocr = {
      ready: async () => true,
      read: async () => 'never',
      wholeDocuments: async () => true,
      readDocument: async (doc: { filename: string }) => {
        read.push(doc.filename);
        return { text: `Read ${doc.filename} ${tag}`, whole: true };
      },
    };
    const svc = createFileTextService({ prisma, storage, index, ocr, now: () => t });
    await svc.readByOcr();
    expect(read).toContain('new.pdf');
    expect(read.filter((n) => n.startsWith('old-'))).toHaveLength(3);
    const still = await prisma.searchFileText.count({ where: { fileId: { in: old }, status: 'EMPTY' } });
    expect(still).toBe(2); // the rest at the next runs
  });
});

