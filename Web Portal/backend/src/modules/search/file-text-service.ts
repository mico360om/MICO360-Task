import type { PrismaClient } from '@prisma/client';
import { FILE_TEXT_MAX_CHARS, readFileText, type FileText } from '../../lib/file-text';
import { MAX_ATTEMPTS, RETRY_DELAYS_MS, isRetryable } from '../ai-jobs/ai-job-runner';

/**
 * 1.23 search — the text inside task files. A file is read once, in the background (after its upload,
 * and by a sweep for files older than this feature), never holding up the upload: PDF, Word, Excel,
 * PowerPoint, CSV and text files by our own readers (lib/file-text). A picture, or a PDF with almost
 * no text (a scan), waits for AI OCR (OCR_WAIT) — read only while an OCR model is set up, as the AI
 * jobs of 1.22 are tried: up to four times, 30 s, 2 min and 5 min apart, then FAILED; at most
 * OCR_PER_HOUR files an hour on a server (system work: no person's AI limit is used). Each result
 * re-indexes the file (search_index).
 */

export type StoredStatus = 'READ' | 'EMPTY' | 'OCR_WAIT' | 'OCR_DONE' | 'FAILED' | 'SKIPPED';

/** At most this many files are sent to OCR per hour on one server. */
export const OCR_PER_HOUR = 30;
/** A scanned PDF's first pages only are sent (pictures). */
const OCR_MAX_PAGES = 5;
/** A picture larger than this isn't sent to OCR. */
const OCR_MAX_BYTES = 8 * 1024 * 1024;

