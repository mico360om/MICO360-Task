import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { FILE_TEXT_MAX_CHARS, type FileText } from '../../lib/file-text';
import { readFileTextOffThread } from '../../lib/file-text-thread';
import { MAX_ATTEMPTS, RETRY_DELAYS_MS, isRetryable } from '../ai-jobs/ai-job-runner';
import { ProviderRefusedError } from '../ai/ai-completion';

/**
 * 1.23 search — the text inside task files. A file is read once, in the background (after its upload,
 * and by a sweep for files older than this feature), never holding up the upload: PDF, Word, Excel,
 * PowerPoint, CSV and text files by our own readers (lib/file-text). A picture, or a PDF with almost
 * no text (a scan), waits for AI OCR (OCR_WAIT) — read only while an OCR model is set up, as the AI
 * jobs of 1.22 are tried: up to four times, 30 s, 2 min and 5 min apart, then FAILED; at most
 * OCR_PER_HOUR files an hour on a server (system work: no person's AI limit is used). Each result
 * re-indexes the file (search_index).
 */

export type StoredStatus = 'READING' | 'RETRY' | 'READ' | 'EMPTY' | 'OCR_WAIT' | 'OCR_DONE' | 'FAILED' | 'SKIPPED';

/** A file is tried this many times (a read that never finished, storage that was away) before FAILED. */
export const READ_TRIES = 3;
/** …this long apart. */
const READ_RETRY_MS = 10 * 60_000;
/** An OCR try holds its file this long (a stopped server's is taken again after it). */
const OCR_LEASE_MS = 10 * 60_000;

/** At most this many files are sent to OCR per hour on one server. */
export const OCR_PER_HOUR = 30;
/** One OCR run starts no new file after this long (a scan may take 5 minutes on MICO360 AI). */
const OCR_RUN_BUDGET_MS = 2 * 60_000;
/** A used-up quota: the file waits its Retry-After, held between a minute and a day (an hour when none is given). */
const QUOTA_WAIT_MIN_MS = 60_000;
const QUOTA_WAIT_MAX_MS = 24 * 60 * 60_000;
const QUOTA_WAIT_UNKNOWN_MS = 60 * 60_000;
/** A scanned PDF's first pages only are sent (pictures). */
const OCR_MAX_PAGES = 5;
/** What one OCR request sends at most: a picture file, or a scanned PDF's page pictures together. */
export const OCR_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The pictures one OCR request sends. Security review (1.23): the 8 MB cap held only for a picture file;
 * a scanned PDF's pages had none and a page drawn several times was sent several times. Now each picture
 * once, in page order, at most OCR_MAX_PAGES and OCR_MAX_BYTES together (one that would pass the cap is
 * left out; a smaller later page still goes).
 */
export function ocrPictures(source: { picture: { data: Buffer; mimeType: string } } | { pages: Buffer[] }): { data: Buffer; mimeType: string }[] {
  if ('picture' in source) return source.picture.data.length <= OCR_MAX_BYTES ? [source.picture] : [];
  const out: { data: Buffer; mimeType: string }[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const page of source.pages) {
    if (out.length >= OCR_MAX_PAGES) break;
    const key = createHash('sha256').update(page).digest('base64');
    if (seen.has(key)) continue;
    seen.add(key);
    if (total + page.length > OCR_MAX_BYTES) continue;
    total += page.length;
    out.push({ data: page, mimeType: 'image/jpeg' });
  }
  return out;
}

/** Letters of the Arabic script, and of the Latin one (accents included). */
const ARABIC_LETTER = /[\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF\u0750-\u077F\u08A0-\u08C9\uFB50-\uFDFB\uFE70-\uFEFC]/g;
const LATIN_LETTER = /[A-Za-z\u00C0-\u024F]/g;

/** ar-SA or en-US when these words are (nearly) all in one script; null when mixed or there are none. */
function languageOfWords(words: Array<string | null | undefined>): string | null | undefined {
  const text = words.filter(Boolean).join(' ');
  const arabic = (text.match(ARABIC_LETTER) ?? []).length;
  const latin = (text.match(LATIN_LETTER) ?? []).length;
  if (arabic + latin < 3) return undefined; // nothing to go on
  const share = arabic / (arabic + latin);
  return share >= 0.8 ? 'ar-SA' : share <= 0.05 ? 'en-US' : null;
}

