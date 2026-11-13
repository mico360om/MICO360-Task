import { officePreview, type OfficePreview } from '../../lib/office-preview';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { sniffMime, SNIFFABLE } from '../../lib/magic-mime';
import { fileContentMismatchMessage, fileTooLargeMessage, fileTypeNotAllowedMessage, safeUploadName } from '../../lib/upload-safety';
import type {
  AttachmentRecord,
  AttachmentRepository,
  AttachmentStorage,
  UploadedFile,
} from './attachment-repository';
import type { TaskLookup } from './assignee-repository';
import { removeStoredFile, type RemoveStoredFileOptions } from '../../lib/stored-files';

export interface AttachmentServiceDeps {
  repo: AttachmentRepository;
  storage: AttachmentStorage;
  taskLookup: TaskLookup;
  maxSizeBytes: number;
  /** Allowed mime types; empty array means "allow any". */
  allowedMimeTypes: string[];
  /** Optional cap on the total bytes of all attachments on a single task. */
  maxTotalBytesPerTask?: number;
  /** Makes a picture smaller before it is stored (the same bytes back when it can't). */
  shrinkImage?: (content: Buffer, mimeType: string) => Promise<Buffer>;
  /** After a change to the words of a task (the task search index re-reads it). */
  onChanged?: (taskId: string) => void | Promise<void>;
  /** Review fix #23: where a file that couldn't be deleted from storage is reported. */
  logger?: RemoveStoredFileOptions['logger'];
  /** The pause before trying a refused file delete again (ms; tests). */
  fileRetryPauseMs?: number;
}

export function createAttachmentService({
  repo,
  storage,
  taskLookup,
  maxSizeBytes,
  allowedMimeTypes,
  maxTotalBytesPerTask,
  shrinkImage,
  onChanged,
  logger,
  fileRetryPauseMs,
}: AttachmentServiceDeps) {
  const dropFile = (storageKey: string, what: string) =>
    removeStoredFile(storage, storageKey, { logger, what, ...(fileRetryPauseMs !== undefined ? { pauseMs: fileRetryPauseMs } : {}) });
  async function ensureTask(taskId: string): Promise<void> {
    if (!(await taskLookup.exists(taskId))) throw new NotFoundError('Task not found.');
  }

  /** `fromClient`: 1.23.7, a client's upload from the Client portal (same rules as everyone's). */
  async function upload(taskId: string, uploadedById: string, file: UploadedFile, opts: { fromClient?: boolean } = {}): Promise<AttachmentRecord> {
    await ensureTask(taskId);
    if (file.content.length === 0) throw new ValidationError('File is empty.');
    if (file.content.length > maxSizeBytes) {
      throw new ValidationError(fileTooLargeMessage(maxSizeBytes));
    }
    if (allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(file.mimeType)) {
      throw new ValidationError(fileTypeNotAllowedMessage(file.filename));
    }
    // Reject a spoofed Content-Type: if we can sniff the declared type, the bytes must match.
    if (SNIFFABLE.has(file.mimeType)) {
      const actual = sniffMime(file.content);
      if (actual !== file.mimeType) {
        throw new ValidationError(fileContentMismatchMessage(file.filename));
      }
    }
    // Pictures are stored smaller (checked above first, so only real pictures get this far).
    const content = shrinkImage ? await shrinkImage(file.content, file.mimeType) : file.content;
    // Per-task storage quota, on what is actually stored.
    if (maxTotalBytesPerTask !== undefined) {
      const existing = await repo.list(taskId);
      const used = existing.reduce((sum, a) => sum + a.sizeBytes, 0);
      if (used + content.length > maxTotalBytesPerTask) {
        throw new ValidationError('This task has reached its attachment storage limit.');
      }
    }
    // 1.23.7 (security review): the name as kept — no hidden characters, it fits its column, and a client's
    // file ends in the extension of the type it was checked as.
    const filename = safeUploadName(file.filename, file.mimeType, { client: opts.fromClient === true });
    const { storageKey, url, sizeBytes } = await storage.save({ ...file, filename, content });
    let created: AttachmentRecord;
    try {
      created = await repo.create({
        taskId,
        uploadedById,
        filename,
        mimeType: file.mimeType,
        sizeBytes,
        storageKey,
        url,
        ...(opts.fromClient ? { fromClient: true } : {}),
      });
    } catch (err) {
      // The row couldn't be saved: its bytes don't stay on disk uncounted (tried again, else logged).
      await dropFile(storageKey, 'a task file whose record could not be saved');
      throw err;
    }
    await onChanged?.(taskId);
    return created;
  }

  /** 1.23.7 "Show to client" on one of a task's files (NotFound when it isn't that task's). */
  async function setClientVisible(taskId: string, id: string, visible: boolean): Promise<{ before: boolean; record: AttachmentRecord }> {
    const rec = await repo.findById(id);
    if (!rec || rec.taskId !== taskId) throw new NotFoundError('Attachment not found.');
    if (!repo.setClientVisible) throw new ValidationError('Files can’t be shown to clients here.');
    const before = rec.clientVisible === true;
    const record = before === visible ? rec : await repo.setClientVisible(id, visible);
    return { before, record };
  }

  async function list(taskId: string): Promise<AttachmentRecord[]> {
    await ensureTask(taskId);
    return repo.list(taskId);
  }

  /** Delete an attachment (its uploader or an admin); returns what was removed. */
  async function remove(id: string, userId: string, isAdmin: boolean): Promise<AttachmentRecord> {
    const rec = await repo.findById(id);
    if (!rec) throw new NotFoundError('Attachment not found.');
    if (rec.uploadedById !== userId && !isAdmin) {
      throw new ForbiddenError('You can only delete your own attachment.');
    }
    // Review fix #23: the record first, then the file — a record never points at a missing file; a file the
    // disk won't delete is tried again, then logged (the delete has happened for the person either way).
    await repo.delete(id);
    await dropFile(rec.storageKey, 'a deleted task file');
    await onChanged?.(rec.taskId);
    return rec;
  }

  /** One attachment (NotFound when it doesn't exist). */
  async function get(id: string): Promise<AttachmentRecord> {
    const rec = await repo.findById(id);
    if (!rec) throw new NotFoundError('Attachment not found.');
    return rec;
  }

  /**
   * A plain-text preview of a Word, Excel or PowerPoint attachment; null when the file has none.
   * Throws PreviewError when it is damaged or too big to unpack safely.
   */
  async function preview(rec: AttachmentRecord): Promise<OfficePreview | null> {
    if (!storage.read || !/\.(docx|xlsx|pptx)$/i.test(rec.filename)) return null;
    return officePreview(await storage.read(rec.storageKey), rec.filename);
  }

  return { upload, list, remove, get, preview, setClientVisible };
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;