export interface FileTextLogger {
  info?(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface FileTextDeps {
  prisma: PrismaClient;
  /** The stored bytes of a file. */
  storage: { read(storageKey: string): Promise<Buffer> };
  /** After a file's text was stored. */
  index: { fileChanged(fileId: string): Promise<void> };
  /** AI OCR, when set up (absent: pictures and scans wait). */
  ocr?: { ready(): Promise<boolean>; read(images: { data: Buffer; mimeType: string }[]): Promise<string> };
  logger?: FileTextLogger;
  now?: () => Date;
}

const toStored = (t: FileText): StoredStatus => (t.status === 'NEEDS_OCR' ? 'OCR_WAIT' : t.status);

export function createFileTextService({ prisma, storage, index, ocr, logger, now = () => new Date() }: FileTextDeps) {
  async function store(fileId: string, data: { status: StoredStatus; method?: string | null; text?: string | null; attempts?: number; nextTryAt?: Date | null; error?: string | null }): Promise<void> {
    const row = {
      status: data.status,
      method: data.method ?? null,
      text: data.text ? data.text.slice(0, FILE_TEXT_MAX_CHARS) : null,
      attempts: data.attempts ?? 0,
      nextTryAt: data.nextTryAt ?? null,
      error: data.error ? data.error.slice(0, 300) : null,
      readAt: now(),
    };
    await prisma.searchFileText.upsert({ where: { fileId }, create: { fileId, ...row }, update: row });
    await index.fileChanged(fileId);
  }

  /** Read one file now (whatever it held before). Never throws: a failure is stored as FAILED. */
  async function readFile(fileId: string): Promise<StoredStatus | null> {
    try {
      const file = await prisma.attachment.findUnique({ where: { id: fileId }, select: { id: true, filename: true, mimeType: true, storageKey: true } });
      if (!file) return null;
      let content: Buffer;
      try {
        content = await storage.read(file.storageKey);
      } catch (err) {
        await store(fileId, { status: 'FAILED', error: 'The file could not be read from storage.' });
        logger?.error('search: reading a file failed', { err, fileId });
        return 'FAILED';
      }
      const t = readFileText(content, file);
      const status = toStored(t);
      await store(fileId, { status, method: t.method, text: t.text || null, error: t.error ?? null, nextTryAt: status === 'OCR_WAIT' ? now() : null });
      return status;
    } catch (err) {
      logger?.error('search: reading a file failed', { err, fileId });
      return null;
    }
  }

  // One file at a time on this server: reading is CPU work, and an upload must never wait for it.
  let chain: Promise<unknown> = Promise.resolve();
  const later = (run: () => Promise<unknown>): Promise<void> => {
    const next = chain.then(() => new Promise((resolve) => setImmediate(resolve))).then(run).then(
      () => undefined,
      (err: unknown) => logger?.error('search: reading files failed', { err }),
    );
    chain = next;
    return next;
  };

  /** A task's files changed: those not read yet are read in the background. Never throws. */
  function taskFilesAdded(taskId: string): Promise<void> {
    return later(async () => {
      const unread = await prisma.attachment.findMany({ where: { taskId, searchText: null }, select: { id: true } });
      for (const f of unread) await readFile(f.id);
    });
  }

  /** The sweep: files never read (older than this feature, or a server stopped first). Returns how many. */
  async function readUnread(limit = 20): Promise<number> {
    const unread = await prisma.attachment.findMany({ where: { searchText: null }, select: { id: true }, orderBy: { createdAt: 'desc' }, take: limit });
    let n = 0;
    for (const f of unread) {
      await new Promise((resolve) => setImmediate(resolve));
      if (await readFile(f.id)) n += 1;
    }
    return n;
  }

  const sent: number[] = [];
  /** The OCR sweep: due files waiting for OCR, while an OCR model is set up. Returns how many were read. */
  async function readByOcr(limit = 5): Promise<number> {
    if (!ocr || !(await ocr.ready())) return 0;
    const hourAgo = now().getTime() - 3600_000;
    while (sent.length && sent[0]! < hourAgo) sent.shift();
    const room = Math.min(limit, OCR_PER_HOUR - sent.length);
    if (room <= 0) return 0;
    const due = await prisma.searchFileText.findMany({ where: { status: 'OCR_WAIT', OR: [{ nextTryAt: null }, { nextTryAt: { lte: now() } }] }, orderBy: { readAt: 'asc' }, take: room, select: { fileId: true, attempts: true } });
    let done = 0;
    for (const row of due) {
      const file = await prisma.attachment.findUnique({ where: { id: row.fileId }, select: { filename: true, mimeType: true, storageKey: true } });
      if (!file) continue;
      sent.push(now().getTime());
      const attempts = row.attempts + 1;
      try {
        const content = await storage.read(file.storageKey);
        const images = /^image\//.test(file.mimeType) ? (content.length <= OCR_MAX_BYTES ? [{ data: content, mimeType: file.mimeType }] : []) : readFileText(content, file).images.slice(0, OCR_MAX_PAGES).map((data) => ({ data, mimeType: 'image/jpeg' }));
        if (images.length === 0) {
          // A scan whose pages aren't pictures we can send: nothing more can be read from it.
          await store(row.fileId, { status: 'EMPTY', attempts });
          continue;
        }
        const text = (await ocr.read(images)).trim();
        await store(row.fileId, { status: text ? 'OCR_DONE' : 'EMPTY', method: 'ocr', text, attempts });
        done += 1;
      } catch (err) {
        const retry = isRetryable(err) && attempts < MAX_ATTEMPTS;
        const message = err instanceof Error ? err.message : 'OCR failed';
        await store(row.fileId, retry ? { status: 'OCR_WAIT', attempts, nextTryAt: new Date(now().getTime() + RETRY_DELAYS_MS[attempts - 1]!), error: message } : { status: 'FAILED', method: 'ocr', attempts, error: message });
        logger?.error('search: OCR of a file failed', { err, fileId: row.fileId, attempts, retry });
      }
    }
    return done;
  }

  return { readFile, taskFilesAdded, readUnread, readByOcr };
}

export type FileTextService = ReturnType<typeof createFileTextService>;