/**
 * b4: the language MICO360 AI reads a scan in (its /ocr `language`). No project or company has a
 * language setting, so it comes from the words around the file: `own` — what people wrote: the file's own
 * few letters, its task's title and description — else `wider` — its name (often a camera's "IMG_2041"),
 * the project's and the company's names. Arabic is ar-SA, English en-US; mixed words, or none, name no
 * language (the node reads with its own).
 */
export function documentLanguage(own: Array<string | null | undefined>, wider: Array<string | null | undefined>): string | null {
  const first = languageOfWords(own);
  if (first !== undefined) return first;
  return languageOfWords(wider) ?? null;
}

/** b4: a scan with no page pictures we could send is looked at again after this (whole-document reading may be back). */
const NO_PICTURES_RETRY_MS = 24 * 60 * 60_000;

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
  ocr?: {
    ready(): Promise<boolean>;
    read(images: { data: Buffer; mimeType: string }[]): Promise<string>;
    /**
     * b4: the whole document (MICO360 AI's POST /api/v1/ocr, which falls back to `pictures` itself);
     * `whole`: it was read whole. Absent: the pictures are read, as before.
     */
    readDocument?(
      doc: { data: Buffer; mimeType: string; filename: string },
      opts: { language: string | null; key: string; pictures: () => Promise<{ data: Buffer; mimeType: string }[]> },
    ): Promise<{ text: string; whole: boolean }>;
    /** b4: can whole documents be read now? (Scans whose pages were no pictures we could send are then read again.) */
    wholeDocuments?(): Promise<boolean>;
  };
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

  /**
   * Read one file now. Never throws. It is marked READING first (review I3): a read that never ends — a
   * server stopped by a hostile file — is tried again later, READ_TRIES times at most, then FAILED. The
   * text is read off the main thread (lib/file-text-thread). Storage that can't be read now is tried
   * again later (RETRY), the same number of times.
   */
  async function readFile(fileId: string): Promise<StoredStatus | null> {
    try {
      const file = await prisma.attachment.findFirst({ where: { id: fileId, task: { deletedAt: null } }, select: { id: true, filename: true, mimeType: true, storageKey: true } });
      if (!file) return null;
      const before = await prisma.searchFileText.findUnique({ where: { fileId }, select: { status: true, attempts: true } });
      const tries = (before && (before.status === 'READING' || before.status === 'RETRY') ? before.attempts : 0) + 1;
      if (tries > READ_TRIES) {
        await store(fileId, { status: 'FAILED', attempts: tries - 1, error: 'Reading the file failed several times.' });
        return 'FAILED';
      }
      const mark = { status: 'READING', attempts: tries, nextTryAt: new Date(now().getTime() + READ_RETRY_MS), error: null, readAt: now() };
      await prisma.searchFileText.upsert({ where: { fileId }, create: { fileId, ...mark }, update: mark });
      let content: Buffer;
      try {
        content = await storage.read(file.storageKey);
      } catch (err) {
        const last = tries >= READ_TRIES;
        await store(fileId, { status: last ? 'FAILED' : 'RETRY', attempts: tries, nextTryAt: last ? null : new Date(now().getTime() + READ_RETRY_MS), error: 'The file could not be read from storage.' });
        logger?.error('search: reading a file failed', { err, fileId, tries });
        return last ? 'FAILED' : 'RETRY';
      }
      const t = await readFileTextOffThread(content, file);
      const status = toStored(t);
      // Read: its tries start again from nought (an OCR wait counts its own).
      await store(fileId, { status, method: t.method, text: t.text || null, attempts: status === 'FAILED' ? tries : 0, error: t.error ?? null, nextTryAt: status === 'OCR_WAIT' ? now() : null });
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

  /**
   * The sweep: files never read (older than this feature), and those due again (a read that never
   * finished, storage that was away) — of live tasks only. Returns how many were read.
   */
  async function readUnread(limit = 20): Promise<number> {
    const unread = await prisma.attachment.findMany({
      where: { task: { deletedAt: null }, OR: [{ searchText: { is: null } }, { searchText: { is: { status: { in: ['READING', 'RETRY'] }, nextTryAt: { lte: now() } } } }] },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
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
    const dueNow = () => ({ status: 'OCR_WAIT', OR: [{ nextTryAt: null }, { nextTryAt: { lte: now() } }] });
    // b4: whole documents can be read: scans that had no page pictures we could send (black-and-white
    // scanner PDFs) wait for OCR again — once a day at most.
    if (ocr.readDocument && ocr.wholeDocuments && (await ocr.wholeDocuments())) {
      await prisma.searchFileText.updateMany({
        where: { status: 'EMPTY', method: null, OR: [{ nextTryAt: null }, { nextTryAt: { lte: now() } }], file: { mimeType: 'application/pdf', task: { deletedAt: null } } },
        data: { status: 'OCR_WAIT', nextTryAt: null, attempts: 0 },
      });
    }
    const due = await prisma.searchFileText.findMany({ where: { ...dueNow(), file: { task: { deletedAt: null } } }, orderBy: { readAt: 'asc' }, take: room, select: { fileId: true, attempts: true } });
    let done = 0;
    const started = now().getTime();
    for (const row of due) {
      // A slow provider (MICO360 AI may take 5 minutes a scan): no new file after OCR_RUN_BUDGET_MS, so the
      // minute's other search steps aren't held up (review minor 8). The rest wait for the next run.
      if (now().getTime() - started >= OCR_RUN_BUDGET_MS) break;
      const file = await prisma.attachment.findUnique({
        where: { id: row.fileId },
        select: {
          filename: true,
          mimeType: true,
          storageKey: true,
          searchText: { select: { text: true } },
          task: { select: { title: true, description: true, project: { select: { name: true, mainCompany: { select: { name: true } } } } } },
        },
      });
      if (!file) continue;
      // Claimed first (review I4): another run (or server) at the same moment never sends it again.
      const claimed = await prisma.searchFileText.updateMany({ where: { fileId: row.fileId, ...dueNow() }, data: { nextTryAt: new Date(now().getTime() + OCR_LEASE_MS) } });
      if (claimed.count === 0) continue;
      sent.push(now().getTime());
      const attempts = row.attempts + 1;
      try {
        const content = await storage.read(file.storageKey);
        let pictures: Promise<{ data: Buffer; mimeType: string }[]> | null = null;
        const picturesOf = () =>
          (pictures ??= /^image\//.test(file.mimeType)
            ? Promise.resolve(ocrPictures({ picture: { data: content, mimeType: file.mimeType } }))
            : readFileTextOffThread(content, file).then((t) => ocrPictures({ pages: t.images })));
        let text: string;
        let whole = false;
        if (ocr.readDocument) {
          // b4: the whole file, in the language of the words around it (MICO360 AI; it falls back to the pictures).
          const language = documentLanguage(
            [file.searchText?.text, file.task?.title, file.task?.description],
            [file.filename.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_-]+/g, ' '), file.task?.project?.name, file.task?.project?.mainCompany?.name],
          );
          const out = await ocr.readDocument({ data: content, mimeType: file.mimeType, filename: file.filename }, { language, key: `tasks-ocr-${row.fileId}`, pictures: picturesOf });
          text = out.text.trim();
          whole = out.whole;
        } else {
          const images = await picturesOf();
          text = images.length ? (await ocr.read(images)).trim() : '';
        }
        if (!text && !whole && (await picturesOf()).length === 0) {
          // A scan whose pages aren't pictures we can send: nothing more can be read from it now — looked at
          // again in a day, in case whole documents can be read by then (b4).
          await store(row.fileId, { status: 'EMPTY', attempts, nextTryAt: new Date(now().getTime() + NO_PICTURES_RETRY_MS) });
          continue;
        }
        await store(row.fileId, { status: text ? 'OCR_DONE' : 'EMPTY', method: 'ocr', text, attempts });
        done += 1;
      } catch (err) {
        if (err instanceof ProviderRefusedError && err.quota) {
          // MICO360 AI's usage allowance is used up (review I3): not this file's failure. It waits until the
          // allowance resets — no try counted — and this run sends no more files into the same quota.
          const waitMs = Math.min(QUOTA_WAIT_MAX_MS, Math.max(QUOTA_WAIT_MIN_MS, err.retryAfterSeconds !== null ? err.retryAfterSeconds * 1000 : QUOTA_WAIT_UNKNOWN_MS));
          await store(row.fileId, { status: 'OCR_WAIT', attempts: row.attempts, nextTryAt: new Date(now().getTime() + waitMs), error: err.message });
          logger?.error('search: OCR waits — the AI service’s usage allowance is used up', { err, fileId: row.fileId, waitMs });
          break;
        }
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
